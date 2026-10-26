import { NextResponse } from "next/server";

import { readBearerToken, secureCompare } from "@/lib/security/constant-time";

/**
 * Bearer-token gate for scheduled jobs (`/api/cron/*`).
 *
 * `CRON_SECRET` when set (recommended once the app is public), otherwise the worker
 * token, so a private VPS needs no extra configuration. Comparison is constant-time
 * through the shared `secureCompare`.
 */
export function authorizeCron(request: Request): { ok: true } | { ok: false; response: NextResponse } {
  const expected = process.env.CRON_SECRET?.trim() || process.env.WORKER_API_TOKEN?.trim();

  if (!expected) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "CRON_SECRET is not configured." }, { status: 503 })
    };
  }

  const token = readBearerToken(request.headers.get("authorization"));

  if (token.length === 0 || !secureCompare(token, expected)) {
    return { ok: false, response: NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 }) };
  }

  return { ok: true };
}
