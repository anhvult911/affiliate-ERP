import {
  ShopeeAccessError,
  ShopeeAuthError,
  ShopeeError,
  ShopeeRateLimitError,
  ShopeeTransientError
} from "@/lib/shopee/client";
import type { RequestBudget } from "@/lib/shopee/budget";
import type { SupabaseDb } from "@/lib/db";
import type { SyncKind } from "@/lib/shopee/sync-state";

/**
 * How a Shopee run should react to an error (docs/TASKS.md T-SHOPEE-13).
 *
 * The three groups are not interchangeable:
 *   - `stop`     rate limit / no access / bad signature — retrying makes it worse, and
 *                the next cron tick should pick up from the committed watermark;
 *   - `retry`    a transient system error or a dropped connection — back off and try
 *                the same page again, within the same run;
 *   - `fail`     a query/params bug — the code is wrong, so stop and surface it.
 */
export type RunAction = "stop" | "retry" | "fail";

export function classifyRunError(error: unknown): RunAction {
  if (error instanceof ShopeeRateLimitError) return "stop";
  if (error instanceof ShopeeAccessError) return "stop";
  if (error instanceof ShopeeAuthError) return "stop";
  if (error instanceof ShopeeTransientError) return "retry";

  // Network failures arrive as plain errors from fetch/undici.
  if (error instanceof Error && /ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up/i.test(error.message)) {
    return "retry";
  }

  if (error instanceof ShopeeError) return "fail";
  return "fail";
}

/** 0.8s, 1.6s, 3.2s … capped, with no jitter (the ceiling is what matters here). */
export function backoffDelayMs(attempt: number, baseMs = 800, capMs = 30_000): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(capMs, baseMs * 2 ** (safeAttempt - 1));
}

export type PacedJobResult = {
  status: "ok" | "stopped" | "failed";
  pages: number;
  requests: number;
  items: number;
  /** Set when the run ended early. */
  error?: string;
};

export type PacedJobOptions<T> = {
  /** One page of the report; `cursor` is the API's scrollId (null on the first page). */
  fetchPage: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>;
  /** Writes a page; returns the watermark to commit (usually the page's newest time). */
  ingestPage: (items: T[]) => Promise<Date>;
  commitWatermark: (at: Date) => Promise<void>;
  recordError: (message: string) => Promise<void>;
  budget: RequestBudget;
  /** Default 3 attempts for transient failures. */
  maxRetries?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Pages through a report with the policies above.
 *
 * The watermark is committed **after each page**, not at the end: a run that dies on
 * page 4 keeps pages 1–3, and the lookback overlap covers the boundary. That is what
 * makes "stop mid-run" safe rather than lossy.
 */
export async function runPacedJob<T>(options: PacedJobOptions<T>): Promise<PacedJobResult> {
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const maxRetries = options.maxRetries ?? 3;

  let pages = 0;
  let requests = 0;
  let items = 0;
  let cursor: string | null = null;
  let attempt = 0;

  for (;;) {
    let page: { items: T[]; nextCursor: string | null };

    try {
      options.budget.spend();
      requests += 1;
      page = await options.fetchPage(cursor);
    } catch (error) {
      const action = classifyRunError(error);
      const message = error instanceof Error ? error.message : String(error);

      if (action === "retry" && attempt + 1 < maxRetries) {
        attempt += 1;
        await sleep(backoffDelayMs(attempt));
        continue;
      }

      await options.recordError(message).catch(() => undefined);

      return {
        status: action === "retry" ? "failed" : "stopped",
        pages,
        requests,
        items,
        error: message
      };
    }

    attempt = 0;
    pages += 1;

    if (page.items.length > 0) {
      try {
        const watermark = await options.ingestPage(page.items);
        await options.commitWatermark(watermark);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await options.recordError(message).catch(() => undefined);
        return { status: "failed", pages, requests, items, error: message };
      }

      items += page.items.length;
    }

    if (!page.nextCursor) return { status: "ok", pages, requests, items };

    cursor = page.nextCursor;
  }
}

export type LockOutcome = { acquired: true; release: () => Promise<void> } | { acquired: false };

/**
 * Lease-based single-flight. The lease expires on its own, so a process that dies
 * without releasing cannot block the next cron tick forever.
 */
export async function acquireSyncLock(
  db: SupabaseDb,
  kind: SyncKind,
  owner: string,
  ttlSeconds = 300
): Promise<LockOutcome> {
  const { data, error } = await db.rpc("acquire_sync_lock", {
    p_kind: kind,
    p_owner: owner,
    p_ttl_seconds: ttlSeconds
  });

  if (error) throw new Error(`Could not acquire the ${kind} sync lock: ${error.message}`);
  if (data !== true) return { acquired: false };

  return {
    acquired: true,
    release: async () => {
      const { error: releaseError } = await db.rpc("release_sync_lock", { p_kind: kind, p_owner: owner });
      // A failed release only delays the next run until the lease expires.
      if (releaseError) console.error(`[shopee] could not release the ${kind} lock: ${releaseError.message}`);
    }
  };
}
