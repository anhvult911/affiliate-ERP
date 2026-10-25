import { NextResponse } from "next/server";

import { adminDb } from "@/lib/db";
import { authorizeCron } from "@/lib/cron/auth";

export const dynamic = "force-dynamic";

/**
 * GET|POST /api/cron/reconcile
 *
 * Attributes orders that reached us before their task had a Sub_ID. Safe to run as
 * often as you like: it only fills `task_id` where it is NULL and a matching
 * `sub_id_code` exists, and never rewrites a row that is already attributed.
 *
 * Schedule it every 15–30 minutes alongside `/api/cron/health`.
 */
async function run(request: Request) {
  const auth = authorizeCron(request);
  if (!auth.ok) return auth.response;

  const { data, error } = await adminDb().rpc("reconcile_conversions").maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const result = (data ?? { attributed: 0, remaining: 0 }) as {
    attributed: number;
    remaining: number;
  };

  return NextResponse.json(
    { ok: true, attributed: result.attributed, remaining: result.remaining },
    { headers: { "cache-control": "no-store" } }
  );
}

export const GET = run;
export const POST = run;
