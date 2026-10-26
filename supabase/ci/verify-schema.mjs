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
} else {
  skipped.push("CREATE ROLE is unavailable in this engine — RPC grant assertions skipped");
}

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
            values ('Cred A', 'me_bim', '61590750336672', 16008)`);
record("credential import accepts a valid row", true);

let duplicateRejected = false;
try {
  await exec(`insert into public.social_accounts (name, persona_type, login_identifier)
              values ('Cred A again', 'me_bim', '61590750336672')`);
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
