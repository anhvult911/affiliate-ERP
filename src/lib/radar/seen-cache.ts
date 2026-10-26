import type { SupabaseDb } from "@/lib/db";

/**
 * Negative cache for the radar (docs/REVIEW.md P2-4).
 *
 * A post that matched nothing is remembered so the next scan of the same source does
 * not embed and re-rank it. That matters because it is the *old* posts that repeat:
 * the top of a group feed barely changes between two 15-minute scans, so without this
 * the same handful of posts costs a Gemini call on every cycle.
 *
 * Deliberately separate from `radar_scans` (P1-3): that table counts scan runs for
 * rotation and the blind-radar alert; this one remembers a judgement about a post.
 * A scan can be counted even when every post in it was a cache hit.
 */

/** How long a negative judgement is trusted before the post is scored again. */
export const DEFAULT_SEEN_TTL_DAYS = 30;

export const SEEN_TTL_ENV = "RADAR_SEEN_TTL_DAYS";

export type SeenEntry = {
  postUrl: string;
  score: number | null;
  seenAt: string;
};

export function seenTtlDays(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env[SEEN_TTL_ENV]?.trim());
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_SEEN_TTL_DAYS;
}

/**
 * Whether a cached judgement may skip the AI call.
 *
 * `ttlDays = 0` disables the cache (useful when tuning the threshold). A future
 * `seen_at` — clock skew or a bad manual insert — is treated as stale so the post is
 * re-scored rather than trusted.
 */
export function shouldSkipSeen(
  entry: Pick<SeenEntry, "seenAt"> | null,
  options: { now?: Date; ttlDays?: number } = {}
): boolean {
  if (!entry) return false;

  const ttlDays = options.ttlDays ?? seenTtlDays();
  if (ttlDays <= 0) return false;

  const now = options.now ?? new Date();
  const seen = new Date(entry.seenAt);
  if (Number.isNaN(seen.getTime())) return false;
  if (seen.getTime() > now.getTime()) return false;

  const ageMs = now.getTime() - seen.getTime();
  return ageMs < ttlDays * 24 * 3_600_000;
}

export async function readSeen(db: SupabaseDb, postUrl: string): Promise<SeenEntry | null> {
  const { data, error } = await db
    .from("radar_seen")
    .select("post_url,score,seen_at")
    .eq("post_url", postUrl)
    .maybeSingle()
    .overrideTypes<{ post_url: string; score: number | string | null; seen_at: string } | null, { merge: false }>();

  // A cache lookup must never break ingest: a missing table (migration not applied yet)
  // or a transient error just means "score it".
  if (error || !data) return null;

  return {
    postUrl: data.post_url,
    score: data.score === null ? null : Number(data.score),
    seenAt: data.seen_at
  };
}

/** Upserts the judgement; re-judging a post refreshes the timestamp and the score. */
export async function recordSeen(
  db: SupabaseDb,
  input: { postUrl: string; sourceId: string | null; score: number | null; reason: string | null }
): Promise<void> {
  const { error } = await db.from("radar_seen").upsert(
    {
      post_url: input.postUrl,
      source_id: input.sourceId,
      score: input.score,
      reason: input.reason,
      seen_at: new Date().toISOString()
    },
    { onConflict: "post_url" }
  );

  // Best-effort: failing to cache costs a future Gemini call, not a lost capture.
  if (error) console.error(`[radar] could not cache the judgement for ${input.postUrl}: ${error.message}`);
}
