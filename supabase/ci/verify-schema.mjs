#!/usr/bin/env node
/**
 * Schema verification without Docker:  pnpm verify:schema
 *
 * Runs supabase/migrations/20261020090000_init_schema.sql and supabase/seed.sql
 * against a real Postgres engine (PGlite = Postgres compiled to WebAssembly) and
 * asserts the behaviour the app depends on:
 *
 *   - every table/constraint/view/function/trigger is accepted by the planner
 *   - the analytics RPCs return the right money for the seed (canceled orders
 *     excluded, unattributed postbacks bucketed, series zero-filled to today)
 *   - claim_comment_tasks() takes queued work, reclaims a stale lease, and
 *     refuses tasks whose account is checkpointed/cooling or has no product
 *   - the SECURITY DEFINER worker RPCs are NOT executable by anon/authenticated
 *
 * This complements, and does not replace, supabase/ci/rls_check.sql (row-level
 * RLS under `set role`) against a full Supabase stack — run that one via
 * `npx supabase start` when Docker is available.
 *
 * LIMITATION, reported at the end of every run: PGlite bundles pg_trgm and
 * pgcrypto but not pgvector, so the `products.embedding` column, its HNSW index
 * and public.match_products() are filtered out. Verify those on a real
 * pgvector-enabled Postgres (any `pgvector/pgvector:pg16` container).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const migrationsDir = join(repoRoot, "supabase", "migrations");
const seedFile = join(repoRoot, "supabase", "seed.sql");

// Every migration, in filename order — exactly what `supabase db reset` runs.
const migrationFiles = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => join(migrationsDir, name));

const results = [];
const skipped = [];
let failed = 0;

function record(name, pass, detail = "") {
  results.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failed += 1;
}

function eq(name, actual, expected) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  record(name, same, same ? "" : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

const db = await PGlite.create({ extensions: { pg_trgm, pgcrypto } });
const exec = (sql) => db.exec(sql);
const rows = async (sql) => (await db.query(sql)).rows;
const scalar = async (sql) => Object.values((await rows(sql))[0] ?? {})[0];

/* ---------------------------------------------------------- Supabase surface */
await exec(`create schema if not exists auth; create schema if not exists extensions;`);
await exec(`
  create table if not exists auth.users (
    id uuid primary key default gen_random_uuid(),
    email text
  );
  create or replace function auth.uid() returns uuid
  language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`);

let rolesAvailable = true;
try {
  await exec(
    `create role anon noinherit;
     create role authenticated noinherit;
     create role service_role noinherit bypassrls;`
  );
} catch {
  rolesAvailable = false;
}

for (const [label, ext] of [
  ["pg_trgm", "pg_trgm"],
  ["pgcrypto", "pgcrypto"]
]) {
  try {
    await exec(`create extension if not exists "${ext}" with schema extensions`);
  } catch {
    skipped.push(`${label} could not be relocated into the extensions schema`);
  }
}

/* --------------------------------------------------------- migration + seed */
let migration = migrationFiles.map((file) => readFileSync(file, "utf8")).join("\n");

// pgvector is not bundled here; drop exactly what needs it and report it.
migration = migration
  .replace(/create extension if not exists "vector"[^\n]*\r?\n/, "")
  .replace(/\r?\n\s*embedding extensions\.vector\(768\),/, "\n")
  .replace(/create index products_embedding_hnsw_idx[\s\S]*?;\r?\n/, "")
  .replace(/create or replace function public\.match_products\([\s\S]*?\r?\n\$\$;\r?\n/, "")
  .replace(/revoke all on function public\.match_products[^\n]*\r?\n/, "")
  .replace(/grant execute on function public\.match_products[^\n]*\r?\n/, "");
skipped.push(
  "pgvector statements (create extension vector, products.embedding, products_embedding_hnsw_idx, match_products) — verify on a pgvector/pgvector:pg16 container"
);

try {
  await exec(migration);
  record("migration applies cleanly", true);
} catch (error) {
  record("migration applies cleanly", false, String(error.message).split("\n")[0]);
  report();
  process.exit(1);
}

await exec(readFileSync(seedFile, "utf8"));
record("seed applies cleanly", true);

/* --------------------------------------------------------------- invariants */
eq(
  "seeded task statuses",
  await rows(`select status::text, count(*)::int as n from public.comment_tasks group by 1 order by 1`),
  [
    { status: "completed", n: 1 },
    { status: "failed", n: 1 },
    { status: "pending_approval", n: 2 },
    { status: "queued", n: 1 },
    { status: "rejected", n: 1 }
  ]
);

/* ------------------------------------------------- 2-tier seeding fixture */
const seeding = (
  await rows(`select assigned_account_id, secondary_account_id from public.comment_tasks where execution_mode = 'seeding_2_accounts'`)
)[0];
record("demo 2-tier task has two distinct accounts", Boolean(seeding) && seeding.assigned_account_id !== seeding.secondary_account_id);
eq(
  "both 2-tier accounts can post",
  await rows(`select count(*)::int as n from public.social_accounts
               where id in ('${seeding.assigned_account_id}', '${seeding.secondary_account_id}')
                 and status = 'active' and browser_profile_id is not null`),
  [{ n: 2 }]
);

/* ------------------------------------------------------------- analytics RPCs */
eq(
  "analytics_summary excludes canceled orders",
  await rows(`select revenue::float, commission::float, settled_commission::float, pending_commission::float,
                     canceled_commission::float, orders::int, tasks_executed::int, tasks_with_orders::int
                from public.analytics_summary(null)`),
  [
    {
      revenue: 574000,
      commission: 55585,
      settled_commission: 32250,
      pending_commission: 23335,
      canceled_commission: 103200,
      orders: 2,
      // Only the seeded completed task carries an executed_at; the queued task
      // that owns an order is not part of the executed population, so the ratio
      // stays bounded (1/1, never 2/1).
      tasks_executed: 1,
      tasks_with_orders: 1
    }
  ]
);

const today = await scalar(`select current_date::text`);
const lastRevenueDay = await scalar(
  `select max((converted_at at time zone 'UTC')::date)::text from public.affiliate_conversions where status <> 'canceled'`
);
const series = await rows(`select day::text, revenue::float from public.analytics_revenue_series(null)`);
record("revenue series is ascending", JSON.stringify(series.map((r) => r.day)) === JSON.stringify([...series.map((r) => r.day)].sort()), `${series.length} day(s)`);
// The series ends on the last day that actually earned — capped at today, never
// extended into the future. Asserting "ends today" would flake whenever the last
// conversion happened before the current UTC day.
record("revenue series ends on the last revenue day", series.at(-1)?.day === lastRevenueDay, `last=${series.at(-1)?.day} expected=${lastRevenueDay}`);
record("revenue series never reaches into the future", series.every((r) => r.day <= today));
eq("revenue series total matches the summary", series.reduce((sum, r) => sum + r.revenue, 0), 574000);

eq(
  "by_source attributes on conversion time",
  (await rows(`select label, revenue::float from public.analytics_by_source(null) where revenue > 0 order by revenue desc`)),
  [
    { label: "KOL Review Đồ Gia Dụng", revenue: 359000 },
    { label: "Hội Mẹ Bỉm Sữa Săn Deal", revenue: 215000 }
  ]
);

await exec(`
  insert into public.affiliate_conversions (sub_id, external_order_id, order_amount, estimated_commission, status)
  values ('T-NOTASK', 'SP-NOTASK-1', 100000, 10000, 'pending')
`);
record(
  "unattributed postback gets its own bucket",
  (await rows(`select label from public.analytics_by_source(null)`)).some((r) => r.label === "Unattributed")
);
eq(
  "unattributed revenue is not lost",
  (await rows(`select revenue::float as revenue, orders::int as orders from public.analytics_summary(null)`))[0],
  { revenue: 674000, orders: 3 }
);

eq(
  "v_task_roi excludes canceled from orders",
  (await rows(`select orders::int from public.v_task_roi where task_id = 'cccc5555-5555-4555-8555-555555555555'`))[0],
  { orders: 0 }
);
record(
  "task_roi row set is conversion-driven",
  (await rows(`select count(*)::int as n from public.analytics_task_roi(null)`))[0].n === 3
);

/* ----------------------------------------------------------- claim + leases */
eq(
  "claim takes the queued task",
  await rows(`select status::text, claimed_by, attempt_count from public.claim_comment_tasks('smoke', 5)`),
  [{ status: "running", claimed_by: "smoke", attempt_count: 1 }]
);

await exec(`update public.comment_tasks set claimed_at = now() - interval '20 minutes' where status = 'running'`);
eq(
  "stale claim is reclaimed (attempt counted)",
  await rows(`select status::text, claimed_by, attempt_count from public.claim_comment_tasks('smoke-2', 5)`),
  [{ status: "running", claimed_by: "smoke-2", attempt_count: 2 }]
);

/* ------------------------------------------- claim: seeding arm of the predicate */
const SEEDING_TASK = "cccc2222-2222-4222-8222-222222222222";
await exec(`update public.comment_tasks set status = 'queued', claimed_at = null, claimed_by = null,
                   matched_product_id = 'bbbb2222-2222-4222-8222-222222222222' where id = '${SEEDING_TASK}'`);
const seedingClaim = await rows(`select id::text from public.claim_comment_tasks('smoke-seed', 5)`);
record(
  "2-tier task is claimable while both accounts are healthy",
  seedingClaim.length === 1 && seedingClaim[0].id === SEEDING_TASK,
  JSON.stringify(seedingClaim)
);

await exec(`update public.social_accounts set status = 'checkpoint' where id = '11111111-1111-4111-8111-111111111111'`);
await exec(`update public.comment_tasks set status = 'queued', claimed_at = null, claimed_by = null where id = '${SEEDING_TASK}'`);
eq(
  "2-tier task is withheld when the tier-2 account is blocked",
  (await rows(`select id from public.claim_comment_tasks('smoke-seed', 5)`)).length,
  0
);
await exec(`update public.comment_tasks set status = 'pending_approval', claimed_at = null, claimed_by = null where id = '${SEEDING_TASK}'`);

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const TASK = "cccc1111-1111-4111-8111-111111111111";

await exec(`update public.social_accounts set status = 'checkpoint' where id = '${ACCOUNT}'`);
await exec(`update public.comment_tasks set status = 'queued', claimed_at = null, claimed_by = null where id = '${TASK}'`);
eq("checkpointed account is not claimable", (await rows(`select id from public.claim_comment_tasks('smoke', 5)`)).length, 0);

await exec(`update public.social_accounts set status = 'cooldown', cooldown_until = now() + interval '2 hours' where id = '${ACCOUNT}'`);
eq("cooling account is not claimable", (await rows(`select id from public.claim_comment_tasks('smoke', 5)`)).length, 0);

await exec(`update public.social_accounts set status = 'active', cooldown_until = null where id = '${ACCOUNT}'`);
eq("healthy account becomes claimable again", (await rows(`select id from public.claim_comment_tasks('smoke', 5)`)).length, 1);

await exec(`update public.comment_tasks set status = 'queued', matched_product_id = null where id = '${TASK}'`);
eq("task without a matched product is not claimable", (await rows(`select id from public.claim_comment_tasks('smoke', 5)`)).length, 0);

/* ------------------------------------------------- volume + rhythm limits */
await exec(`update public.comment_tasks set status = 'queued', matched_product_id = 'bbbb1111-1111-4111-8111-111111111111' where id = '${TASK}'`);
await exec(`update public.social_accounts set status = 'active', cooldown_until = null, last_action_at = null where id = '${ACCOUNT}'`);
eq("healthy account with headroom is claimable", (await rows(`select id from public.claim_comment_tasks('gap', 5)`)).length, 1);

// rhythm: an action just happened, so nothing may be claimed yet
await exec(`update public.comment_tasks set status = 'queued', claimed_at = null, claimed_by = null where id = '${TASK}'`);
await exec(`update public.social_accounts set last_action_at = now() where id = '${ACCOUNT}'`);
eq("action gap blocks a second claim", (await rows(`select id from public.claim_comment_tasks('gap', 5)`)).length, 0);

await exec(`update public.social_accounts set last_action_at = now() - interval '2 hours' where id = '${ACCOUNT}'`);
eq("claim resumes once the gap has passed", (await rows(`select id from public.claim_comment_tasks('gap', 5)`)).length, 1);

// volume: filling the rolling window stops the account for the rest of it
const completedBefore = await scalar(
  `select count(*)::int from public.comment_tasks
    where assigned_account_id = '${ACCOUNT}' and status = 'completed'
      and executed_at >= now() - interval '24 hours'`
);

await exec(`
  insert into public.comment_tasks (status, assigned_account_id, matched_product_id, post_url, executed_at, created_at)
  select 'completed', '${ACCOUNT}', 'bbbb1111-1111-4111-8111-111111111111',
         'https://www.facebook.com/groups/limit/posts/' || g, now(), now()
    from generate_series(1, 8) g
`);
await exec(`update public.comment_tasks set status = 'queued', claimed_at = null, claimed_by = null where id = '${TASK}'`);

eq("daily comment limit stops the claim", (await rows(`select id from public.claim_comment_tasks('cap', 5)`)).length, 0);
eq(
  "usage view counts the rolling window",
  (await scalar(`select comments_24h from public.v_account_daily_usage where account_id = '${ACCOUNT}'`)),
  completedBefore + 8
);

await exec(`update public.social_accounts set daily_comment_limit = 20 where id = '${ACCOUNT}'`);
eq("raising the limit lets the queue move again", (await rows(`select id from public.claim_comment_tasks('cap', 5)`)).length, 1);

await exec(`
  delete from public.comment_tasks
   where assigned_account_id = '${ACCOUNT}'
     and post_url like '%/groups/limit/posts/%'
`);
await exec(`update public.social_accounts set daily_comment_limit = 8, last_action_at = null where id = '${ACCOUNT}'`);

/* ------------------------------------------------------------ view integrity */
await exec(`
  insert into public.affiliate_conversions (task_id, sub_id, external_order_id, order_amount, estimated_commission, status)
  values ('cccc4444-4444-4444-8444-444444444444', 'T-7B0C42', 'SP-EXTRA-1', 50000, 5000, 'settled')
`);
// Account 1111 owns cccc3333 (359,000 pending) and cccc4444 (215,000 + 50,000 added above).
eq(
  "comments_published is not multiplied by orders",
  (await rows(`select comments_published::int, revenue::float from public.v_account_performance where account_id = '${ACCOUNT}'`))[0],
  { comments_published: 1, revenue: 624000 }
);

/* --------------------------------------------------------------- RPC grants */
if (rolesAvailable) {
  const canExecute = async (role, fn) =>
    (await scalar(`select has_function_privilege('${role}', '${fn}', 'execute')::text`)) === "true";

  record("anon cannot execute claim_comment_tasks", !(await canExecute("anon", "public.claim_comment_tasks(text,int)")));
  record("authenticated cannot execute claim_comment_tasks", !(await canExecute("authenticated", "public.claim_comment_tasks(text,int)")));
  record("service_role can execute claim_comment_tasks", await canExecute("service_role", "public.claim_comment_tasks(text,int)"));
  record("anon cannot execute the analytics RPCs", !(await canExecute("anon", "public.analytics_summary(timestamptz)")));
  record("anon cannot execute sweep_stuck_tasks", !(await canExecute("anon", "public.sweep_stuck_tasks(int)")));
  record("authenticated cannot execute sweep_stuck_tasks", !(await canExecute("authenticated", "public.sweep_stuck_tasks(int)")));
  record("authenticated can execute the analytics RPCs", await canExecute("authenticated", "public.analytics_summary(timestamptz)"));
  record("authenticated keeps is_operator()", await canExecute("authenticated", "public.is_operator()"));
  record("anon cannot execute bump_trust_score",
    !(await canExecute("anon", "public.bump_trust_score(uuid,int)")));
  record("anon cannot execute advance_sync_watermark",
    !(await canExecute("anon", "public.advance_sync_watermark(text,timestamptz)")));
  record("authenticated cannot execute record_sync_error",
    !(await canExecute("authenticated", "public.record_sync_error(text,text)")));
  record("anon cannot execute acquire_sync_lock",
    !(await canExecute("anon", "public.acquire_sync_lock(text,text,int)")));
  record("authenticated cannot execute release_sync_lock",
    !(await canExecute("authenticated", "public.release_sync_lock(text,text)")));
  record("anon cannot execute scan_accounts", !(await canExecute("anon", "public.scan_accounts(int)")));
  record("authenticated cannot execute scan_accounts", !(await canExecute("authenticated", "public.scan_accounts(int)")));
  record("service_role can execute scan_accounts", await canExecute("service_role", "public.scan_accounts(int)"));
  record("anon cannot execute radar_empty_streak", !(await canExecute("anon", "public.radar_empty_streak()")));
} else {
  skipped.push("CREATE ROLE is unavailable in this engine — RPC grant assertions skipped");
}

/* --------------------------------------------------- RLS contract (P2-9) */
// The behaviour rls_check.sql proves on a Docker stack, reduced to what PGlite can run:
// a signed-in user who is not in public.operators reads nothing and cannot write, an
// operator reads everything, and the worker RPCs stay service-role only.
if (rolesAvailable) {
  await exec(`
    insert into auth.users (id, email)
    values
      ('99999999-9999-4999-8999-999999999991', 'operator@example.com'),
      ('88888888-8888-4888-8888-888888888881', 'intruder@example.com')
    on conflict (id) do nothing;

    insert into public.operators (user_id, email)
    values ('99999999-9999-4999-8999-999999999991', 'operator@example.com')
    on conflict (user_id) do nothing;
  `);

  const totalTasks = await scalar(`select count(*)::int from public.comment_tasks`);

  // Supabase grants table access to `authenticated` by default; RLS is the filter.
  // Without these grants the test would prove the wrong thing ("permission denied").
  await exec(`
    grant usage on schema public to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;
  `);

  await exec(`
    set role authenticated;
    select set_config('request.jwt.claim.sub', '88888888-8888-4888-8888-888888888881', false);
  `);

  eq("a non-operator reads no tasks", await scalar(`select count(*)::int from public.comment_tasks`), 0);
  eq("a non-operator reads no accounts", await scalar(`select count(*)::int from public.social_accounts`), 0);
  eq("a non-operator reads no analytics rows", await scalar(`select count(*)::int from public.v_task_roi`), 0);

  let writeRejected = false;
  try {
    await exec(`insert into public.comment_tasks (post_url, status)
                values ('https://example.test/forbidden', 'pending_approval')`);
  } catch (error) {
    writeRejected = /row-level security|violates row-level/i.test(String(error.message));
  }
  record("a non-operator cannot insert a task", writeRejected);

  await exec(`select set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999991', false)`);
  eq(
    "the operator reads every task",
    await scalar(`select count(*)::int from public.comment_tasks`),
    totalTasks
  );

  await exec(`reset role`);
  await exec(`select set_config('request.jwt.claim.sub', '', false)`);
}
/* --------------------------------------- radar negative cache (P2-4) */
await exec(`
  insert into public.radar_seen (post_url, source_id, score, reason)
  values ('https://www.facebook.com/groups/seen/posts/1',
          'aaaa1111-1111-4111-8111-111111111111', 0.412, 'below threshold')
`);
eq(
  "a cached judgement stores its score",
  await rows(`select score::float8 as score from public.radar_seen where post_url like '%/groups/seen/posts/1'`),
  [{ score: 0.412 }]
);

// Re-judging the same post must refresh it, not duplicate it.
await exec(`
  insert into public.radar_seen (post_url, source_id, score, reason)
  values ('https://www.facebook.com/groups/seen/posts/1',
          'aaaa1111-1111-4111-8111-111111111111', 0.735, 're-judged')
  on conflict (post_url) do update
    set score = excluded.score, reason = excluded.reason, seen_at = now()
`);
eq(
  "post_url is the cache key (one row per post)",
  await rows(`select count(*)::int as n, max(score)::float8 as score
                from public.radar_seen where post_url like '%/groups/seen/posts/1'`),
  [{ n: 1, score: 0.735 }]
);

let badScoreRejected = false;
try {
  await exec(`insert into public.radar_seen (post_url, score) values ('https://x.test/1', 1.5)`);
} catch (error) {
  badScoreRejected = /radar_seen_score_check/.test(String(error.message));
}
record("a score outside 0..1 cannot be stored", badScoreRejected);

await exec(`delete from public.radar_seen where post_url like '%/groups/seen/posts/%'`);
/* ------------------------------------- atomic trust increments (P2-6) */
await exec(`update public.social_accounts set trust_score = 10 where id = '${ACCOUNT}'`);

// Separate statements on purpose: inside one statement both calls see the same
// snapshot for the stored value, which is the very effect being fixed.
eq("the first bump adds one", await scalar(`select public.bump_trust_score('${ACCOUNT}', 1)`), 11);
eq("the second bump adds one on top", await scalar(`select public.bump_trust_score('${ACCOUNT}', 1)`), 12);
eq(
  "both increments are stored (no lost update)",
  await scalar(`select trust_score from public.social_accounts where id = '${ACCOUNT}'`),
  12
);

await exec(`update public.social_accounts set trust_score = 99 where id = '${ACCOUNT}'`);
eq("the increment is clamped at 100", await scalar(`select public.bump_trust_score('${ACCOUNT}', 5)`), 100);

await exec(`update public.social_accounts set trust_score = 2 where id = '${ACCOUNT}'`);
eq("a negative delta is clamped at 0", await scalar(`select public.bump_trust_score('${ACCOUNT}', -10)`), 0);

eq(
  "bumping an unknown account changes nothing",
  await scalar(`
    select count(*)::int from (
      select public.bump_trust_score('99999999-9999-4999-8999-999999999999', 1) as score
    ) s where s.score is not null
  `),
  0
);

await exec(`update public.social_accounts set trust_score = 10 where id = '${ACCOUNT}'`);
/* ------------------------------------------ product sync columns (T-SHOPEE-05) */
eq(
  "offer-sync columns exist",
  await rows(`select column_name from information_schema.columns
               where table_schema = 'public' and table_name = 'products'
                 and column_name in ('origin_link','shop_id','shop_name','image_url','sales',
                                     'rating_star','seller_commission_rate','shopee_commission_rate',
                                     'offer_period_end_at','sync_source','last_synced_at')
               order by column_name`),
  [
    { column_name: "image_url" },
    { column_name: "last_synced_at" },
    { column_name: "offer_period_end_at" },
    { column_name: "origin_link" },
    { column_name: "rating_star" },
    { column_name: "sales" },
    { column_name: "seller_commission_rate" },
    { column_name: "shop_id" },
    { column_name: "shop_name" },
    { column_name: "shopee_commission_rate" },
    { column_name: "sync_source" }
  ]
);

eq(
  "existing rows default to sync_source = csv",
  await scalar(`select count(*)::int from public.products where sync_source <> 'csv'`),
  0
);

let duplicateLinkRejected = false;
try {
  await exec(`insert into public.products (name, affiliate_short_link)
              select 'Duplicate link', affiliate_short_link from public.products limit 1`);
} catch (error) {
  duplicateLinkRejected = /products_affiliate_short_link_key/.test(String(error.message));
}
record("affiliate_short_link is unique (sync upsert depends on it)", duplicateLinkRejected);

let badSyncSourceRejected = false;
try {
  await exec(`insert into public.products (name, affiliate_short_link, sync_source)
              values ('Bad source', 'https://example.test/bad-source', 'manual')`);
} catch (error) {
  badSyncSourceRejected = /products_sync_source_check/.test(String(error.message));
}
record("sync_source only accepts csv or api", badSyncSourceRejected);

/* --------------------------------------------- deal channel columns (P5-1) */
eq(
  "deal channel columns exist",
  await rows(`select column_name from information_schema.columns
               where table_schema = 'public' and table_name = 'products'
                 and column_name in ('last_dealt_at','deal_previewed_at','deal_caption')
               order by column_name`),
  [{ column_name: "deal_caption" }, { column_name: "deal_previewed_at" }, { column_name: "last_dealt_at" }]
);

record(
  "deal candidate partial index exists",
  (await scalar(`select count(*)::int from pg_indexes
                  where schemaname = 'public' and indexname = 'products_deal_candidates_idx'`)) === 1
);

/* ------------------------------------ sync state: resume watermark (T-SHOPEE-09) */
eq(
  "sync state starts empty",
  await rows(`select count(*)::int as n from public.affiliate_sync_state`),
  [{ n: 0 }]
);

eq(
  "advancing a watermark creates the row",
  await rows(`select kind, watermark is not null as has_watermark
                from public.advance_sync_watermark('conversion', '2026-10-26T10:00:00Z')`),
  [{ kind: "conversion", has_watermark: true }]
);

// A later run must be able to move the watermark forward...
await exec(`select public.advance_sync_watermark('conversion', '2026-10-26T12:00:00Z')`);
eq(
  "the watermark moves forward",
  new Date(await scalar(`select watermark from public.affiliate_sync_state where kind = 'conversion'`)).toISOString(),
  "2026-10-26T12:00:00.000Z"
);

// ...but a stale run must never rewind it.
await exec(`select public.advance_sync_watermark('conversion', '2026-10-25T09:00:00Z')`);
eq(
  "a stale run cannot rewind the watermark",
  new Date(await scalar(`select watermark from public.affiliate_sync_state where kind = 'conversion'`)).toISOString(),
  "2026-10-26T12:00:00.000Z"
);

await exec(`select public.record_sync_error('conversion', 'boom: 10030')`);
eq(
  "a failure records the reason without touching the watermark",
  await rows(`select last_error, watermark is not null as has_watermark
                from public.affiliate_sync_state where kind = 'conversion'`),
  [{ last_error: "boom: 10030", has_watermark: true }]
);

await exec(`select public.advance_sync_watermark('conversion', '2026-10-26T13:00:00Z')`);
eq(
  "a successful advance clears the previous error",
  await rows(`select last_error from public.affiliate_sync_state where kind = 'conversion'`),
  [{ last_error: null }]
);

let badKindRejected = false;
try {
  await exec(`insert into public.affiliate_sync_state (kind) values ('unknown')`);
} catch (error) {
  badKindRejected = /affiliate_sync_state_kind_check/.test(String(error.message));
}
record("sync kind is constrained to the three jobs", badKindRejected);

await exec(`delete from public.affiliate_sync_state`);

/* ------------------------------- single-flight sync lock (T-SHOPEE-13) */
eq(
  "the lock is free at first",
  await scalar(`select public.acquire_sync_lock('product', 'cron-a', 60)`),
  true
);
eq(
  "a second caller cannot take a live lock",
  await scalar(`select public.acquire_sync_lock('product', 'cron-b', 60)`),
  false
);
eq(
  "the owner can release it",
  await exec(`select public.release_sync_lock('product', 'cron-a')`).then(() =>
    scalar(`select public.acquire_sync_lock('product', 'cron-b', 60)`)
  ),
  true
);

// A different owner must not release somebody else's lease.
await exec(`select public.release_sync_lock('product', 'cron-a')`);
eq(
  "a non-owner cannot release the lease",
  await scalar(`select locked_by from public.affiliate_sync_state where kind = 'product'`),
  "cron-b"
);

// A crashed run leaves a lease behind; it must expire rather than block forever.
await exec(`
  update public.affiliate_sync_state
     set locked_until = now() - interval '1 minute'
   where kind = 'product'
`);
eq(
  "an expired lease can be taken over",
  await scalar(`select public.acquire_sync_lock('product', 'cron-c', 60)`),
  true
);

await exec(`delete from public.affiliate_sync_state where kind = 'product'`);
/* ------------------------------------------- stuck tasks are closed (P1-5) */
// A task that dies three times between claim and report can never be claimed again
// (attempt_count >= 3). Without the sweep it stays `running` forever while the queue
// advertises work nobody is doing.
const STUCK_EXHAUSTED = "cccc4444-4444-4444-8444-444444444401";
const STUCK_RETRYABLE = "cccc4444-4444-4444-8444-444444444402";
const STUCK_FRESH = "cccc4444-4444-4444-8444-444444444403";

await exec(`
  insert into public.comment_tasks (id, status, assigned_account_id, matched_product_id, post_url,
                                    claimed_at, claimed_by, attempt_count, created_at)
  values
    ('${STUCK_EXHAUSTED}', 'running', '${ACCOUNT}', 'bbbb1111-1111-4111-8111-111111111111',
     'https://www.facebook.com/groups/stuck/posts/1', now() - interval '2 hours', 'dead-worker', 3, now() - interval '3 hours'),
    ('${STUCK_RETRYABLE}', 'running', '${ACCOUNT}', 'bbbb1111-1111-4111-8111-111111111111',
     'https://www.facebook.com/groups/stuck/posts/2', now() - interval '2 hours', 'dead-worker', 2, now() - interval '3 hours'),
    ('${STUCK_FRESH}', 'running', '${ACCOUNT}', 'bbbb1111-1111-4111-8111-111111111111',
     'https://www.facebook.com/groups/stuck/posts/3', now(), 'live-worker', 3, now())
`);

eq(
  "sweep closes only the exhausted task",
  await rows(`select task_id::text from public.sweep_stuck_tasks(15)`),
  [{ task_id: STUCK_EXHAUSTED }]
);

eq(
  "the swept task is failed with an explanation",
  await rows(`select status::text, last_error from public.comment_tasks where id = '${STUCK_EXHAUSTED}'`),
  [{ status: "failed", last_error: "lease exhausted: worker stopped reporting after 3 attempts" }]
);

eq(
  "a task with retries left and a live lease are both untouched",
  await rows(`select count(*)::int as n from public.comment_tasks
               where id in ('${STUCK_RETRYABLE}', '${STUCK_FRESH}') and status = 'running'`),
  [{ n: 2 }]
);

await exec(`delete from public.comment_tasks where post_url like '%/groups/stuck/posts/%'`);
/* ------------------------------------- radar rotation, budget, blindness (P1-3) */
// Rotation: the account that scanned least recently goes first, and one that spent
// its daily scan budget is out. Before this, the highest-trust account scanned every
// source on every cycle, all day.
await exec(`
  update public.social_accounts
     set status = 'active', last_scanned_at = null, daily_scan_limit = 24,
         browser_profile_id = coalesce(browser_profile_id, 'scan-profile')
   where id in ('${ACCOUNT}', '44444444-4444-4444-8444-444444444444')
`);

eq(
  "never-scanned accounts come first and are ordered deterministically",
  (await rows(`select id::text as id from public.scan_accounts(2)`)).map((row) => row.id).sort(),
  [ACCOUNT, "44444444-4444-4444-8444-444444444444"].sort()
);

await exec(`
  update public.social_accounts set last_scanned_at = now() where id = '${ACCOUNT}';
  update public.social_accounts set last_scanned_at = now() - interval '1 hour'
   where id = '44444444-4444-4444-8444-444444444444'
`);
eq(
  "the least recently scanned account is chosen next",
  (await rows(`select id::text as id from public.scan_accounts(1)`))[0]?.id,
  "44444444-4444-4444-8444-444444444444"
);

await exec(`
  insert into public.radar_scans (account_id, source_id, posts_seen, created_at)
  select '44444444-4444-4444-8444-444444444444', 'aaaa1111-1111-4111-8111-111111111111', 4, now()
    from generate_series(1, 24) g
`);
eq(
  "an account that spent its daily scan budget is not offered",
  (await rows(`select id::text as id from public.scan_accounts(10)`)).some(
    (row) => row.id === "44444444-4444-4444-8444-444444444444"
  ),
  false
);

// Blindness: trailing empty scans are counted, and a hit resets the streak.
await exec(`delete from public.radar_scans`);
eq("no scans means no streak", await scalar(`select public.radar_empty_streak()`), 0);

await exec(`
  insert into public.radar_scans (account_id, source_id, posts_seen, created_at)
  values
    ('${ACCOUNT}', 'aaaa1111-1111-4111-8111-111111111111', 0, now() - interval '30 minutes'),
    ('${ACCOUNT}', 'aaaa1111-1111-4111-8111-111111111111', 0, now() - interval '20 minutes'),
    ('${ACCOUNT}', 'aaaa1111-1111-4111-8111-111111111111', 0, now() - interval '10 minutes')
`);
eq("three empty scans in a row count as a streak", await scalar(`select public.radar_empty_streak()`), 3);

await exec(`
  insert into public.radar_scans (account_id, source_id, posts_seen, created_at)
  values ('${ACCOUNT}', 'aaaa1111-1111-4111-8111-111111111111', 2, now())
`);
eq("a scan with posts resets the streak", await scalar(`select public.radar_empty_streak()`), 0);

await exec(`
  delete from public.radar_scans;
  update public.social_accounts
     set last_scanned_at = null, daily_scan_limit = 24
   where id in ('${ACCOUNT}', '44444444-4444-4444-8444-444444444444')
`);

/* --------------------------------------- one task per account per claim (P1-2) */
// Two accounts, two queued tasks each. A single claim must return at most one task
// per account — before this, every queued row of an account passed the "budget
// headroom" predicate against the same snapshot and the whole batch was taken.
const CLAMP_ACCOUNTS = [
  "11111111-1111-4111-8111-111111111111",
  "44444444-4444-4444-8444-444444444444"
];

await exec(`
  update public.social_accounts
     set status = 'active', cooldown_until = null, last_action_at = null,
         daily_comment_limit = 20, min_action_gap_minutes = 0
   where id in ('${CLAMP_ACCOUNTS[0]}', '${CLAMP_ACCOUNTS[1]}')
`);

await exec(`
  insert into public.comment_tasks (status, assigned_account_id, matched_product_id, post_url, created_at)
  select 'queued', a.account_id, 'bbbb1111-1111-4111-8111-111111111111',
         'https://www.facebook.com/groups/clamp/posts/' || a.account_id || '-' || g, now()
    from (values
      ('${CLAMP_ACCOUNTS[0]}'::uuid), ('${CLAMP_ACCOUNTS[1]}'::uuid)
    ) as a(account_id)
   cross join generate_series(1, 4) g
`);

const clampClaim = await rows(
  `select assigned_account_id::text as account_id from public.claim_comment_tasks('clamp', 10)`
);
eq("a claim never returns two tasks for the same account", clampClaim.length, 2);
eq(
  "the single claim returns one task per account",
  [...new Set(clampClaim.map((row) => row.account_id))].length,
  2
);

// The account's budget still applies on the next call: with a limit of 1 and one
// completed task already recorded, the account is out for the day.
await exec(`
  update public.comment_tasks
     set status = 'completed', executed_at = now()
   where assigned_account_id = '${CLAMP_ACCOUNTS[0]}'
     and status = 'running'
`);
await exec(`update public.social_accounts set daily_comment_limit = 1 where id = '${CLAMP_ACCOUNTS[0]}'`);
eq(
  "the clamped account stops at its daily limit on the next claim",
  (await rows(`select id from public.claim_comment_tasks('clamp-2', 10) where assigned_account_id = '${CLAMP_ACCOUNTS[0]}'`)).length,
  0
);

await exec(`
  delete from public.comment_tasks where post_url like '%/groups/clamp/posts/%';
  update public.social_accounts set daily_comment_limit = 8 where id in ('${CLAMP_ACCOUNTS[0]}', '${CLAMP_ACCOUNTS[1]}')
`);

/* ------------------------------------------------- conversion reconciliation */
// The seed already carries unattributed conversions, so every expectation below is
// expressed relative to that baseline rather than assuming an empty table.
const orphanBaseline = await scalar(
  `select count(*)::int from public.affiliate_conversions where task_id is null`
);

await exec(`
  insert into public.affiliate_conversions (sub_id, external_order_id, order_amount, estimated_commission, status, converted_at)
  values ('SUB-LATE-001', 'order-late-1', 500000, 40000, 'pending', now())
`);
eq(
  "reconcile leaves an orphan conversion alone when no task matches",
  await rows(`select attributed, remaining from public.reconcile_conversions()`),
  [{ attributed: 0, remaining: orphanBaseline + 1 }]
);

await exec(`
  insert into public.comment_tasks (status, sub_id_code, matched_product_id, post_url, created_at, executed_at)
  values ('completed', 'SUB-LATE-001', 'bbbb1111-1111-4111-8111-111111111111',
          'https://www.facebook.com/groups/late/posts/1', now(), now())
`);
eq(
  "reconcile attributes the conversion once its Sub_ID exists",
  await rows(`select attributed, remaining from public.reconcile_conversions()`),
  [{ attributed: 1, remaining: orphanBaseline }]
);

eq(
  "reconcile is idempotent (nothing left to do)",
  await rows(`select attributed, remaining from public.reconcile_conversions()`),
  [{ attributed: 0, remaining: orphanBaseline }]
);

eq(
  "the reconciled conversion points at the task",
  await scalar(`select count(*)::int from public.affiliate_conversions c
                 join public.comment_tasks t on t.id = c.task_id
                where c.sub_id = 'SUB-LATE-001' and t.sub_id_code = 'SUB-LATE-001'`),
  1
);

/* ------------------------------------------------------- profile building state */
eq(
  "profile and sandbox columns exist",
  await rows(`select table_name, column_name from information_schema.columns
               where table_schema = 'public'
                 and ((table_name = 'social_accounts' and column_name in ('bio','avatar_set_at','cover_set_at','profile_built_at'))
                   or (table_name = 'warming_runs' and column_name = 'sandbox'))
               order by table_name, column_name`),
  [
    { table_name: "social_accounts", column_name: "avatar_set_at" },
    { table_name: "social_accounts", column_name: "bio" },
    { table_name: "social_accounts", column_name: "cover_set_at" },
    { table_name: "social_accounts", column_name: "profile_built_at" },
    { table_name: "warming_runs", column_name: "sandbox" }
  ]
);

eq(
  "profile_setup is a valid warming kind",
  await scalar(`select count(*)::int from pg_enum e
                join pg_type t on t.oid = e.enumtypid
                where t.typname = 'warming_kind' and e.enumlabel = 'profile_setup'`),
  1
);

/* ------------------------------------------- account credentials (2nd migration) */
eq(
  "credential columns exist",
  await rows(`select column_name from information_schema.columns
               where table_schema = 'public' and table_name = 'social_accounts'
                 and column_name in ('login_identifier','login_password_enc','twofa_secret_enc',
                                     'proxy_host','proxy_port','proxy_username','proxy_password_enc',
                                     'credentials_imported_at')
               order by column_name`),
  [
    { column_name: "credentials_imported_at" },
    { column_name: "login_identifier" },
    { column_name: "login_password_enc" },
    { column_name: "proxy_host" },
    { column_name: "proxy_password_enc" },
    { column_name: "proxy_port" },
    { column_name: "proxy_username" },
    { column_name: "twofa_secret_enc" }
  ]
);

await exec(`insert into public.social_accounts (name, persona_type, login_identifier, proxy_port)
            values ('Cred A', 'me_bim', '00000000000001', 16008)`);
record("credential import accepts a valid row", true);

let duplicateRejected = false;
try {
  await exec(`insert into public.social_accounts (name, persona_type, login_identifier)
              values ('Cred A again', 'me_bim', '00000000000001')`);
} catch (error) {
  duplicateRejected = /social_accounts_login_identifier_key/.test(String(error.message));
}
record("duplicate login_identifier is rejected", duplicateRejected);

let badPortRejected = false;
try {
  await exec(`insert into public.social_accounts (name, persona_type, login_identifier, proxy_port)
              values ('Bad port', 'me_bim', '61590750336699', 70000)`);
} catch (error) {
  badPortRejected = /social_accounts_proxy_port_check/.test(String(error.message));
}
record("proxy_port outside 1..65535 is rejected", badPortRejected);

report();

function report() {
  console.log(results.join("\n"));
  if (skipped.length > 0) {
    console.log(`\nskipped:\n  ${skipped.join("\n  ")}`);
  }
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
}

process.exit(failed === 0 ? 0 : 1);
