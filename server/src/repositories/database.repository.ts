import { Injectable } from '@nestjs/common';
import AsyncLock from 'async-lock';
import { FileMigrationProvider, Kysely, Migrator, sql, Transaction } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import semver from 'semver';
import {
  EXTENSION_NAMES,
  FULL_RERUN_MAX_ASSETS,
  POSTGRES_VERSION_RANGE,
  VECTOR_EXTENSIONS,
  VECTOR_INDEX_TABLES,
  VECTOR_RESET_MAX_ROWS,
  VECTOR_VERSION_RANGE,
  VECTORCHORD_LIST_SLACK_FACTOR,
  VECTORCHORD_VERSION_RANGE,
  VECTORS_VERSION_RANGE,
} from 'src/constants';
import { GenerateSql } from 'src/decorators';
import { DatabaseExtension, DatabaseLock, VectorIndex } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { ExtensionVersion, VectorExtension, VectorUpdateResult } from 'src/types';
import { vectorIndexQuery } from 'src/utils/database';
import { isValidInteger } from 'src/validation';

export let cachedVectorExtension: VectorExtension | undefined;
export async function getVectorExtension(runner: Kysely<DB>): Promise<VectorExtension> {
  if (cachedVectorExtension) {
    return cachedVectorExtension;
  }

  cachedVectorExtension = new ConfigRepository().getEnv().database.vectorExtension;
  if (cachedVectorExtension) {
    return cachedVectorExtension;
  }

  const query = `SELECT name FROM pg_available_extensions WHERE name IN (${VECTOR_EXTENSIONS.map((ext) => `'${ext}'`).join(', ')})`;
  const { rows: availableExtensions } = await sql.raw<{ name: VectorExtension }>(query).execute(runner);
  const extensionNames = new Set(availableExtensions.map((row) => row.name));
  cachedVectorExtension = VECTOR_EXTENSIONS.find((ext) => extensionNames.has(ext));
  if (!cachedVectorExtension) {
    throw new Error(`No vector extension found. Available extensions: ${VECTOR_EXTENSIONS.join(', ')}`);
  }
  return cachedVectorExtension;
}

export const probes: Record<VectorIndex, number> = {
  [VectorIndex.Clip]: 1,
  [VectorIndex.Face]: 1,
};

/** What the web UI may offer: a vector table reset each, and a rerun of every asset. */
type ResetChecks = Record<'smart_search' | 'face_search' | 'asset', boolean>;

@Injectable()
export class DatabaseRepository {
  private readonly asyncLock = new AsyncLock();

  constructor(
    @InjectKysely() private db: Kysely<DB>,
    private logger: LoggingRepository,
    private configRepository: ConfigRepository,
  ) {
    this.logger.setContext(DatabaseRepository.name);
  }

  async shutdown() {
    await this.db.destroy();
  }

  getVectorExtension(): Promise<VectorExtension> {
    return getVectorExtension(this.db);
  }

  @GenerateSql({ params: [[DatabaseExtension.Vectors]] })
  async getExtensionVersions(extensions: readonly DatabaseExtension[]): Promise<ExtensionVersion[]> {
    const { rows } = await sql<ExtensionVersion>`
      SELECT name, default_version as "availableVersion", installed_version as "installedVersion"
      FROM pg_available_extensions
      WHERE name in (${sql.join(extensions)})
    `.execute(this.db);
    return rows;
  }

  getExtensionVersionRange(extension: VectorExtension): string {
    switch (extension) {
      case DatabaseExtension.VectorChord: {
        return VECTORCHORD_VERSION_RANGE;
      }
      case DatabaseExtension.Vectors: {
        return VECTORS_VERSION_RANGE;
      }
      case DatabaseExtension.Vector: {
        return VECTOR_VERSION_RANGE;
      }
      default: {
        throw new Error(`Unsupported vector extension: '${extension}'`);
      }
    }
  }

  @GenerateSql()
  async getPostgresVersion(): Promise<string> {
    const { rows } = await sql<{ server_version: string }>`SHOW server_version`.execute(this.db);
    return rows[0].server_version;
  }

  getPostgresVersionRange(): string {
    return POSTGRES_VERSION_RANGE;
  }

  async createExtension(extension: DatabaseExtension): Promise<void> {
    this.logger.log(`Creating ${EXTENSION_NAMES[extension]} extension`);
    await sql`CREATE EXTENSION IF NOT EXISTS ${sql.raw(extension)} CASCADE`.execute(this.db);
    if (extension === DatabaseExtension.VectorChord) {
      const dbName = sql.id(await this.getDatabaseName());
      await sql`ALTER DATABASE ${dbName} SET vchordrq.probes = 1`.execute(this.db);
      await sql`SET vchordrq.probes = 1`.execute(this.db);
    }
  }

  async dropExtension(extension: DatabaseExtension): Promise<void> {
    this.logger.log(`Dropping ${EXTENSION_NAMES[extension]} extension`);
    await sql`DROP EXTENSION IF EXISTS ${sql.raw(extension)}`.execute(this.db);
  }

  async updateVectorExtension(extension: VectorExtension, targetVersion?: string): Promise<VectorUpdateResult> {
    const [{ availableVersion, installedVersion }] = await this.getExtensionVersions([extension]);
    if (!installedVersion) {
      throw new Error(`${EXTENSION_NAMES[extension]} extension is not installed`);
    }

    if (!availableVersion) {
      throw new Error(`No available version for ${EXTENSION_NAMES[extension]} extension`);
    }
    targetVersion ??= availableVersion;

    let restartRequired = false;
    const diff = semver.diff(installedVersion, targetVersion);
    if (!diff) {
      return { restartRequired: false };
    }

    // An update drops both vector indexes and rebuilds them, hours of work on
    // a large table. Refused before anything is dropped, which is all this
    // can do: a new image already runs the new library against the old
    // catalog. Images with another VectorChord are pinned and changed by hand
    // in a maintenance window (immich-devops docs/vector-index-capacity.md).
    for (const table of ['smart_search', 'face_search'] as const) {
      if (!(await this.canResetVectors(table))) {
        this.logger.error(
          `Not updating ${EXTENSION_NAMES[extension]} from ${installedVersion} to ${targetVersion}: the update ` +
            `drops and rebuilds both vector indexes, hours of work on large vector tables (or with users' vectors ` +
            `archived). Update it by hand in a maintenance window (immich-devops, docs/vector-index-capacity.md).`,
        );
        return { restartRequired: false };
      }
    }

    await Promise.all([
      this.db.schema.dropIndex(VectorIndex.Clip).ifExists().execute(),
      this.db.schema.dropIndex(VectorIndex.Face).ifExists().execute(),
    ]);

    await this.db.transaction().execute(async (tx) => {
      await this.setSearchPath(tx);

      await sql`ALTER EXTENSION ${sql.raw(extension)} UPDATE TO ${sql.lit(targetVersion)}`.execute(tx);

      if (extension === DatabaseExtension.Vectors && (diff === 'major' || diff === 'minor')) {
        await sql`SELECT pgvectors_upgrade()`.execute(tx);
        restartRequired = true;
      }
    });

    // Process indexes sequentially to avoid parallel reindex operations
    if (!restartRequired) {
      await this.reindexVectors(VectorIndex.Clip);
      await this.reindexVectors(VectorIndex.Face);
    }

    return { restartRequired };
  }

  /** How long Postgres has been up, its shared_buffers and each index's size, all in seconds and bytes. */
  async getPrewarmStats(indexes: VectorIndex[]): Promise<{
    uptime: number;
    sharedBuffers: number;
    sizes: Record<string, number | null>;
  }> {
    const { rows } = await sql<{ uptime: number; shared_buffers: string; sizes: Record<string, string | null> }>`
      SELECT
        extract(epoch FROM now() - pg_postmaster_start_time())::float8 AS uptime,
        pg_size_bytes(current_setting('shared_buffers'))::text AS shared_buffers,
        (
          SELECT json_object_agg(name, pg_relation_size(to_regclass(name))::text)
          FROM unnest(ARRAY[${sql.join(indexes)}]::text[]) AS name
        ) AS sizes
    `.execute(this.db);
    const { uptime, shared_buffers, sizes } = rows[0];
    return {
      uptime,
      sharedBuffers: Number(shared_buffers),
      sizes: Object.fromEntries(
        Object.entries(sizes).map(([name, size]) => [name, size === null ? null : Number(size)]),
      ),
    };
  }

  async prewarm(index: VectorIndex): Promise<void> {
    const vectorExtension = await getVectorExtension(this.db);
    if (vectorExtension !== DatabaseExtension.VectorChord) {
      return;
    }
    this.logger.log(`Prewarming ${index} started`);
    const result = await sql`SELECT vchordrq_prewarm(${index})`.execute(this.db);
    if (result.rows.length === 0) {
      this.logger.warn(`Prewarming ${index} returned no result`);
      return;
    }
    const output = (result.rows[0] as { vchordrq_prewarm?: string }).vchordrq_prewarm ?? '';
    const lines = output.split('\n').filter((line) => line.trim());
    this.logger.log(`Prewarming ${index} completed:\n${lines.join('\n')}`);
  }

  async reindexVectorsIfNeeded(names: VectorIndex[]): Promise<void> {
    this.logger.log(`reindexVectorsIfNeeded called for indexes: ${names.join(', ')}`);
    const { rows } = await sql<{
      indexdef: string;
      indexname: string;
    }>`SELECT indexdef, indexname FROM pg_indexes WHERE indexname = ANY(ARRAY[${sql.join(names)}])`.execute(this.db);

    this.logger.log(`Found ${rows.length} existing indexes: ${rows.map((r) => r.indexname).join(', ') || 'none'}`);

    const vectorExtension = await getVectorExtension(this.db);
    this.logger.log(`Active vector extension: ${vectorExtension}`);

    // Process indexes sequentially to avoid parallel reindex operations
    for (const indexName of names) {
      const row = rows.find((index) => index.indexname === indexName);
      const table = VECTOR_INDEX_TABLES[indexName];
      if (!row) {
        this.logger.warn(`Index ${indexName} does NOT exist - will reindex`);
        await this.reindexVectors(indexName);
        continue;
      }

      this.logger.log(`Index ${indexName} exists. Definition: ${row.indexdef}`);

      switch (vectorExtension) {
        case DatabaseExtension.Vector: {
          if (!row.indexdef.toLowerCase().includes('using hnsw')) {
            this.logger.log(`Index ${indexName} is not HNSW - will reindex`);
            await this.reindexVectors(indexName);
          }
          break;
        }
        case DatabaseExtension.Vectors: {
          if (!row.indexdef.toLowerCase().includes('using vectors')) {
            this.logger.log(`Index ${indexName} is not using vectors extension - will reindex`);
            await this.reindexVectors(indexName);
          }
          break;
        }
        case DatabaseExtension.VectorChord: {
          const matches = row.indexdef.match(/(?<=lists = \[)\d+/g);
          const lists = matches && matches.length > 0 ? Number(matches[0]) : 1;
          this.logger.log(`VectorChord check for ${indexName}: parsed lists=${lists} from indexdef`);

          const count = await this.getRowCount(table);
          const targetLists = this.targetListCount(count);
          const slackLists = this.targetListCount(count * VECTORCHORD_LIST_SLACK_FACTOR);
          const usesVchordrq = row.indexdef.toLowerCase().includes('using vchordrq');

          this.logger.log(
            `VectorChord ${indexName}: count=${count}, targetLists=${targetLists}, currentLists=${lists}, ` +
              `slackLists=${slackLists}, usesVchordrq=${usesVchordrq}`,
          );

          const needsReindexType = !usesVchordrq;
          const needsReindexLists = lists !== targetLists && lists !== slackLists;

          // Skip reindex for lists changes when current lists >= 4096
          // At this scale, reindexing takes hours and the marginal benefit is minimal
          // Only reindex if the index type is wrong (not using vchordrq)
          //
          // Let the system auto reindex when the number of vectors grows:
          // - At 1,024,000 rows → reindex to 2,048 lists (~15-30 min)
          // - At 2,048,000 rows → reindex to 4,096 lists (~15-30 min)
          // - Beyond 2M rows, auto-reindex is disabled. If needed, manually create
          //   the index in psql during a maintenance window.
          const skipListsReindex = lists >= 4096;
          if (skipListsReindex && needsReindexLists && !needsReindexType) {
            this.logger.warn(
              `VectorChord ${indexName}: lists mismatch (current: ${lists}, target: ${targetLists}) but skipping ` +
                `auto-reindex because current lists >= 4096. At this scale, reindexing takes hours. ` +
                `If you need optimal performance, manually run CREATE INDEX in psql during a maintenance window.`,
            );
            probes[indexName] = this.targetProbeCount(lists);
            break;
          }

          this.logger.log(
            `VectorChord ${indexName}: needsReindexType=${needsReindexType}, needsReindexLists=${needsReindexLists}`,
          );

          if (needsReindexType || needsReindexLists) {
            this.logger.warn(
              `VectorChord ${indexName}: WILL REINDEX - ` +
                `${needsReindexType ? 'wrong index type' : ''}${needsReindexType && needsReindexLists ? ' AND ' : ''}` +
                `${needsReindexLists ? `lists mismatch (${lists} != ${targetLists} and ${lists} != ${slackLists})` : ''}`,
            );
            const rebuilt = await this.reindexVectors(indexName, { lists: targetLists });
            probes[indexName] = this.targetProbeCount(rebuilt ? targetLists : lists);
          } else {
            this.logger.log(`VectorChord ${indexName}: index is OK, no reindex needed`);
            probes[indexName] = this.targetProbeCount(lists);
          }
          break;
        }
      }
    }
  }

  /**
   * Whether Immich may empty a whole vector table, drop and rebuild its index
   * or recompute it with another model: with IMMICH_ALLOW_VECTOR_RESET, or
   * while the table is small and no user's vectors are archived (a reset
   * would recompute them, and their archived vectors would no longer fit).
   */
  async canResetVectors(table: 'smart_search' | 'face_search', db: Kysely<DB> = this.db): Promise<boolean> {
    if (this.configRepository.getEnv().database.allowVectorReset) {
      return true;
    }
    if (await this.hasArchivedVectorUsers(db)) {
      return false;
    }
    return (await this.countVectorsUpTo(table, VECTOR_RESET_MAX_ROWS, db)) < VECTOR_RESET_MAX_ROWS;
  }

  private vectorResetCache?: { until: number; value: ResetChecks };
  private vectorResetCheck?: Promise<ResetChecks>;

  /**
   * canResetVectors for both tables and canRerunAllAssets (asset), at most
   * 10 minutes old: for the web UI,
   * which greys out what the guards would refuse. The guards themselves
   * always ask afresh. It backs /server/features, which every client loads
   * at start, so it never fails or waits long: on an error, a lock or after
   * 3 seconds it says no (greyed out) and asks again 30 seconds later. One
   * check at a time, and one that never ends (postgres.js reserve(),
   * immich-dev#9) isn't started again.
   */
  async canResetVectorsCached(): Promise<ResetChecks> {
    if (!this.vectorResetCache || Date.now() > this.vectorResetCache.until) {
      this.vectorResetCheck ??= this.canResetVectorsWithin('2s').finally(() => {
        this.vectorResetCheck = undefined;
      });
      let timer: NodeJS.Timeout | undefined;
      try {
        const value = await Promise.race([
          this.vectorResetCheck,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('timed out after 3s')), 3000);
          }),
        ]);
        this.vectorResetCache = { until: Date.now() + 10 * 60 * 1000, value };
      } catch (error) {
        this.logger.warn(`Could not check whether the vector tables may be reset, treating them as locked: ${error}`);
        this.vectorResetCache = {
          until: Date.now() + 30 * 1000,
          value: { smart_search: false, face_search: false, asset: false },
        };
      } finally {
        clearTimeout(timer);
      }
    }
    return this.vectorResetCache.value;
  }

  /** The checks of canResetVectorsCached, each statement and lock wait at most timeout. */
  async canResetVectorsWithin(timeout: string): Promise<ResetChecks> {
    return this.db.transaction().execute(async (trx) => {
      await sql`SELECT set_config('lock_timeout', ${timeout}, true), set_config('statement_timeout', ${timeout}, true)`.execute(
        trx,
      );
      return {
        smart_search: await this.canResetVectors('smart_search', trx),
        face_search: await this.canResetVectors('face_search', trx),
        asset: await this.canRerunAllAssets(trx),
      };
    });
  }

  /**
   * Whether Immich may go through every photo and video again (the "All" of
   * thumbnails, metadata, video, OCR and sidecars, the file and storage
   * template migrations): with IMMICH_ALLOW_FULL_RERUN, or while the server
   * has fewer than FULL_RERUN_MAX_ASSETS (counted only that far).
   */
  async canRerunAllAssets(db: Kysely<DB> = this.db): Promise<boolean> {
    if (this.configRepository.getEnv().database.allowFullRerun) {
      return true;
    }
    const { rows } = await sql<{ count: number }>`
      SELECT count(*)::int AS count FROM (SELECT 1 FROM asset LIMIT ${FULL_RERUN_MAX_ASSETS}) t
    `.execute(db);
    return rows[0].count < FULL_RERUN_MAX_ASSETS;
  }

  /** Whether immich-devops' vector-archive.py lists any user as archived. */
  async hasArchivedVectorUsers(db: Kysely<DB> = this.db): Promise<boolean> {
    // The table comes from a migration, but this can run before migrations
    // (the vector index checks at start).
    const { rows: found } = await sql<{ name: string | null }>`
      SELECT to_regclass('vector_archive.users')::text AS name
    `.execute(db);
    if (!found[0].name) {
      return false;
    }
    const { rows } = await sql<{ archived: boolean }>`
      SELECT exists (SELECT 1 FROM vector_archive.users) AS archived
    `.execute(db);
    return rows[0].archived;
  }

  /** Whether vector-archive.py holds face vectors of this user (not restored yet). */
  async hasArchivedFaces(userId: string): Promise<boolean> {
    const { rows } = await sql<{ archived: boolean }>`
      SELECT exists (SELECT 1 FROM vector_archive.users WHERE "userId" = ${userId} AND "faceCount" > 0) AS archived
    `.execute(this.db);
    return rows[0].archived;
  }

  /** The table's row count, counted up to max only (cheap on big tables). */
  async countVectorsUpTo(
    table: 'smart_search' | 'face_search',
    max: number,
    db: Kysely<DB> = this.db,
  ): Promise<number> {
    // Not pg_class.reltuples: CREATE INDEX CONCURRENTLY with vchordrq has
    // left it at 0 on a table of 39M rows.
    const { rows } = await sql<{ count: number }>`
      SELECT count(*)::int AS count FROM (SELECT 1 FROM ${sql.table(table)} LIMIT ${max}) t
    `.execute(db);
    return rows[0].count;
  }

  /** Rebuilds a vector index in place; false when it was left alone. */
  private async reindexVectors(indexName: VectorIndex, { lists }: { lists?: number } = {}): Promise<boolean> {
    const table = VECTOR_INDEX_TABLES[indexName];
    const vectorExtension = await getVectorExtension(this.db);

    const { rows } = await sql<{
      columnName: string;
    }>`SELECT column_name as "columnName" FROM information_schema.columns WHERE table_name = ${table}`.execute(this.db);
    if (rows.length === 0) {
      this.logger.warn(
        `Table ${table} does not exist, skipping reindexing. This is only normal if this is a new Immich instance.`,
      );
      return false;
    }
    // A plain rebuild of a large index takes hours, blocks searches meanwhile
    // and can run the server out of memory (its k-means sample); a large one
    // is rebuilt by hand, concurrently, instead.
    if (!(await this.canResetVectors(table))) {
      this.logger.error(
        `Not rebuilding ${indexName}: ${table} is large (100,000 rows or more) or users' vectors are archived. ` +
          `Rebuild it by hand ` +
          `(immich-devops, docs/vector-index-capacity.md, "Rebuilding the indexes"), ` +
          `or set IMMICH_ALLOW_VECTOR_RESET=true and restart.`,
      );
      return false;
    }
    this.logger.log(`Reindexing ${indexName} (This may take a while, do not restart)`);
    const dimSize = await this.getDimensionSize(table);
    lists ||= this.targetListCount(await this.getRowCount(table));

    // All index operations are inside the transaction to ensure atomicity.
    // If CREATE INDEX fails, the DROP INDEX is also rolled back.
    await this.db.transaction().execute(async (tx) => {
      await sql`DROP INDEX IF EXISTS ${sql.raw(indexName)}`.execute(tx);
      if (table === 'smart_search') {
        await sql`ALTER TABLE ${sql.raw(table)} DROP CONSTRAINT IF EXISTS dim_size_constraint`.execute(tx);
      }
      if (!rows.some((row) => row.columnName === 'embedding')) {
        this.logger.warn(`Column 'embedding' does not exist in table '${table}', truncating and adding column.`);
        await sql`TRUNCATE TABLE ${sql.raw(table)}`.execute(tx);
        await sql`ALTER TABLE ${sql.raw(table)} ADD COLUMN embedding real[] NOT NULL`.execute(tx);
      }
      await sql`ALTER TABLE ${sql.raw(table)} ALTER COLUMN embedding SET DATA TYPE real[]`.execute(tx);
      const schema = vectorExtension === DatabaseExtension.Vectors ? 'vectors.' : '';
      await sql`
        ALTER TABLE ${sql.raw(table)}
        ALTER COLUMN embedding
        SET DATA TYPE ${sql.raw(schema)}vector(${sql.raw(String(dimSize))})`.execute(tx);
      await sql.raw(vectorIndexQuery({ vectorExtension, table, indexName, lists })).execute(tx);
    });
    try {
      await sql`VACUUM ANALYZE ${sql.raw(table)}`.execute(this.db);
    } catch (error: any) {
      this.logger.warn(`Failed to vacuum table '${table}'. The DB will temporarily use more disk space: ${error}`);
    }
    this.logger.log(`Reindexed ${indexName}`);
    return true;
  }

  private async setSearchPath(tx: Transaction<DB>): Promise<void> {
    await sql`SET search_path TO "$user", public, vectors`.execute(tx);
  }

  private async getDatabaseName(): Promise<string> {
    const { rows } = await sql<{ db: string }>`SELECT current_database() as db`.execute(this.db);
    return rows[0].db;
  }

  async getDimensionSize(table: string, column = 'embedding'): Promise<number> {
    const { rows } = await sql<{ dimsize: number }>`
      SELECT atttypmod as dimsize
      FROM pg_attribute f
        JOIN pg_class c ON c.oid = f.attrelid
      WHERE c.relkind = 'r'::char
        AND f.attnum > 0
        AND c.relname = ${table}::text
        AND f.attname = ${column}::text
    `.execute(this.db);

    const dimSize = rows[0]?.dimsize;
    if (!isValidInteger(dimSize, { min: 1, max: 2 ** 16 })) {
      this.logger.warn(`Could not retrieve dimension size of column '${column}' in table '${table}', assuming 512`);
      return 512;
    }
    return dimSize;
  }

  async setDimensionSize(dimSize: number): Promise<void> {
    if (!isValidInteger(dimSize, { min: 1, max: 2 ** 16 })) {
      throw new Error(`Invalid CLIP dimension size: ${dimSize}`);
    }

    // this is done in two transactions to handle concurrent writes
    await this.db.transaction().execute(async (trx) => {
      await sql`delete from ${sql.table('smart_search')}`.execute(trx);
      await trx.schema.alterTable('smart_search').dropConstraint('dim_size_constraint').ifExists().execute();
      await sql`alter table ${sql.table('smart_search')} add constraint dim_size_constraint check (array_length(embedding::real[], 1) = ${sql.lit(dimSize)})`.execute(
        trx,
      );
    });

    const vectorExtension = await this.getVectorExtension();
    await this.db.transaction().execute(async (trx) => {
      await sql`drop index if exists clip_index`.execute(trx);
      await trx.schema
        .alterTable('smart_search')
        .alterColumn('embedding', (col) => col.setDataType(sql.raw(`vector(${dimSize})`)))
        .execute();
      await sql
        .raw(vectorIndexQuery({ vectorExtension, table: 'smart_search', indexName: VectorIndex.Clip }))
        .execute(trx);
      await trx.schema.alterTable('smart_search').dropConstraint('dim_size_constraint').ifExists().execute();
    });
    probes[VectorIndex.Clip] = 1;

    await sql`vacuum analyze ${sql.table('smart_search')}`.execute(this.db);
  }

  async deleteAllSearchEmbeddings(): Promise<void> {
    await sql`truncate ${sql.table('smart_search')}`.execute(this.db);
  }

  private targetListCount(count: number) {
    if (count < 128_000) {
      return 1;
    } else if (count < 2_048_000) {
      return 1 << (32 - Math.clz32(count / 1000));
    } else {
      return 1 << (33 - Math.clz32(Math.sqrt(count)));
    }
  }

  private targetProbeCount(lists: number) {
    return Math.ceil(lists / 8);
  }

  private async getRowCount(table: keyof DB): Promise<number> {
    const { count } = await this.db
      .selectFrom(this.db.dynamic.table(table).as('t'))
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    return count;
  }

  async runMigrations(): Promise<void> {
    this.logger.debug('Running migrations');

    const migrator = this.createMigrator();

    const { error, results } = await migrator.migrateToLatest();

    for (const result of results ?? []) {
      if (result.status === 'Success') {
        this.logger.log(`Migration "${result.migrationName}" succeeded`);
      }

      if (result.status === 'Error') {
        this.logger.warn(`Migration "${result.migrationName}" failed`);
      }
    }

    if (error) {
      this.logger.error(`Migrations failed: ${error}`);
      throw error;
    }

    this.logger.debug('Finished running migrations');
  }

  async migrateFilePaths(sourceFolder: string, targetFolder: string): Promise<void> {
    // remove trailing slashes
    if (sourceFolder.endsWith('/')) {
      sourceFolder = sourceFolder.slice(0, -1);
    }

    if (targetFolder.endsWith('/')) {
      targetFolder = targetFolder.slice(0, -1);
    }

    // escaping regex special characters with a backslash
    const sourceRegex = '^' + sourceFolder.replaceAll(/[-[\]{}()*+?.,\\^$|#\s]/g, String.raw`\$&`);
    const source = sql.raw(`'${sourceRegex}'`);
    const target = sql.lit(targetFolder);

    await this.db.transaction().execute(async (tx) => {
      await tx
        .updateTable('asset')
        .set((eb) => ({
          originalPath: eb.fn('REGEXP_REPLACE', ['originalPath', source, target]),
          encodedVideoPath: eb.fn('REGEXP_REPLACE', ['encodedVideoPath', source, target]),
        }))
        .execute();

      await tx
        .updateTable('asset_file')
        .set((eb) => ({ path: eb.fn('REGEXP_REPLACE', ['path', source, target]) }))
        .execute();

      await tx
        .updateTable('person')
        .set((eb) => ({ thumbnailPath: eb.fn('REGEXP_REPLACE', ['thumbnailPath', source, target]) }))
        .execute();

      await tx
        .updateTable('user')
        .set((eb) => ({ profileImagePath: eb.fn('REGEXP_REPLACE', ['profileImagePath', source, target]) }))
        .execute();
    });
  }

  async withLock<R>(lock: DatabaseLock, callback: () => Promise<R>): Promise<R> {
    let res;
    await this.asyncLock.acquire(DatabaseLock[lock], async () => {
      await this.db.connection().execute(async (connection) => {
        try {
          await this.acquireLock(lock, connection);
          res = await callback();
        } finally {
          await this.releaseLock(lock, connection);
        }
      });
    });

    return res as R;
  }

  async withTryLock<R>(lock: DatabaseLock, callback: () => Promise<R>): Promise<{ acquired: boolean; result?: R }> {
    if (this.asyncLock.isBusy(DatabaseLock[lock])) {
      return { acquired: false };
    }

    let res: { acquired: boolean; result?: R } = { acquired: false };
    await this.asyncLock.acquire(DatabaseLock[lock], async () => {
      await this.db.connection().execute(async (connection) => {
        const acquired = await this.acquireTryLock(lock, connection);
        if (!acquired) {
          return;
        }

        try {
          res = { acquired: true, result: await callback() };
        } finally {
          await this.releaseLock(lock, connection);
        }
      });
    });

    return res;
  }

  async withUuidLock<R>(uuid: string, callback: () => Promise<R>): Promise<R> {
    let res;
    await this.db.connection().execute(async (connection) => {
      await this.acquireUuidLock(uuid, connection);
      try {
        res = await callback();
      } finally {
        await this.releaseUuidLock(uuid, connection);
      }
    });

    return res as R;
  }

  tryLock(lock: DatabaseLock): Promise<boolean> {
    return this.db.connection().execute(async (connection) => this.acquireTryLock(lock, connection));
  }

  isBusy(lock: DatabaseLock): boolean {
    return this.asyncLock.isBusy(DatabaseLock[lock]);
  }

  async wait(lock: DatabaseLock): Promise<void> {
    await this.asyncLock.acquire(DatabaseLock[lock], () => {});
  }

  private async acquireLock(lock: DatabaseLock, connection: Kysely<DB>): Promise<void> {
    await sql`SELECT pg_advisory_lock(${lock})`.execute(connection);
  }

  private async acquireUuidLock(uuid: string, connection: Kysely<DB>): Promise<void> {
    // Advisory locks are session-scoped: a holder whose request hangs keeps the lock
    // indefinitely, and every unbounded waiter pins a pooled connection. On 2026-08-05
    // waiters behind one stuck upload exhausted the API pool and took the server down,
    // so fail fast instead of queueing forever.
    await sql`SET lock_timeout = '10s'`.execute(connection);
    try {
      await sql`SELECT pg_advisory_lock(uuid_hash_extended(${uuid}, 0))`.execute(connection);
    } finally {
      await sql`SET lock_timeout = DEFAULT`.execute(connection);
    }
  }

  private async acquireTryLock(lock: DatabaseLock, connection: Kysely<DB>): Promise<boolean> {
    const { rows } = await sql<{
      pg_try_advisory_lock: boolean;
    }>`SELECT pg_try_advisory_lock(${lock})`.execute(connection);
    return rows[0].pg_try_advisory_lock;
  }

  private async releaseLock(lock: DatabaseLock, connection: Kysely<DB>): Promise<void> {
    await sql`SELECT pg_advisory_unlock(${lock})`.execute(connection);
  }

  async revertLastMigration(): Promise<string | undefined> {
    this.logger.debug('Reverting last migration');

    const migrator = this.createMigrator();
    const { error, results } = await migrator.migrateDown();

    for (const result of results ?? []) {
      if (result.status === 'Success') {
        this.logger.log(`Reverted migration "${result.migrationName}"`);
      }

      if (result.status === 'Error') {
        this.logger.warn(`Failed to revert migration "${result.migrationName}"`);
      }
    }

    if (error) {
      this.logger.error(`Failed to revert migrations: ${error}`);
      throw error;
    }

    const reverted = results?.find((result) => result.direction === 'Down' && result.status === 'Success');
    if (!reverted) {
      this.logger.debug('No migrations to revert');
      return undefined;
    }

    this.logger.debug('Finished reverting migration');
    return reverted.migrationName;
  }

  private createMigrator(): Migrator {
    return new Migrator({
      db: this.db,
      migrationLockTableName: 'kysely_migrations_lock',
      allowUnorderedMigrations: this.configRepository.isDev(),
      migrationTableName: 'kysely_migrations',
      provider: new FileMigrationProvider({
        fs: { readdir },
        path: { join },
        // eslint-disable-next-line unicorn/prefer-module
        migrationFolder: join(__dirname, '..', 'schema/migrations'),
      }),
    });
  }

  private async releaseUuidLock(uuid: string, connection: Kysely<DB>): Promise<void> {
    await sql`SELECT pg_advisory_unlock(uuid_hash_extended(${uuid}, 0))`.execute(connection);
  }
}
