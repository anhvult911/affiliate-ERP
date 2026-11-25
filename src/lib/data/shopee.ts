import { isShopeeConfigured } from "@/lib/shopee/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Operator-facing readiness for the Shopee pull jobs.
 *
 * The conversion report is the only automated source of sales; a silent cron failure
 * otherwise looks exactly like "no orders yet". The queue/analytics pages show this so
 * an empty commission table is not mistaken for a real zero.
 *
 * Nothing here touches App ID/Secret: configuration is a boolean and the rows contain
 * only the watermark bookkeeping written by `record_sync_error`/`advance_sync_watermark`.
 */

export type ShopeeSyncJobKind = "conversion" | "validated" | "product";

export type ShopeeSyncJobState = "unconfigured" | "never" | "ok" | "stale" | "error";

export type ShopeeSyncJob = {
  kind: ShopeeSyncJobKind;
  label: string;
  state: ShopeeSyncJobState;
  lastRunAt: string | null;
  lastError: string | null;
};

export type ShopeeSyncStatus = {
  configured: boolean;
  jobs: ShopeeSyncJob[];
};

type JobDefinition = {
  kind: ShopeeSyncJobKind;
  label: string;
  /** Cron cadence plus grace (vercel.json): conversion hourly, product 6h, validated daily. */
  staleAfterMinutes: number;
};

const JOBS: JobDefinition[] = [
  { kind: "conversion", label: "Đơn hàng & hoa hồng", staleAfterMinutes: 150 },
  { kind: "validated", label: "Hoa hồng đã duyệt", staleAfterMinutes: 60 * 30 },
  { kind: "product", label: "Danh mục sản phẩm", staleAfterMinutes: 60 * 13 }
];

function classify(input: {
  lastRunAt: string | null;
  lastError: string | null;
  staleAfterMinutes: number;
  now: Date;
}): ShopeeSyncJobState {
  if (input.lastError) {
    // A recorded error survives until the next successful run clears it, so it is
    // more important than the clock: the operator must see why the last run stopped.
    return "error";
  }
  if (!input.lastRunAt) return "never";

  const ageMinutes = Math.max(
    0,
    Math.floor((input.now.getTime() - new Date(input.lastRunAt).getTime()) / 60_000)
  );

  return ageMinutes > input.staleAfterMinutes ? "stale" : "ok";
}

export async function getShopeeSyncStatus(now: Date = new Date()): Promise<ShopeeSyncStatus> {
  const configured = isShopeeConfigured();

  if (!configured) {
    return {
      configured,
      jobs: JOBS.map((job) => ({
        kind: job.kind,
        label: job.label,
        state: "unconfigured",
        lastRunAt: null,
        lastError: null
      }))
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("affiliate_sync_state")
    .select("kind,last_run_at,last_error");

  if (error) throw new Error(`Could not load Shopee sync state: ${error.message}`);

  const rows = new Map(
    (data ?? []).map(
      (row) =>
        [
          row.kind,
          { lastRunAt: row.last_run_at, lastError: row.last_error }
        ] as const
    )
  );

  return {
    configured,
    jobs: JOBS.map((job) => {
      const row = rows.get(job.kind);
      const state = classify({
        lastRunAt: row?.lastRunAt ?? null,
        lastError: row?.lastError ?? null,
        staleAfterMinutes: job.staleAfterMinutes,
        now
      });

      return {
        kind: job.kind,
        label: job.label,
        state,
        lastRunAt: row?.lastRunAt ?? null,
        lastError: row?.lastError ?? null
      };
    })
  };
}
