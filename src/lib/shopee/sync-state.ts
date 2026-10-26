import type { SupabaseDb } from "@/lib/db";

/**
 * Resume bookkeeping for the Shopee pull jobs (docs/TASKS.md T-SHOPEE-09).
 *
 * The API's `scrollId` cursor dies after 30 seconds, so it is only good for paging
 * inside a single run. Durable progress is a purchase-time watermark: each run asks
 * for `[watermark − lookback, now]`, ingests, and advances the watermark only after the
 * window is fully written.
 *
 * The lookback exists because reports are not real-time (docs §7.5): an order that
 * happened at 10:00 may only appear at 11:30. Re-reading a couple of hours is cheap
 * because ingestion is idempotent on `external_order_id`.
 */

export type SyncKind = "conversion" | "validated" | "product";

export type SyncState = {
  kind: SyncKind;
  watermark: string | null;
  lastRunAt: string | null;
  lastError: string | null;
};

/** How far back a run re-reads on top of the watermark. */
export const DEFAULT_LOOKBACK_MINUTES = 120;
/** Window used the very first time a job runs (no watermark yet). */
export const DEFAULT_INITIAL_WINDOW_HOURS = 24;

export type SyncWindow = { start: Date; end: Date };

/**
 * Pure window planning, so the resume maths is testable without a database.
 *
 * - no watermark → `initialWindowHours` back from now
 * - watermark → `lookbackMinutes` before it (never earlier than … nothing; the API
 *   accepts any start)
 * - `end` is always `now`, and `start` is always strictly before `end`
 */
export function planSyncWindow(input: {
  now: Date;
  watermark: Date | null;
  lookbackMinutes?: number;
  initialWindowHours?: number;
}): SyncWindow {
  const lookbackMinutes = input.lookbackMinutes ?? DEFAULT_LOOKBACK_MINUTES;
  const initialHours = input.initialWindowHours ?? DEFAULT_INITIAL_WINDOW_HOURS;

  const base = input.watermark
    ? new Date(input.watermark.getTime() - lookbackMinutes * 60_000)
    : new Date(input.now.getTime() - initialHours * 3_600_000);

  const start = base.getTime() >= input.now.getTime() ? new Date(input.now.getTime() - 60_000) : base;

  return { start, end: input.now };
}

export async function readSyncState(db: SupabaseDb, kind: SyncKind): Promise<SyncState> {
  const { data, error } = await db
    .from("affiliate_sync_state")
    .select("kind,watermark,last_run_at,last_error")
    .eq("kind", kind)
    .maybeSingle()
    .overrideTypes<
      { kind: string; watermark: string | null; last_run_at: string | null; last_error: string | null } | null,
      { merge: false }
    >();

  if (error) throw new Error(`Could not read sync state for ${kind}: ${error.message}`);

  return {
    kind,
    watermark: data?.watermark ?? null,
    lastRunAt: data?.last_run_at ?? null,
    lastError: data?.last_error ?? null
  };
}

/** Advances the watermark monotonically (the SQL function refuses to rewind). */
export async function advanceWatermark(db: SupabaseDb, kind: SyncKind, watermark: Date): Promise<void> {
  const { error } = await db.rpc("advance_sync_watermark", {
    p_kind: kind,
    p_watermark: watermark.toISOString()
  });

  if (error) throw new Error(`Could not advance the ${kind} watermark: ${error.message}`);
}

export async function recordSyncError(db: SupabaseDb, kind: SyncKind, message: string): Promise<void> {
  const { error } = await db.rpc("record_sync_error", { p_kind: kind, p_error: message });

  // Losing the error record must not mask the original failure.
  if (error) console.error(`[shopee] could not record the ${kind} sync error: ${error.message}`);
}
