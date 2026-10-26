/**
 * Who owns `executed_at` on a report (docs/REVIEW.md P2-7).
 *
 * The worker used to send whatever clock it had and the server stored it verbatim. A
 * VPS with a broken NTP would then backdate `executed_at`, which shifts the rolling
 * 24-hour window behind `daily_comment_limit` and the day buckets in analytics — the
 * account would look idle when it was not (or busy when it was not).
 *
 * The server's clock is authoritative. A client timestamp is accepted only inside a
 * small tolerance, which keeps the useful case (a run queued behind another finished a
 * few seconds ago) and rejects a machine that is minutes or hours out.
 */

/** ±2 minutes: generous for clock drift, meaningless for backdating a day. */
export const EXECUTION_TIME_TOLERANCE_MS = 2 * 60_000;

/**
 * Returns the instant to store for a report.
 *
 * @param clientValue ISO string sent by the worker, if any.
 * @param now        server time (injectable for tests).
 */
export function resolveExecutedAt(
  clientValue: string | null | undefined,
  now: Date = new Date(),
  toleranceMs: number = EXECUTION_TIME_TOLERANCE_MS
): string {
  if (!clientValue) return now.toISOString();

  const parsed = new Date(clientValue);
  if (Number.isNaN(parsed.getTime())) return now.toISOString();

  const drift = Math.abs(now.getTime() - parsed.getTime());
  return drift <= toleranceMs ? parsed.toISOString() : now.toISOString();
}

/** True when the server overrode the client's timestamp (used for logging). */
export function wasExecutedAtOverridden(
  clientValue: string | null | undefined,
  resolved: string
): boolean {
  if (!clientValue) return false;
  const parsed = new Date(clientValue);
  if (Number.isNaN(parsed.getTime())) return true;
  return parsed.toISOString() !== resolved;
}
