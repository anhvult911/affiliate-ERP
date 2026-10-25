import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { authorizeWorker, workerJson } from "@/lib/worker/auth";

export const dynamic = "force-dynamic";

type SourceRow = {
  id: string;
  name: string;
  url: string;
  source_type: string;
  niche: string | null;
  scan_interval_mins: number;
  last_scanned_at: string | null;
};

/**
 * GET /api/worker/radar/sources?limit=5
 *
 * Which watchlist entries the scraper should scan now: active, with a usable
 * http(s) URL, and past their own interval. The interval math lives here (not in
 * the worker) so changing the cadence never needs a worker redeploy.
 */
export async function GET(request: Request) {
  const auth = authorizeWorker(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 5), 1), 25);

  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("target_sources")
    .select("id,name,url,source_type,niche,scan_interval_mins,last_scanned_at")
    .eq("is_active", true)
    .order("last_scanned_at", { ascending: true, nullsFirst: true })
    .limit(limit * 3)
    .overrideTypes<SourceRow[], { merge: false }>();

  if (error) return workerJson({ ok: false, error: error.message }, 500);

  const now = Date.now();
  const due = (data ?? []).filter((source) => {
    if (!/^https?:\/\//i.test(source.url)) return false;
    if (!source.last_scanned_at) return true;
    const elapsedMinutes = (now - new Date(source.last_scanned_at).getTime()) / 60_000;
    return elapsedMinutes >= source.scan_interval_mins;
  });

  return workerJson({ ok: true, sources: due.slice(0, limit) });
}
