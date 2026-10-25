import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { authorizeWorker, workerJson } from "@/lib/worker/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/worker/accounts
 *
 * The account farm inventory: everything the browser worker needs to open an
 * antidetect profile, plus the warming schedule it must respect and the health
 * state it must skip.
 */
export async function GET(request: Request) {
  const auth = authorizeWorker(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const includeInactive = url.searchParams.get("includeInactive") === "true";

  const supabase = createSupabaseAdminClient();

  let query = supabase
    .from("social_accounts")
    .select(
      "id,name,platform,persona_type,browser_profile_id,proxy_ip,status,trust_score,bio_link_url,persona_schedule,warmup_enabled,cooldown_until,last_action_at,last_warmed_at"
    )
    .order("trust_score", { ascending: false });

  if (!includeInactive) query = query.eq("status", "active");

  const { data, error } = await query;
  if (error) return workerJson({ ok: false, error: error.message }, 500);

  return workerJson({
    ok: true,
    accounts: (data ?? []).filter((account) => Boolean(account.browser_profile_id))
  });
}
