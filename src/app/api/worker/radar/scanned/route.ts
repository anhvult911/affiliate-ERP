import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { authorizeWorker, workerJson } from "@/lib/worker/auth";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  sourceId: z.string().uuid(),
  postsSeen: z.number().int().min(0).max(1000).default(0)
});

/**
 * POST /api/worker/radar/scanned
 *
 * Marks a source as scanned even when it produced nothing usable. Without this a
 * source whose every post is already queued would stay "due" forever and starve
 * the rest of the watchlist.
 */
export async function POST(request: Request) {
  const auth = authorizeWorker(request);
  if (!auth.ok) return auth.response;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return workerJson({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid body." }, 400);
  }

  const supabase = createSupabaseAdminClient();

  const { error } = await supabase
    .from("target_sources")
    .update({ last_scanned_at: new Date().toISOString() })
    .eq("id", parsed.data.sourceId);

  if (error) return workerJson({ ok: false, error: error.message }, 500);

  return workerJson({ ok: true });
}
