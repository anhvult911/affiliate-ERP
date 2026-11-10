import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Read-only queries for the ops board.
 *
 * Every number here comes from the database the worker and the cron jobs write to — no mock
 * data, no "assume it is running". Stages with no activity row are reported as idle rather than
 * being hidden, because the interesting failure is the one that left no trace.
 */

export type OpsSnapshot = {
  products: { active: number; missingEmbedding: number; lastCreatedAt: string | null };
  targets: { total: number; active: number; lastScannedAt: string | null };
  accounts: { total: number; active: number; lastWarmedAt: string | null };
  tasks: { pendingApproval: number; queued: number; running: number; lastCreatedAt: string | null };
  dealt: { lastDealtAt: string | null; count7d: number };
  captures: { total: number; lastSeenAt: string | null; bestScore: number | null };
};

function newest(values: (string | null | undefined)[]): string | null {
  const times = values
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .map((v) => new Date(v).getTime())
    .filter((t) => Number.isFinite(t));
  if (times.length === 0) return null;
  return new Date(Math.max(...times)).toISOString();
}

export async function getOpsSnapshot(): Promise<OpsSnapshot> {
  const supabase = await createSupabaseServerClient();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString();

  const [products, targets, accounts, tasks, dealt, captures] = await Promise.all([
    supabase.from("products").select("is_active, embedding, created_at"),
    supabase.from("target_sources").select("is_active, last_scanned_at"),
    supabase.from("social_accounts").select("status, last_warmed_at"),
    supabase.from("comment_tasks").select("status, created_at").limit(500),
    supabase.from("products").select("last_dealt_at").gte("last_dealt_at", sevenDaysAgo),
    supabase.from("radar_seen").select("score, seen_at").order("seen_at", { ascending: false }).limit(200)
  ]);

  const productRows = products.data ?? [];
  const targetRows = targets.data ?? [];
  const accountRows = accounts.data ?? [];
  const taskRows = tasks.data ?? [];
  const dealtRows = dealt.data ?? [];
  const captureRows = captures.data ?? [];

  const scores = captureRows
    .map((r) => r.score)
    .filter((s): s is number => typeof s === "number");

  return {
    products: {
      active: productRows.filter((p) => p.is_active).length,
      // A product without an embedding can never be a candidate: the radar retrieves by vector.
      missingEmbedding: productRows.filter((p) => !p.embedding).length,
      lastCreatedAt: newest(productRows.map((p) => p.created_at))
    },
    targets: {
      total: targetRows.length,
      active: targetRows.filter((t) => t.is_active).length,
      lastScannedAt: newest(targetRows.map((t) => t.last_scanned_at))
    },
    accounts: {
      total: accountRows.length,
      active: accountRows.filter((a) => a.status === "active").length,
      lastWarmedAt: newest(accountRows.map((a) => a.last_warmed_at))
    },
    tasks: {
      pendingApproval: taskRows.filter((t) => t.status === "pending_approval").length,
      queued: taskRows.filter((t) => t.status === "queued").length,
      running: taskRows.filter((t) => t.status === "running").length,
      lastCreatedAt: newest(taskRows.map((t) => t.created_at))
    },
    dealt: {
      lastDealtAt: newest(dealtRows.map((d) => d.last_dealt_at)),
      count7d: dealtRows.length
    },
    captures: {
      total: captureRows.length,
      lastSeenAt: newest(captureRows.map((c) => c.seen_at)),
      bestScore: scores.length ? Math.max(...scores) : null
    }
  };
}
