import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "asset" ADD "deviceFilePath" character varying;`.execute(db);
  await sql`ALTER TABLE "asset" ADD "isOriginalQuality" boolean NOT NULL DEFAULT false;`.execute(db);
  
  await sql`ALTER TABLE "user" ADD "sourceApp" character varying;`.execute(db);
  await sql`CREATE INDEX "user_sourceApp_idx" ON "user" ("sourceApp");`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX "user_sourceApp_idx";`.execute(db);
  await sql`ALTER TABLE "user" DROP COLUMN "sourceApp";`.execute(db);
  
  await sql`ALTER TABLE "asset" DROP COLUMN "isOriginalQuality";`.execute(db);
  await sql`ALTER TABLE "asset" DROP COLUMN "deviceFilePath";`.execute(db);
}
