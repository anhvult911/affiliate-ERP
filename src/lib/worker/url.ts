/**
 * Post URLs arrive with per-share tracking noise, which would defeat the unique
 * index on comment_tasks.post_url and let the same post be captured (and
 * commented on) twice. Strip the noise, keep the identity of the post.
 */

/** Exact-match parameters that never identify a post. */
const TRACKING_PARAMS = new Set([
  "comment_id",
  "reply_comment_id",
  "ref",
  "refid",
  "refsource",
  "mibextid",
  "rdid",
  "share_url",
  "sfnsn",
  "locale",
  "locale2",
  "extid",
  "paipv",
  "eav",
  "acontext"
]);

/** Prefix-matched parameters (`__cft__[0]`, `utm_source`, ...). */
const TRACKING_PREFIXES = ["__", "utm_", "hc_", "fbclid", "gclid"];

export function normalizePostUrl(raw: string): string {
  const trimmed = raw.trim();

  try {
    const url = new URL(trimmed);

    for (const key of [...url.searchParams.keys()]) {
      const lowered = key.toLowerCase();
      if (TRACKING_PARAMS.has(lowered) || TRACKING_PREFIXES.some((prefix) => lowered.startsWith(prefix))) {
        url.searchParams.delete(key);
      }
    }

    url.hash = "";
    // Facebook post URLs are case-insensitive on the path for ids, but not for
    // everything — only the trailing slash is safe to normalize.
    return url.toString().replace(/\/$/, "");
  } catch {
    return trimmed;
  }
}
