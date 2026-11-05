# CLAUDE.md

## What this repo is

Private fork of [Immich](https://github.com/immich-app/immich) with custom patches.

Standard Immich monorepo layout: `server/` (NestJS API + job workers), `web/`
(SvelteKit), `mobile/` (Flutter), `machine-learning/`, `e2e/`.

`mobile/` and `e2e/` modules are not used, so leave them alone.

## Testing

Run the `server/` unit tests with `pnpm exec vitest run --config
test/vitest.config.mjs` in `server/`, and verify changes with `npx eslint` on
the touched files too. `.github/workflows/server-tests.yml` runs them on every
push to `custom-patch-v2`; it reports only, the Docker workflow deploys either
way.

They mock the repositories, so they check the services' logic and nothing
about Postgres, sharp, ffmpeg or exiftool. They pass the same on Node 22 and
24, so they say nothing about a Node or base image upgrade.

A repository added to the `BaseService` constructor has to be added to
`newTestService` in `server/test/utils.ts` too, at the same position: its
arguments are positional, and one missing shifts every mock after it.

## Merging upstream

Production has about 40M search and face vectors, and many users' vectors are
archived to files (`../immich-devops/scripts/vector-archive.py`). A change that
recomputes them all takes many hours, so check each upstream merge for:

- **The default models**: `clip.modelName` and `facialRecognition.modelName` in
  `server/src/config.ts`. Immich saves only settings that differ from the
  defaults, so a new upstream default switches the model on every server that
  never changed it, with no setting changed: no guard refuses it, and new photos
  get vectors that don't match the old ones (`vector-archive.py restore` reads
  the image's defaults and leaves the old-model part out, but everyone else's
  vectors stay mixed). Both lines carry a `// fork: pinned` comment so such a
  change conflicts; keep our value when resolving it. The default can't be
  pinned in the settings instead, since a value equal to the default isn't
  saved.
- **The `leftJoin('smart_search', ...)` in `SearchRepository.searchSmart`**:
  upstream's is an `innerJoin`. Keep ours (the line carries a `// fork:`
  comment). With a left join the planner can't take the order from
  `clip_index`, so it reads the user's own photos and sorts them. With an inner
  join it can scan the index for all users and drop other owners' rows, and a
  small user gets too few results, with no error.
- **Migrations that touch `smart_search`, `face_search`, `clip_index` or
  `face_index`**: nothing checks migrations, and they run on every server.
- **Migrations dated before ours** (`1793048400000`, `1793580000000`):
  production refuses unordered migrations, so the server wouldn't start. Rename
  them to a later date.

More in `../immich-devops/docs/vector-index-capacity.md` ("What the fork turns
off").

## Related repos

- `../immich-devops` — private sibling repo tracking the devops side of this
  app's production deployment: deployment guides and runbooks (`docs/`),
  incident reports (`incidents/`), maintenance scripts (`scripts/`), and
  planning docs (`plans/`). Look there first for anything about the production
  server, database operations, backups, or monitoring.
