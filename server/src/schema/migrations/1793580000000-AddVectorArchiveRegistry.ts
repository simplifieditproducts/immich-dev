import { Kysely, sql } from 'kysely';

// The registry of users whose search and face vectors immich-devops'
// scripts/vector-archive.py moved out of the database (idle free users), so
// queries here can leave them out (Smart Search "Missing" would otherwise
// recompute all their photos). The script creates the same table; IF NOT
// EXISTS keeps the one on servers it already ran on, with its rows.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS vector_archive;`.execute(db);
  await sql`CREATE TABLE IF NOT EXISTS vector_archive.users (
    "userId" uuid PRIMARY KEY,
    "lastActive" timestamptz NOT NULL,
    "clipCount" integer NOT NULL,
    "faceCount" integer NOT NULL,
    "clipModel" text NOT NULL,
    "faceModel" text NOT NULL,
    "files" text NOT NULL,
    "archivedAt" timestamptz NOT NULL DEFAULT now()
  );`.execute(db);
}

// Kept on the way down: it lists where archived users' vectors are.
export async function down(): Promise<void> {}
