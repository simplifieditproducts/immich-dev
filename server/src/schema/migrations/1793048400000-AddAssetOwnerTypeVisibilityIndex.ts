import { Kysely, sql } from 'kysely';

// Migrations run in one transaction, where CREATE INDEX CONCURRENTLY is not
// allowed, and a plain build blocks writes to "asset" for minutes on a large
// server. So the production servers get this index built by hand first with
// CREATE INDEX CONCURRENTLY, and IF NOT EXISTS makes this a no-op there.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE INDEX IF NOT EXISTS "asset_ownerId_type_visibility_idx" ON "asset" ("ownerId", "type", "visibility") WHERE ("deletedAt" IS NULL);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_asset_ownerId_type_visibility_idx', '{"type":"index","name":"asset_ownerId_type_visibility_idx","sql":"CREATE INDEX \\"asset_ownerId_type_visibility_idx\\" ON \\"asset\\" (\\"ownerId\\", \\"type\\", \\"visibility\\") WHERE (\\"deletedAt\\" IS NULL);"}'::jsonb);`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_asset_ownerId_type_visibility_idx';`.execute(db);
  await sql`DROP INDEX IF EXISTS "asset_ownerId_type_visibility_idx";`.execute(db);
}
