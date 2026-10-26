import { readFileSync } from "node:fs";
/**
 * Worker configuration.
 *
 * Safety rule encoded here: with the `local` provider (the operator's own Chrome, no
 * fingerprint masking) a real post also requires `ALLOW_LOCAL_POSTING=true`. Posting on
 * Facebook from an unattended process is the highest-risk action in this system, so
 * the safe default is "do nothing to the outside world", and turning that off has to
 * be an explicit decision rather than a side effect of setting DRY_RUN=false.
 *
 * docs/REVIEW.md P2-1: this rule was documented for months while the code did not
 * implement it. It exists now, and the README describes exactly what it does.
 */

export type ProviderName = "gpm" | "genlogin" | "local";
export type ExecutorName = "facebook" | "fixture";

export type WorkerConfig = {
  appUrl: string;
  apiToken: string;
  workerName: string;
  pollIntervalMs: number;
  maxPerClaim: number;
  dryRun: boolean;
  provider: ProviderName;
  executor: ExecutorName;
  /** GPM-Login local API root. */
  gpmApiUrl: string;
  /** Genlogin local API root. */
  genloginApiUrl: string;
  /** Directory holding per-profile Chromium user data for the `local` provider. */
  localProfileDir: string;
  /** "chrome" uses the installed Chrome; empty uses Playwright's Chromium (containers). */
  browserChannel: string;
  /** Page the `fixture` executor drives (a local comment form). */
  fixtureUrl: string;
  /** Where evidence screenshots land. */
  evidenceDir: string;
  /** Per-persona avatar/cover images used by profile_setup. */
  assetsDir: string;
  /** Stop after one claim cycle (used by CI / smoke runs). */
  runOnce: boolean;
  /** Run the persona-warming cycle (lifestyle posts + cross-warm comments). */
  warmingEnabled: boolean;
  /** Skip task claiming entirely — a dedicated warming process. */
  warmingOnly: boolean;
  /** How often the worker pings /api/worker/heartbeat. */
  heartbeatIntervalMs: number;
  /** Port for the container liveness endpoint (GET /health); 0 disables it. */
  healthPort: number;
  /** Worker package version, reported by /health. */
  workerVersion: string;
  /** Run the radar scan cycle (scrape watchlist sources, hand posts to ingest). */
  radarEnabled: boolean;
  /** Sources scanned per cycle. */
  radarSourcesPerCycle: number;
  /** Pin every capture to this product id (used before GEMINI_API_KEY exists). */
  radarPinnedProductId: string | null;
  /** Deterministic delays for reproducible dry runs. */
  randomSeed: number | null;
  /** Set by ALLOW_LOCAL_POSTING=true: permits real posts with the `local` provider. */
  allowLocalPosting: boolean;
  /**
   * Browse from the host IP instead of the account's proxy. Only for a deliberate
   * "this account lives on my home connection" decision — the worker logs it on
   * every start so it can never become an accident.
   */
  ignoreProxy: boolean;
  /** Set by DRY_RUN_CLAIMS=true: let a fixture dry-run claim real queue rows. */
  dryRunClaims: boolean;
};

const DEFAULTS = {
  appUrl: "http://localhost:3000",
  workerName: "worker-1",
  pollIntervalMs: 15_000,
  maxPerClaim: 3,
  gpmApiUrl: "http://127.0.0.1:19995",
  genloginApiUrl: "http://127.0.0.1:55555",
  localProfileDir: "./.profiles",
  browserChannel: "chrome",
  fixtureUrl: "",
  evidenceDir: "./.evidence",
  assetsDir: "./assets"
};

function readString(name: string, fallback: string): string {
  const raw = process.env[name]?.trim();
  return raw && raw.length > 0 ? raw : fallback;
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number, got "${raw}"`);
  }
  return parsed;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  throw new Error(`${name} must be a boolean-ish value, got "${raw}"`);
}

function readEnum<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  const match = allowed.find((value) => value === raw);
  if (!match) {
    throw new Error(`${name} must be one of ${allowed.join(" | ")}, got "${raw}"`);
  }
  return match;
}

/** CLI flags win over env: `--once`, `--executor=fixture`, `--dry-run=false`. */
function readFlag(name: string): string | null {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

/**
 * Whether this run may claim real queue rows (docs/REVIEW.md P2-5).
 *
 * A fixture dry-run claims a task, types into a local page, then reports `failed` with
 * "Dry run: nothing was posted" — which moves a real task to failed, spends one of its
 * three attempts and sends a failure alert. Nothing about that is a rehearsal.
 *
 * A dry-run against the *real* executor is different: it is the documented way to check
 * profiles, proxies and selectors, and touching the queue is the point. So only the
 * fixture combination is blocked, and DRY_RUN_CLAIMS=true opens it back up.
 */
export function shouldClaimTasks(config: {
  dryRun: boolean;
  executor: ExecutorName;
  warmingOnly: boolean;
  dryRunClaims: boolean;
}): boolean {
  if (config.warmingOnly) return false;
  if (config.dryRun && config.executor === "fixture" && !config.dryRunClaims) return false;
  return true;
}

/**
 * Version reported by /health. Read from the package manifest so an image tag and the
 * endpoint cannot disagree; WORKER_VERSION overrides it when the runtime image has no
 * package.json (the Dockerfile copies one, but a stripped image might not).
 */
function readPackageVersion(): string {
  try {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version?: string;
    };
    return manifest.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function loadConfig(): WorkerConfig {
  const executorOverride = readFlag("executor");
  const dryRunOverride = readFlag("dry-run");

  const config: WorkerConfig = {
    appUrl: readString("APP_URL", DEFAULTS.appUrl).replace(/\/$/, ""),
    apiToken: readString("WORKER_API_TOKEN", ""),
    workerName: readString("WORKER_NAME", DEFAULTS.workerName),
    pollIntervalMs: readNumber("POLL_INTERVAL_MS", DEFAULTS.pollIntervalMs),
    maxPerClaim: readNumber("MAX_PER_CLAIM", DEFAULTS.maxPerClaim),
    dryRun: dryRunOverride ? dryRunOverride !== "false" : readBoolean("DRY_RUN", true),
    provider: readEnum("ANTIDETECT_PROVIDER", ["gpm", "genlogin", "local"] as const, "local"),
    executor: readEnum(
      "EXECUTOR",
      ["facebook", "fixture"] as const,
      executorOverride === "fixture" ? "fixture" : "facebook"
    ),
    gpmApiUrl: readString("GPM_API_URL", DEFAULTS.gpmApiUrl).replace(/\/$/, ""),
    genloginApiUrl: readString("GENLOGIN_API_URL", DEFAULTS.genloginApiUrl).replace(/\/$/, ""),
    localProfileDir: readString("LOCAL_PROFILE_DIR", DEFAULTS.localProfileDir),
    browserChannel: readString("BROWSER_CHANNEL", DEFAULTS.browserChannel),
    fixtureUrl: readString("FIXTURE_URL", DEFAULTS.fixtureUrl),
    evidenceDir: readString("EVIDENCE_DIR", DEFAULTS.evidenceDir),
    assetsDir: readString("ASSETS_DIR", DEFAULTS.assetsDir),
    runOnce: hasFlag("once"),
    warmingEnabled: readBoolean("WARMING_ENABLED", false),
    warmingOnly: hasFlag("warming-only"),
    heartbeatIntervalMs: readNumber("HEARTBEAT_INTERVAL_MS", 60_000),
    healthPort: readNumber("WORKER_HEALTH_PORT", 8080),
    workerVersion: readString("WORKER_VERSION", readPackageVersion()),
    radarEnabled: readBoolean("RADAR_ENABLED", false),
    radarSourcesPerCycle: readNumber("RADAR_SOURCES_PER_CYCLE", 3),
    radarPinnedProductId: process.env.RADAR_PINNED_PRODUCT_ID?.trim() || null,
    randomSeed: process.env.RANDOM_SEED ? readNumber("RANDOM_SEED", 1) : null,
    ignoreProxy: hasFlag("no-proxy") || readBoolean("IGNORE_PROXY", false),
    dryRunClaims: readBoolean("DRY_RUN_CLAIMS", false),
    allowLocalPosting: readBoolean("ALLOW_LOCAL_POSTING", false)
  };

  if (config.warmingOnly && !config.warmingEnabled) {
    throw new Error("--warming-only needs WARMING_ENABLED=true, otherwise the worker would do nothing.");
  }

  if (!config.apiToken) {
    throw new Error("WORKER_API_TOKEN is required — it must match the web app's value.");
  }

  assertPostingAllowed(config);

  return config;
}

/**
 * Refuses a real post with the `local` provider unless the operator opted in.
 *
 * The fixture executor is exempt (it posts to a local page), and so is dry-run. This
 * is the guard docs/REVIEW.md P2-1 found missing: `DRY_RUN=false
 * ANTIDETECT_PROVIDER=local` used to post for real with no acknowledgement at all.
 */
export function assertPostingAllowed(config: {
  dryRun: boolean;
  provider: ProviderName;
  executor: ExecutorName;
  allowLocalPosting: boolean;
}): void {
  if (config.dryRun) return;
  if (config.executor === "fixture") return;
  if (config.provider !== "local") return;
  if (config.allowLocalPosting) return;

  throw new Error(
    "Refusing to post for real with ANTIDETECT_PROVIDER=local — this provider has no " +
      "fingerprint masking, so every account on this machine shares one fingerprint. " +
      "Set ALLOW_LOCAL_POSTING=true if that is a deliberate, accepted risk " +
      "(see docs/REVIEW.md P2-1 and README → Execution worker), or use a fingerprint " +
      "provider (gpm/genlogin), or keep DRY_RUN=true."
  );
}
