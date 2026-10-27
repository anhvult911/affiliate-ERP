/**
 * Production preflight (docs/TASKS.md P3-4).
 *
 *   npm run preflight:prod
 *
 * A checklist, not a test suite: it answers "is this machine ready to serve" before a
 * deploy, and names what is missing instead of failing at the first request. Exit 1 only
 * for things that make the deployment broken (missing required key, migration ordering,
 * committed secret, cron entry pointing at a route that does not exist).
 *
 * Optional integrations (Gemini, Telegram, Shopee) are reported separately: a deployment
 * without them still runs, it just does less.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { loadScriptEnv, PRODUCTION_ENV_FILES } from "./lib/env";
import {
  checkCronConfig,
  checkEnv,
  checkMigrations,
  cronRouteFile,
  MIGRATIONS_DIR,
  SHOPEE_CRON_PATHS
} from "./lib/preflight";

/** Production-first: this is the check that decides whether a deploy is ready. */
function loadEnvironment(): string {
  const loaded = loadScriptEnv(PRODUCTION_ENV_FILES);
  return loaded.files.find((entry) => entry.keys > 0)?.file ?? "(none)";
}

function line(ok: boolean, label: string, detail: string): void {
  console.log(`${ok ? "[x]" : "[ ]"} ${label.padEnd(42)} ${detail}`);
}

function readVercelJson(): { crons?: { path?: string }[] } | null {
  const path = join(process.cwd(), "vercel.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as { crons?: { path?: string }[] };
  } catch {
    return null;
  }
}

function main(): number {
  const envFile = loadEnvironment();
  const failures: string[] = [];

  console.log(`production preflight — env from ${envFile}\n`);

  /* 1. required configuration */
  const env = checkEnv(process.env);
  line(
    env.missing.length === 0,
    "required environment variables",
    env.missing.length === 0 ? `${env.present.length} present` : `missing: ${env.missing.map((e) => e.name).join(", ")}`
  );

  for (const entry of env.missing) {
    console.log(`    ✗ ${entry.name} — ${entry.why}`);
    failures.push(`missing ${entry.name}`);
  }

  for (const entry of env.missingOptional) {
    console.log(`    · ${entry.name} not set — ${entry.why}`);
  }

  /* 2. migrations */
  const migrations = checkMigrations(MIGRATIONS_DIR);
  const migrationsOk =
    migrations.files.length > 0 &&
    migrations.duplicates.length === 0 &&
    migrations.malformed.length === 0 &&
    migrations.futureDated.length === 0;

  line(migrationsOk, "migrations", `${migrations.files.length} files, newest ${migrations.newest ?? "(none)"}`);

  if (migrations.duplicates.length > 0) {
    console.log(`    ✗ duplicate timestamps: ${migrations.duplicates.join(", ")}`);
    failures.push("duplicate migration timestamps");
  }
  if (migrations.malformed.length > 0) {
    console.log(`    ✗ names that are not <timestamp>_<name>.sql: ${migrations.malformed.join(", ")}`);
    failures.push("malformed migration names");
  }
  if (migrations.sameDayAhead.length > 0) {
    console.log(
      `    · stamped later today (ordering is still by filename): ${migrations.sameDayAhead.join(", ")}`
    );
  }

  if (migrations.futureDated.length > 0) {
    console.log(`    ✗ dated in the future (clock or name is wrong): ${migrations.futureDated.join(", ")}`);
    failures.push("future-dated migrations");
  }

  /* 3. cron configuration */
  const vercel = readVercelJson();
  const cron = checkCronConfig(vercel, (path) => existsSync(cronRouteFile(path)));

  line(cron.dangling.length === 0, "cron entries resolve to a route", `${cron.configured.length} configured`);

  if (cron.dangling.length > 0) {
    console.log(`    ✗ no route file for: ${cron.dangling.join(", ")}`);
    failures.push("cron entry without a route");
  }

  const missingShopee = SHOPEE_CRON_PATHS.filter((path) => !cron.configured.includes(path));
  if (missingShopee.length === 0) {
    line(true, "Shopee cron schedule", "3/3 configured");
  } else {
    // Not a failure: the pull jobs are credential-gated (T-SHOPEE-04/07/08), and a cron
    // entry pointing at a route that does not exist yet would 404 every hour.
    line(false, "Shopee cron schedule", `pending ${missingShopee.length}/3 — blocked by SHOPEE-CRED`);
  }

  /* 4. secret scan */
  let secretsClean = true;
  let secretDetail = "no findings";
  try {
    // process.execPath + the tsx loader: `npx` on Windows mangles the argument list.
    execFileSync(process.execPath, ["--import", "tsx", "scripts/check-secrets.ts"], {
      encoding: "utf8",
      stdio: "pipe"
    });
  } catch (error) {
    secretsClean = false;
    const output = error instanceof Error && "stdout" in error ? String((error as { stdout?: string }).stdout ?? "") : "";
    secretDetail = output.trim().split("\n").slice(0, 3).join(" | ") || "findings reported above";
    failures.push("secret scan found something");
  }
  line(secretsClean, "no secrets in tracked files", secretDetail);

  /* 5. worker execution mode */
  const executor = process.env.EXECUTOR?.trim();
  const provider = process.env.ANTIDETECT_PROVIDER?.trim();
  const dryRun = process.env.DRY_RUN?.trim() ?? "true";

  if (executor === "fixture") {
    console.log("    ! EXECUTOR=fixture — the worker will scrape and post against the local fixture page, not Facebook");
  }
  if (!executor) {
    console.log("    · EXECUTOR not set — the worker defaults to facebook (real posting, subject to DRY_RUN)");
  }
  line((executor ?? "facebook") === "facebook", "worker executor", executor ?? "(default: facebook)");
  console.log(`    · ANTIDETECT_PROVIDER=${provider ?? "(default: local)"} · DRY_RUN=${dryRun}`);

  if (dryRun !== "false") {
    console.log("    ! DRY_RUN is not false — the worker will claim nothing and post nothing");
  }

  /* summary */
  console.log("");
  if (failures.length > 0) {
    console.log(`NOT READY — ${failures.length} blocking issue(s): ${failures.join("; ")}`);
    return 1;
  }

  console.log("READY — required configuration, migrations, cron wiring and secrets all check out");
  return 0;
}

process.exit(main());
