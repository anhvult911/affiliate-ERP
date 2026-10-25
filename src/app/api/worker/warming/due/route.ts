import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { authorizeWorker, workerJson } from "@/lib/worker/auth";
import { findDueWarming } from "@/lib/warming/due";

export const dynamic = "force-dynamic";

/**
 * GET /api/worker/warming/due
 *
 * Persona-warming work that is actionable right now: lifestyle posts whose
 * scheduled slot has opened, and cross-warming comments (warm another account's
 * recent post). The schedule lives in `social_accounts.persona_schedule`, in the
 * operator's local time; the app converts it and applies the grace window, so the
 * worker only has to execute what it is handed.
 */
export async function GET(request: Request) {
  const auth = authorizeWorker(request);
  if (!auth.ok) return auth.response;

  const supabase = createSupabaseAdminClient();

  try {
    const slots = await findDueWarming(supabase);
    return workerJson({ ok: true, slots });
  } catch (error) {
    return workerJson(
      { ok: false, error: error instanceof Error ? error.message : "Could not compute warming work." },
      500
    );
  }
}
