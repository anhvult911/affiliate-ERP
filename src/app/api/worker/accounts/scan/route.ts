import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { authorizeWorker, workerJson } from "@/lib/worker/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/worker/accounts/scan?limit=1
 *
 * Accounts the radar may browse with. Deliberately the healthiest active ones:
 * scanning is low-risk but it is still traffic from the account's own profile, so
 * a cooling or checkpointed account is never used and the best trust score wins.
 */
export async function GET(request: Request) {
  const auth = authorizeWorker(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 1), 1), 10);

  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("social_accounts")
    .select("id,name,browser_profile_id,proxy_ip,trust_score")
    .eq("status", "active")
    .not("browser_profile_id", "is", null)
    .order("trust_score", { ascending: false })
    .order("last_action_at", { ascending: true, nullsFirst: true })
    .limit(limit)
    .overrideTypes<
      { id: string; name: string; browser_profile_id: string | null; proxy_ip: string | null; trust_score: number }[],
      { merge: false }
    >();

  if (error) return workerJson({ ok: false, error: error.message }, 500);

  return workerJson({ ok: true, accounts: data ?? [] });
}
