/**
 * Bearer headers for the in-process route calls the demo makes (docs/TASKS.md P3-3).
 *
 * Two different gates, and mixing them up fails with a bare "Unauthorized":
 *   - `/api/worker/*` expects `WORKER_API_TOKEN`
 *   - `/api/cron/*` expects `CRON_SECRET`, falling back to the worker token only when
 *     `CRON_SECRET` is unset (that is how `authorizeCron` reads it)
 *
 * Extracted so the rule is testable — the demo used to send the worker token to the cron
 * route, which worked until a local `CRON_SECRET` existed, and then silently broke.
 */

export type TokenEnv = Record<string, string | undefined>;

export class MissingTokenError extends Error {
  constructor(name: string) {
    super(`${name} is required for this route — set it in the environment`);
    this.name = "MissingTokenError";
  }
}

function bearer(token: string): Record<string, string> {
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

export function workerAuthHeaders(env: TokenEnv = process.env): Record<string, string> {
  const token = env.WORKER_API_TOKEN?.trim();
  if (!token) throw new MissingTokenError("WORKER_API_TOKEN");
  return bearer(token);
}

/** Mirrors `authorizeCron`: CRON_SECRET first, then the worker token. */
export function cronAuthHeaders(env: TokenEnv = process.env): Record<string, string> {
  const token = env.CRON_SECRET?.trim() || env.WORKER_API_TOKEN?.trim();
  if (!token) throw new MissingTokenError("CRON_SECRET");
  return bearer(token);
}
