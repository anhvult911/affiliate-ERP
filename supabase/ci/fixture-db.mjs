/** Fresh in-memory Postgres for schema verification and offline demos. Never reads project credentials. */
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

export async function createFixtureDb() {
  const db = await PGlite.create({ extensions: { pg_trgm, pgcrypto } });
  const skipped = [];
  let rolesAvailable = true;
  try {
    await db.exec(`
      create schema auth;
      create schema extensions;
      create table auth.users (id uuid primary key default gen_random_uuid(), email text);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
    `);
    try {
      await db.exec('create role anon noinherit; create role authenticated noinherit; create role service_role noinherit bypassrls;');
    } catch {
      rolesAvailable = false;
    }
    for (const ext of ["pg_trgm", "pgcrypto"]) {
      try {
        await db.exec(`create extension if not exists "${ext}" with schema extensions`);
      } catch {
        skipped.push(`${ext} could not be relocated into the extensions schema`);
      }
    }

    const dir = new URL("../migrations/", import.meta.url);
    const sql = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()
      .map((name) => readFileSync(new URL(name, dir), "utf8")).join("\n")
      .replace(/create extension if not exists "vector"[^\n]*\r?\n/, "")
      .replace("embedding extensions.vector(768),", "embedding real[],")
      .replace(/create index products_embedding_hnsw_idx[\s\S]*?;\r?\n/, "")
      .replace(/create or replace function public\.match_products\([\s\S]*?\r?\n\$\$;\r?\n/, "")
      .replace(/revoke all on function public\.match_products[^\n]*\r?\n/, "")
      .replace(/grant execute on function public\.match_products[^\n]*\r?\n/, "");
    await db.exec(sql);
    skipped.push("pgvector type, products_embedding_hnsw_idx, match_products — verify on a pgvector/pgvector:pg16 container");
    return { db, skipped, rolesAvailable };
  } catch (error) {
    await db.close();
    throw error;
  }
}
