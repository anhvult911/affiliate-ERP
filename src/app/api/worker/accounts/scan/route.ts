import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { authorizeWorker, workerJson } from "@/lib/worker/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/worker/accounts/scan?limit=1
 *
 * Accounts the radar may browse with. Rotation is the point (docs/REVIEW.md P1-3):
 * the account that scanned least recently goes first, and an account that reached
 * `daily_scan_limit` in the last 24h is out. Before this, the same highest-trust
 * account scanned every source on every cycle, all day.
 *
 * `scan_accounts()` also returns `scans_24h` so the worker log and this endpoint
 * agree on the budget.
 */
export async function GET(request: Request) {
  const auth = authorizeWorker(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 1), 1), 10);

  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .rpc("scan_accounts", { p_limit: limit })
    .overrideTypes<
      {
        id: string;
        name: string;
        browser_profile_id: string | null;
        proxy_ip: string | null;
        trust_score: number;
        scans_24h: number;
      }[],
      { merge: false }
    >();

  if (error) return workerJson({ ok: false, error: error.message }, 500);

  return workerJson({ ok: true, accounts: data ?? [] });
}
