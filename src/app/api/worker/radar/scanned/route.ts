import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notifyRadarBlind } from "@/lib/telegram/notify";
import { authorizeWorker, workerJson } from "@/lib/worker/auth";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  sourceId: z.string().uuid(),
  postsSeen: z.number().int().min(0).max(1000).default(0),
  /** The account that browsed, so rotation and the scan budget can be enforced. */
  accountId: z.string().uuid().optional()
});

/** Consecutive empty scans that mean the selectors stopped matching. */
const EMPTY_ALERT_STREAK = Number(process.env.RADAR_EMPTY_SCAN_ALERT?.trim() || 3);

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

  const scannedAt = new Date().toISOString();

  const { error } = await supabase
    .from("target_sources")
    .update({ last_scanned_at: scannedAt })
    .eq("id", parsed.data.sourceId);

  if (error) return workerJson({ ok: false, error: error.message }, 500);

  if (parsed.data.accountId) {
    const accountId = parsed.data.accountId;

    // The audit row drives both rotation (last_scanned_at) and the blind-radar alert.
    const { error: rowError } = await supabase.from("radar_scans").insert({
      account_id: accountId,
      source_id: parsed.data.sourceId,
      posts_seen: parsed.data.postsSeen
    });

    if (rowError) return workerJson({ ok: false, error: rowError.message }, 500);

    await supabase
      .from("social_accounts")
      .update({ last_scanned_at: scannedAt })
      .eq("id", accountId);
  }

  const { data: streak, error: streakError } = await supabase.rpc("radar_empty_streak");
  if (streakError) return workerJson({ ok: false, error: streakError.message }, 500);

  const emptyStreak = typeof streak === "number" ? streak : 0;
  let alerted = false;

  // Alert exactly when the streak reaches the threshold, not on every scan after it:
  // the operator gets one message per outage instead of one per cycle.
  if (EMPTY_ALERT_STREAK > 0 && emptyStreak === EMPTY_ALERT_STREAK) {
    alerted = true;
    await notifyRadarBlind({ emptyStreak, sourceId: parsed.data.sourceId, accountId: parsed.data.accountId ?? null });
  }

  return workerJson({ ok: true, emptyStreak, alerted });
}
