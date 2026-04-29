import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TYPE "contact_status_enum" AS ENUM ('active','unparsed');`.execute(db);

  await sql`CREATE TABLE "contact" (
    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
    "ownerId" uuid NOT NULL,
    "vcardHash" character varying NOT NULL,
    "contentHash" character varying,
    "status" contact_status_enum NOT NULL DEFAULT 'active',
    "displayName" character varying NOT NULL DEFAULT '',
    "firstName" character varying NOT NULL DEFAULT '',
    "lastName" character varying NOT NULL DEFAULT '',
    "organization" character varying,
    "title" character varying,
    "birthday" character varying,
    "notes" text,
    "avatar" text,
    "phones" jsonb NOT NULL DEFAULT '[]',
    "emails" jsonb NOT NULL DEFAULT '[]',
    "addresses" jsonb NOT NULL DEFAULT '[]',
    "vcardBlock" text NOT NULL,
    "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
    "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
    "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
    CONSTRAINT "contact_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT "contact_pkey" PRIMARY KEY ("id")
  );`.execute(db);

  await sql`CREATE INDEX "contact_ownerId_contentHash_idx" ON "contact" ("ownerId", "contentHash") WHERE ("status" = 'active');`.execute(db);
  await sql`CREATE UNIQUE INDEX "contact_ownerId_vcardHash_idx" ON "contact" ("ownerId", "vcardHash");`.execute(db);
  await sql`CREATE INDEX "contact_updateId_idx" ON "contact" ("updateId");`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "contact_updatedAt"
    BEFORE UPDATE ON "contact"
    FOR EACH ROW
    EXECUTE FUNCTION updated_at();`.execute(db);

  await sql`CREATE TABLE "contact_source" (
    "contactId" uuid NOT NULL,
    "deviceId" character varying NOT NULL,
    "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
    "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
    "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
    CONSTRAINT "contact_source_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT "contact_source_pkey" PRIMARY KEY ("contactId", "deviceId")
  );`.execute(db);

  await sql`CREATE INDEX "contact_source_deviceId_idx" ON "contact_source" ("deviceId");`.execute(db);
  await sql`CREATE INDEX "contact_source_updateId_idx" ON "contact_source" ("updateId");`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "contact_source_updatedAt"
    BEFORE UPDATE ON "contact_source"
    FOR EACH ROW
    EXECUTE FUNCTION updated_at();`.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES
    ('trigger_contact_updatedAt', '{"type":"trigger","name":"contact_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"contact_updatedAt\\"\\n  BEFORE UPDATE ON \\"contact\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb),
    ('index_contact_ownerId_contentHash_idx', '{"type":"index","name":"contact_ownerId_contentHash_idx","sql":"CREATE INDEX \\"contact_ownerId_contentHash_idx\\" ON \\"contact\\" (\\"ownerId\\", \\"contentHash\\") WHERE (\\"status\\" = ''active'');"}'::jsonb),
    ('trigger_contact_source_updatedAt', '{"type":"trigger","name":"contact_source_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"contact_source_updatedAt\\"\\n  BEFORE UPDATE ON \\"contact_source\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" IN (
    'trigger_contact_updatedAt',
    'index_contact_ownerId_contentHash_idx',
    'trigger_contact_source_updatedAt'
  );`.execute(db);
  await sql`DROP TABLE "contact_source";`.execute(db);
  await sql`DROP TABLE "contact";`.execute(db);
  await sql`DROP TYPE "contact_status_enum";`.execute(db);
}
