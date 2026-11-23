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
  captures: { total: number; bestScore: number | null };
};

export async function getOpsSnapshot(): Promise<OpsSnapshot> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("ops_snapshot").single();
  if (error) throw new Error(`Failed to load ops snapshot: ${error.message}`);

  return {
    products: {
      active: data.products_active,
      missingEmbedding: data.products_missing_embedding,
      lastCreatedAt: data.product_last_created_at
    },
    targets: {
      total: data.targets_total,
      active: data.targets_active,
      lastScannedAt: data.last_scanned_at
    },
    accounts: {
      total: data.accounts_total,
      active: data.accounts_active,
      lastWarmedAt: data.last_warmed_at
    },
    tasks: {
      pendingApproval: data.pending_approval,
      queued: data.queued,
      running: data.running,
      lastCreatedAt: data.task_last_created_at
    },
    dealt: {
      lastDealtAt: data.last_dealt_at,
      count7d: data.dealt_count_7d
    },
    captures: {
      total: data.recent_captures,
      bestScore: data.best_recent_score
    }
  };
}
