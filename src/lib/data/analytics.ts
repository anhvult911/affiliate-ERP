import type { Views } from "@/lib/db-types";
import type { ConversionStatus } from "@/lib/constants";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Module 7 — analytics & ROI.
 *
 * Money is aggregated in Postgres through the `analytics_*` RPCs, never in JS:
 * PostgREST truncates every response at max_rows (1000) with a 200 and no
 * error, so summing an unbounded select silently under-reports once a window
 * holds more than 1000 conversions. The SQL functions also bucket by conversion
 * time, so a postback that lands today counts today even when the comment was
 * written weeks ago.
 *
 * `days: null` means all time; otherwise `p_since` is midnight UTC of
 * `today - (days - 1)`. Every reader below funnels through that same window.
 */

export type AnalyticsRange = { days: number | null };

export type AnalyticsSummary = {
  /** Order value of every non-canceled conversion in range. */
  revenue: number;
  /** Estimated commission of every non-canceled conversion in range. */
  commission: number;
  settledCommission: number;
  pendingCommission: number;
  canceledCommission: number;
  /** Non-canceled conversions in range. */
  orders: number;
  /** Tasks with `executed_at` in range whose status is `completed`. */
  tasksExecuted: number;
  /** Percentage (0..100) of completed tasks that produced at least one order. */
  conversionRate: number | null;
  averageOrderValue: number | null;
};

export type RevenuePoint = {
  /** UTC day, `YYYY-MM-DD`. */
  date: string;
  revenue: number;
  commission: number;
  orders: number;
};

export type PerformanceSlice = {
  label: string;
  orders: number;
  revenue: number;
  commission: number;
};

export type TaskRoiRow = Views<"v_task_roi">;
export type AccountPerformanceRow = Views<"v_account_performance">;

export type ConversionFeedItem = {
  id: string;
  sub_id: string;
  external_order_id: string | null;
  order_amount: number;
  estimated_commission: number;
  status: ConversionStatus;
  converted_at: string;
  task: { id: string; sub_id_code: string | null; post_url: string } | null;
};

/**
 * Inclusive lower bound for a range: midnight UTC of `today - (days - 1)`.
 * `null` means "all time", i.e. the RPC receives `p_since = null`.
 */
function rangeStartIso(days: number | null): string | null {
  if (days === null) return null;
  const span = Math.max(1, Math.floor(days));
  const start = new Date();
  const startOfUtcDay = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
  );
  startOfUtcDay.setUTCDate(startOfUtcDay.getUTCDate() - (span - 1));
  return startOfUtcDay.toISOString();
}

/** PostgREST serialises numeric/bigint columns as JSON numbers; coerce defensively. */
function num(value: number | string | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function requireRows<T>(context: string, rows: T[] | null, message: string | undefined): T[] {
  if (message) throw new Error(`Failed to load ${context}: ${message}`);
  return rows ?? [];
}

/**
 * Totals for the KPI grid. The RPC returns exactly one row; the ratio fields are
 * derived here so the page never has to guard a division by zero.
 */
export async function getAnalyticsSummary({
  days
}: AnalyticsRange): Promise<AnalyticsSummary> {
  const supabase = await createSupabaseServerClient();
  const since = rangeStartIso(days);

  const { data, error } = await supabase.rpc("analytics_summary", { p_since: since ?? undefined });
  const stats = requireRows("analytics summary", data, error?.message)[0];

  if (!stats) throw new Error("Failed to load analytics summary: empty response");

  const orders = num(stats.orders);
  const tasksExecuted = num(stats.tasks_executed);
  const tasksWithOrders = num(stats.tasks_with_orders);
  const revenue = num(stats.revenue);

  return {
    revenue,
    commission: num(stats.commission),
    settledCommission: num(stats.settled_commission),
    pendingCommission: num(stats.pending_commission),
    canceledCommission: num(stats.canceled_commission),
    orders,
    tasksExecuted,
    // Percentage points: the page renders this through formatPercent.
    conversionRate: tasksExecuted > 0 ? (tasksWithOrders / tasksExecuted) * 100 : null,
    averageOrderValue: orders > 0 ? revenue / orders : null
  };
}

/** Daily series, already zero-filled and ascending in SQL. */
export async function getRevenueSeries({
  days
}: AnalyticsRange): Promise<RevenuePoint[]> {
  const supabase = await createSupabaseServerClient();
  const since = rangeStartIso(days);

  const { data, error } = await supabase.rpc("analytics_revenue_series", {
    p_since: since ?? undefined
  });
  const rows = requireRows("revenue series", data, error?.message);

  return rows.map((row) => ({
    date: row.day,
    revenue: num(row.revenue),
    commission: num(row.commission),
    orders: num(row.orders)
  }));
}

/** Commission / revenue grouped by `target_sources.name` in SQL. */
export async function getPerformanceBySource({
  days
}: AnalyticsRange): Promise<PerformanceSlice[]> {
  const supabase = await createSupabaseServerClient();
  const since = rangeStartIso(days);

  const { data, error } = await supabase.rpc("analytics_by_source", { p_since: since ?? undefined });
  const rows = requireRows("source performance", data, error?.message);

  return rows.map((row) => ({
    label: row.label,
    orders: num(row.orders),
    revenue: num(row.revenue),
    commission: num(row.commission)
  }));
}

/** Same rollup keyed by the account the comment ran on. */
export async function getPerformanceByAccount({
  days
}: AnalyticsRange): Promise<PerformanceSlice[]> {
  const supabase = await createSupabaseServerClient();
  const since = rangeStartIso(days);

  const { data, error } = await supabase.rpc("analytics_by_account", { p_since: since ?? undefined });
  const rows = requireRows("account performance", data, error?.message);

  return rows
    .map((row) => ({
      label: row.label,
      orders: num(row.orders),
      revenue: num(row.revenue),
      commission: num(row.commission)
    }))
    .sort((a, b) => b.revenue - a.revenue || b.commission - a.commission);
}

/**
 * Attribution table rows — tasks with at least one conversion inside the
 * window, most recent conversion first. The RPC clamps the limit to 1..500.
 */
export async function getTaskRoiRows({
  days,
  limit
}: AnalyticsRange & { limit: number }): Promise<TaskRoiRow[]> {
  const supabase = await createSupabaseServerClient();
  const since = rangeStartIso(days);

  const { data, error } = await supabase.rpc("analytics_task_roi", {
    p_since: since ?? undefined,
    p_limit: Math.max(1, Math.floor(limit))
  });

  return requireRows("task ROI", data, error?.message);
}

/** Lifetime per-account rollup; the view already aggregates in Postgres. */
export async function getAccountPerformance(): Promise<AccountPerformanceRow[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("v_account_performance")
    .select("*")
    .returns<AccountPerformanceRow[]>()
    .order("settled_commission", { ascending: false, nullsFirst: false })
    .order("revenue", { ascending: false, nullsFirst: false });

  return requireRows("account performance view", data, error?.message);
}

type RawConversionFeedRow = {
  id: string;
  sub_id: string;
  external_order_id: string | null;
  order_amount: number;
  estimated_commission: number;
  status: ConversionStatus;
  converted_at: string;
  /** PostgREST returns a many-to-one embed as an object; normalised below. */
  task: unknown;
};

function normalizeEmbeddedTask(value: unknown): ConversionFeedItem["task"] {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || typeof candidate !== "object") return null;

  const record = candidate as Record<string, unknown>;
  if (typeof record.id !== "string") return null;

  return {
    id: record.id,
    sub_id_code: typeof record.sub_id_code === "string" ? record.sub_id_code : null,
    post_url: typeof record.post_url === "string" ? record.post_url : ""
  };
}

/** Recent postbacks with the task they attribute to. */
export async function getConversionFeed({
  days,
  limit
}: AnalyticsRange & { limit: number }): Promise<ConversionFeedItem[]> {
  const supabase = await createSupabaseServerClient();
  const since = rangeStartIso(days);

  const query = supabase
    .from("affiliate_conversions")
    .select(
      "id, sub_id, external_order_id, order_amount, estimated_commission, status, converted_at, task:comment_tasks(id, sub_id_code, post_url)"
    )
    .order("converted_at", { ascending: false })
    .limit(Math.max(1, Math.floor(limit)));

  if (since) query.gte("converted_at", since);

  const { data, error } = await query.returns<RawConversionFeedRow[]>();
  const rows = requireRows("conversion feed", data, error?.message);

  return rows.map((row) => ({
    id: row.id,
    sub_id: row.sub_id,
    external_order_id: row.external_order_id,
    order_amount: num(row.order_amount),
    estimated_commission: num(row.estimated_commission),
    status: row.status,
    converted_at: row.converted_at,
    task: normalizeEmbeddedTask(row.task)
  }));
}
