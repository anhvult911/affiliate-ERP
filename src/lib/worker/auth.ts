import { NextResponse } from "next/server";

import { readBearerToken, secureCompare } from "@/lib/security/constant-time";

/**
 * Bearer-token gate for everything under /api/worker/* and /api/postback/*.
 * These routes run with the service role and bypass RLS, so the token is the
 * only thing standing between the internet and the automation surface.
 *
 * The token lives in WORKER_API_TOKEN (see .env.example, generate with
 * `openssl rand -hex 32`) and is shared with the Python worker.
 *
 * The comparison is constant-time (`secureCompare`) on purpose: see docs/REVIEW.md
 * P1-1 — every other bearer gate in the app already was.
 */
export function authorizeWorker(request: Request): { ok: true } | { ok: false; response: NextResponse } {
  const expected = process.env.WORKER_API_TOKEN?.trim();

  if (!expected) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "WORKER_API_TOKEN is not configured on the server." },
        { status: 503 }
      )
    };
  }

  const token = readBearerToken(request.headers.get("authorization"));

  // Constant-time: this token is the only gate in front of the service-role worker
  // surface (claim, credentials, postback money), so a timing oracle is not allowed
  // even if exploiting it is slow.
  if (!secureCompare(token, expected)) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
    };
  }

  return { ok: true };
}

export function workerJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" }
  });
}
