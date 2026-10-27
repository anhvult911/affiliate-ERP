import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Production readiness checks (docs/TASKS.md P3-4).
 *
 * Pure functions so the checklist is testable without a VPS: the CLI reads files and
 * the environment, these decide what counts as ready.
 */

export type EnvSpec = { name: string; required: boolean; why: string };

/**
 * Derived from the variables the code actually reads (grep process.env). `required` is
 * "the app or worker cannot do its job without it", not "nice to have": a deployment
 * missing one of these fails at the first request, usually in a way that looks like a
 * bug rather than a configuration mistake.
 */
export const ENV_SPEC: EnvSpec[] = [
  { name: "NEXT_PUBLIC_SUPABASE_URL", required: true, why: "every page and route queries Supabase" },
  { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", required: true, why: "browser client + middleware session" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", required: true, why: "worker API, cron, Telegram webhook" },
  { name: "WORKER_API_TOKEN", required: true, why: "the only gate on /api/worker/*" },
  { name: "CRON_SECRET", required: true, why: "cron routes are public on a deployed URL" },
  { name: "ACCOUNT_CREDENTIALS_KEY", required: true, why: "account passwords/2FA are encrypted with it" },
  { name: "NEXT_PUBLIC_SITE_URL", required: true, why: "Telegram buttons and links point at it" },
  { name: "GEMINI_API_KEY", required: false, why: "without it the radar only works with a pinned product" },
  { name: "TELEGRAM_BOT_TOKEN", required: false, why: "approvals and alerts on the phone" },
  { name: "TELEGRAM_CHAT_ID", required: false, why: "where those messages go" },
  { name: "TELEGRAM_WEBHOOK_SECRET", required: false, why: "webhook refuses to act without it" },
  { name: "SHOPEE_AFFILIATE_APP_ID", required: false, why: "direct product/conversion sync" },
  { name: "SHOPEE_AFFILIATE_APP_SECRET", required: false, why: "request signing" }
];

export type EnvCheck = { missing: EnvSpec[]; missingOptional: EnvSpec[]; present: EnvSpec[] };

export function checkEnv(env: Record<string, string | undefined>, spec = ENV_SPEC): EnvCheck {
  const missing: EnvSpec[] = [];
  const missingOptional: EnvSpec[] = [];
  const present: EnvSpec[] = [];

  for (const entry of spec) {
    const value = env[entry.name]?.trim();
    if (value && value.length > 0) present.push(entry);
    else if (entry.required) missing.push(entry);
    else missingOptional.push(entry);
  }

  return { missing, missingOptional, present };
}

/* ------------------------------------------------------------- migrations */

export type MigrationCheck = {
  files: string[];
  duplicates: string[];
  malformed: string[];
  /** More than a day ahead: the naming or the clock is wrong. */
  futureDated: string[];
  /** Under a day ahead: harmless (files still order correctly), worth mentioning. */
  sameDayAhead: string[];
  newest: string | null;
};

/**
 * A migration stamped a few hours ahead of the machine is not a problem — Supabase
 * orders by filename, so the sequence is stable. A date days ahead means the clock or
 * the convention is wrong and should be fixed before more files are added.
 */
export const FUTURE_TOLERANCE_MS = 24 * 3_600_000;

const MIGRATION_NAME = /^(\d{14})_[a-z0-9_]+\.sql$/;

export function checkMigrations(dir: string, now: Date = new Date()): MigrationCheck {
  const files = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".sql")).sort() : [];

  const duplicates: string[] = [];
  const malformed: string[] = [];
  const futureDated: string[] = [];
  const sameDayAhead: string[] = [];
  const seen = new Set<string>();
  // Tracked separately from the file list: a malformed name sorts after digits, so the
  // last entry of a lexicographic sort is not necessarily the newest migration.
  let newest: { file: string; stamp: string } | null = null;

  for (const file of files) {
    const match = MIGRATION_NAME.exec(file);
    if (!match) {
      malformed.push(file);
      continue;
    }

    const stamp = match[1] as string;
    if (seen.has(stamp)) duplicates.push(stamp);
    seen.add(stamp);

    if (!newest || stamp > newest.stamp) newest = { file, stamp };

    // A migration dated in the future still applies, but it means the clock or the
    // filename is wrong and the next one will be ordered unpredictably.
    const when = Date.UTC(
      Number(stamp.slice(0, 4)),
      Number(stamp.slice(4, 6)) - 1,
      Number(stamp.slice(6, 8)),
      Number(stamp.slice(8, 10)),
      Number(stamp.slice(10, 12)),
      Number(stamp.slice(12, 14))
    );
    if (when > now.getTime() + FUTURE_TOLERANCE_MS) futureDated.push(file);
    else if (when > now.getTime()) sameDayAhead.push(file);
  }

  return {
    files,
    duplicates,
    malformed,
    futureDated,
    sameDayAhead,
    newest: newest?.file ?? null
  };
}

export const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/* ---------------------------------------------------------------- cron */

/** The three Shopee jobs the schedule contract defines (T-SHOPEE-10). */
export const SHOPEE_CRON_PATHS = [
  "/api/cron/shopee/conversions",
  "/api/cron/shopee/products",
  "/api/cron/shopee/validated"
] as const;

export type CronCheck = {
  configured: string[];
  /** Shopee entries present in vercel.json, whatever their path. */
  shopeeEntries: string[];
  /** Entry present for a route file that does not exist — the real drift risk. */
  dangling: string[];
};

export function checkCronConfig(
  vercelJson: { crons?: { path?: string }[] } | null,
  routeExists: (path: string) => boolean
): CronCheck {
  const paths = (vercelJson?.crons ?? [])
    .map((entry) => entry.path?.trim())
    .filter((path): path is string => Boolean(path));

  const shopeeEntries = paths.filter((path) => path.startsWith("/api/cron/shopee/"));

  return {
    configured: paths,
    shopeeEntries,
    dangling: paths.filter((path) => !routeExists(path))
  };
}

/** Maps `/api/cron/shopee/conversions` → the route file that must exist. */
export function cronRouteFile(path: string): string {
  return join(process.cwd(), "src", "app", ...path.split("/").filter(Boolean), "route.ts");
}
