import { NextResponse } from "next/server";

/**
 * Bearer-token gate for scheduled jobs (`/api/cron/*`).
 *
 * `CRON_SECRET` when set (recommended once the app is public), otherwise the worker
 * token, so a private VPS needs no extra configuration. Loops are tightened to the
 * timing-safe comparison the Telegram webhook already uses.
 */
export function authorizeCron(request: Request): { ok: true } | { ok: false; response: NextResponse } {
  const expected = process.env.CRON_SECRET?.trim() || process.env.WORKER_API_TOKEN?.trim();

  if (!expected) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "CRON_SECRET is not configured." }, { status: 503 })
    };
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!token || token.length !== expected.length || !safeEqual(token, expected)) {
    return { ok: false, response: NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 }) };
  }

  return { ok: true };
}

/** Constant-time compare; equal lengths are enforced by the caller. */
function safeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}
