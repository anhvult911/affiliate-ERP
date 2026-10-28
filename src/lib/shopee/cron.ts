import { NextResponse } from "next/server";

import type { PacedJobResult } from "@/lib/shopee/run";

/**
 * Response shaping shared by the three Shopee pull routes (P5-2).
 *
 * Two rules from docs/TASKS.md T-SHOPEE-13:
 *   - an unconfigured publisher is **not** an error: the cron answers 200 with
 *     `skipped`, so nobody is paged for a credential that has not arrived yet;
 *   - a rate limit / access error **stops** the run and returns 200 — the next tick
 *     resumes from the watermark, and a cron monitor should not treat a documented
 *     back-off as a failure. Only a `fail` classification (bad query, broken params)
 *     returns 5xx, because that needs a human.
 */

export const SHOPEE_CRED_PENDING = "SHOPEE_CRED_PENDING";

export function shopeeSkipResponse(reason: string = SHOPEE_CRED_PENDING, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json(
    { ok: true, skipped: reason, ...extra },
    { headers: { "cache-control": "no-store" } }
  );
}

export function syncStatusFor(result: PacedJobResult): number {
  return result.status === "failed" ? 500 : 200;
}

export function syncResponse(
  kind: string,
  result: PacedJobResult,
  extra: Record<string, unknown> = {}
): NextResponse {
  const base = {
    kind,
    status: result.status,
    action: result.action ?? "ok",
    pages: result.pages,
    requests: result.requests,
    items: result.items
  };

  if (result.status === "failed") {
    return NextResponse.json(
      { ok: false, ...base, ...extra, error: result.error ?? "Sync failed." },
      { status: 500, headers: { "cache-control": "no-store" } }
    );
  }

  return NextResponse.json(
    { ok: true, ...base, ...extra, ...(result.error ? { error: result.error } : {}) },
    { status: 200, headers: { "cache-control": "no-store" } }
  );
}
