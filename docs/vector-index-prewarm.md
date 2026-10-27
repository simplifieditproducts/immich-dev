# Vector Index Prewarm

What Immich's startup prewarm of the vector indexes does, what we measured on
keepsafe, and why our fork now skips it on a deploy.

The code: `DatabaseService.prewarmVectorIndexes`
(`server/src/services/database.service.ts`) and
`DatabaseRepository.getPrewarmStats` / `prewarm`
(`server/src/repositories/database.repository.ts`). The servers' setup is in
the immich-devops repository.

Measured: 2026-10-26, ks-wdc-01 (keepsafe).

## What prewarm is

At startup each Immich container (`immich_server` and `immich_microservices`)
runs `SELECT vchordrq_prewarm('clip_index')` and then the same for `face_index`.
That reads the whole VectorChord index through Postgres's buffer manager into
`shared_buffers`, so the first searches don't read it from disk.

- `clip_index`: CLIP embeddings (`smart_search`), used by smart search and
  duplicate detection. Few of our users use smart search.
- `face_index`: face embeddings (`face_search`), used by the face jobs that run
  for every upload.

Upstream added it for home servers, where Postgres and Immich start together
and the buffers are cold.

## What we found

### Every deploy was offline for about two minutes

Upstream ran the prewarm inside bootstrap, inside the migrations advisory lock,
and awaited it. The API only starts listening once bootstrap is done. Promote
of 2026-10-26 (`release-20261027-0132`), from the container logs (EDT):

| Time | Container | Event |
|-|-|-|
| 21:33:37 → 21:35:23 | microservices (got the lock first) | `clip_index` prewarm, **106 s** |
| 21:35:23 → 21:35:25 | microservices | `face_index` prewarm, 2 s |
| 21:35:27 → 21:35:34 | API (waited for the lock) | `clip_index`, 7 s (warm by now) |
| 21:35:35 | API | `face_index` 1 s, then listening |

The public ping answered 502 from 21:33:22 to 21:35:31: the outage was the API
waiting for the other container's prewarm.

### A deploy doesn't restart Postgres

`immich_postgres` had been up for six months (since 2026-04-07). A deploy only
restarts the Immich containers, so the buffers stay warm with what the
workload uses.

### The indexes and the buffers

`shared_buffers` is 200 GB (in huge pages) of 256 GB RAM; the database is
931 GB. Hit rates are from `pg_statio_user_indexes`, counted since 2026-04-06:

| Index | Size | Share of `shared_buffers` | Hit rate | Blocks read from outside the buffers |
|-|-|-|-|-|
| `face_index` | 143 GB | 72% | 99.99% | 939 M (about 7.7 TB) |
| `clip_index` | 216 GB | 108% | 92.21% | 3,144 M (about 26 TB) |

`face_index` gets about 7 trillion buffer hits, some 400,000 a second: it is
always resident. `clip_index` is bigger than all of `shared_buffers` and can
never be resident; part of its 26 TB of reads is the prewarm itself, about
100 GB per deploy.

### What the buffers held half an hour after that promote

From `pg_buffercache`, top entries:

| Relation | In buffers | Of the relation |
|-|-|-|
| `face_index` | 140 GB | 97.8% |
| `asset` | 27 GB | 99.8% |
| `asset_face` | 7.2 GB | 100% |
| `clip_index` | 7.4 GB | **3.4%** |
| `smart_search` | 3.5 GB | 100% |
| `face_search` | 3.5 GB | 100% |
| `asset_pkey` | 2.2 GB | 100% |
| `asset_face_pkey` | 2.1 GB | 100% |

The workload's working set fills the 200 GB. The prewarm read about 100 GB of
`clip_index` in, and half an hour later 7.4 GB of it was left. Prewarming it
only pushed out pages the workload does use, likely the 2.2% of `face_index`
missing above.

## What the fork does now

1. **In the background.** Prewarm runs after the migrations lock and isn't
   awaited, so the API listens as soon as migrations are done. A failed prewarm
   only logs a warning.
2. **Only after a Postgres restart.** If Postgres has been up for more than 10
   minutes, it's a deploy and the buffers are warm: the log says
   `Skipping vector index prewarm: Postgres has been up for N minutes`.
3. **Only what fits.** Indexes are taken face first, then clip, and each one is
   prewarmed only if it fits in `shared_buffers` together with the ones before
   it. Past that, each would push out the one before it, or its own first
   pages. The log says `Skipping prewarm of <index>: <size> doesn't fit`.

On keepsafe after a Postgres restart that means `face_index` only (143 GB of
200 GB) and never `clip_index`. With two 150 GB indexes in 200 GB, only face.
Reading 143 GB in sequentially beats the face jobs reading it a page at a time.

### Things to know

- **A cold index is slower, not stuck.** A search on a cold index reads its
  pages from disk; results are the same. The prewarm only takes a share lock,
  so it doesn't block writes or the face jobs.
- **Two containers, one prewarm each.** Both containers run it. When both do
  (only after a Postgres restart), they read the same pages: the second mostly
  finds them already read.
- **A container that dies mid-prewarm** leaves the query running in Postgres
  until it ends (Postgres only notices the closed connection when it answers).
  It's read-only and ends on its own; restarts can stack a few. See below to
  list or cancel them.
- **Postgres restarted alone** (Immich kept running) gets no prewarm: nothing
  in Immich restarts to run it. The face jobs warm `face_index` by reading it.

## Checking

Read-only queries, run in a database client.

Index sizes and hit rates:

```sql
SELECT c.relname, pg_size_pretty(pg_relation_size(c.oid)) AS size, s.idx_blks_read, s.idx_blks_hit, round(100.0 * s.idx_blks_hit / nullif(s.idx_blks_hit + s.idx_blks_read, 0), 2) AS hit_pct FROM pg_statio_user_indexes s JOIN pg_class c ON c.oid = s.indexrelid WHERE c.relname IN ('clip_index', 'face_index');
```

Database size, `shared_buffers`, Postgres start, stats reset:

```sql
SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size, current_setting('shared_buffers') AS shared_buffers, pg_postmaster_start_time() AS pg_started, (SELECT stats_reset FROM pg_stat_database WHERE datname = current_database()) AS stats_reset;
```

What's in the buffers now (`pg_buffercache` is installed on keepsafe; this
scans every buffer, 10 to 30 seconds at 200 GB):

```sql
SELECT c.relname, pg_size_pretty(count(*) * 8192) AS in_buffers, round(100.0 * count(*) * 8192 / nullif(pg_relation_size(c.oid), 0), 1) AS pct_of_relation FROM pg_buffercache b JOIN pg_class c ON b.relfilenode = pg_relation_filenode(c.oid) WHERE b.reldatabase = (SELECT oid FROM pg_database WHERE datname = current_database()) GROUP BY c.oid, c.relname ORDER BY count(*) DESC LIMIT 15;
```

Prewarm queries running now (expect none on a deploy):

```sql
SELECT pid, now() - query_start AS running, state, left(query, 60) AS query FROM pg_stat_activity WHERE query LIKE '%vchordrq_prewarm%' AND pid <> pg_backend_pid();
```

Cancelling them, if restarts stacked some up:

```sql
SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE query LIKE '%vchordrq_prewarm%' AND pid <> pg_backend_pid();
```

## Capacity to watch

`face_index` grows with every face uploaded. It and the rest of the working set
already fill keepsafe's 200 GB of `shared_buffers`. Once they no longer fit,
the face hit rate drops from 99.99% and the face jobs slow down. That bears on
whether a server should keep taking new users (server recommendation). Worth
graphing the vector index sizes against `shared_buffers` in Grafana.
