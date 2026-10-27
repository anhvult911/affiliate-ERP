import assert from "node:assert/strict";
import test from "node:test";

import {
  checkCronConfig,
  checkEnv,
  checkMigrations,
  ENV_SPEC,
  SHOPEE_CRON_PATHS
} from "../scripts/lib/preflight";

const FULL_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  WORKER_API_TOKEN: "token",
  CRON_SECRET: "cron",
  ACCOUNT_CREDENTIALS_KEY: "key",
  NEXT_PUBLIC_SITE_URL: "https://erp.example.com",
  GEMINI_API_KEY: "gemini",
  TELEGRAM_BOT_TOKEN: "bot",
  TELEGRAM_CHAT_ID: "1",
  TELEGRAM_WEBHOOK_SECRET: "secret",
  SHOPEE_AFFILIATE_APP_ID: "1",
  SHOPEE_AFFILIATE_APP_SECRET: "s"
};

test("a complete environment has nothing missing", () => {
  const result = checkEnv(FULL_ENV);
  assert.equal(result.missing.length, 0);
  assert.equal(result.missingOptional.length, 0);
  assert.equal(result.present.length, ENV_SPEC.length);
});

test("a missing required key is named, and blanks count as missing", () => {
  const result = checkEnv({ ...FULL_ENV, WORKER_API_TOKEN: "   " });
  assert.deepEqual(result.missing.map((entry) => entry.name), ["WORKER_API_TOKEN"]);
});

test("an optional key is reported separately, not as a failure", () => {
  const result = checkEnv({ ...FULL_ENV, GEMINI_API_KEY: undefined });
  assert.equal(result.missing.length, 0);
  assert.deepEqual(result.missingOptional.map((entry) => entry.name), ["GEMINI_API_KEY"]);
});

test("every spec entry explains why it matters", () => {
  for (const entry of ENV_SPEC) {
    assert.ok(entry.why.length > 10, `${entry.name} needs a reason`);
  }
});

/* --------------------------------------------------------- migrations */

test("migrations are ordered, unique and not future-dated", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const dir = mkdtempSync(join(tmpdir(), "preflight-"));
  writeFileSync(join(dir, "20260101000000_a.sql"), "select 1;");
  writeFileSync(join(dir, "20260201000000_b.sql"), "select 1;");
  writeFileSync(join(dir, "20260201000000_c.sql"), "select 1;"); // duplicate stamp
  writeFileSync(join(dir, "not_a_migration.sql"), "select 1;");
  writeFileSync(join(dir, "29990101000000_future.sql"), "select 1;");
  // Less than a day ahead of "now": harmless, reported separately.
  writeFileSync(join(dir, "20260601060000_today.sql"), "select 1;");

  const result = checkMigrations(dir, new Date("2026-06-01T00:00:00Z"));

  assert.deepEqual(result.duplicates, ["20260201000000"]);
  assert.deepEqual(result.malformed, ["not_a_migration.sql"]);
  assert.deepEqual(result.futureDated, ["29990101000000_future.sql"]);
  assert.deepEqual(result.sameDayAhead, ["20260601060000_today.sql"]);
  assert.equal(result.newest, "29990101000000_future.sql");
});

test("an empty migrations directory is reported, not crashed on", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const result = checkMigrations(mkdtempSync(join(tmpdir(), "preflight-empty-")));
  assert.deepEqual(result.files, []);
  assert.equal(result.newest, null);
});

/* --------------------------------------------------------------- cron */

test("the three Shopee jobs are recognised", () => {
  const vercel = {
    crons: [
      { path: "/api/cron/health" },
      { path: "/api/cron/reconcile" },
      ...SHOPEE_CRON_PATHS.map((path) => ({ path }))
    ]
  };

  const result = checkCronConfig(vercel, () => true);
  assert.deepEqual(result.shopeeEntries, [...SHOPEE_CRON_PATHS]);
  assert.equal(result.dangling.length, 0);
});

test("a cron entry without a route file is flagged as dangling", () => {
  const vercel = { crons: [{ path: "/api/cron/health" }, { path: "/api/cron/shopee/conversions" }] };
  const result = checkCronConfig(vercel, (path) => path === "/api/cron/health");

  assert.deepEqual(result.dangling, ["/api/cron/shopee/conversions"]);
  assert.deepEqual(result.shopeeEntries, ["/api/cron/shopee/conversions"]);
});

test("an empty or missing crons array is tolerated", () => {
  assert.deepEqual(checkCronConfig(null, () => true).configured, []);
  assert.deepEqual(checkCronConfig({}, () => true).configured, []);
});
