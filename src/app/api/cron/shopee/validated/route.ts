import { NextResponse } from "next/server";

import { authorizeCron } from "@/lib/cron/auth";
import { adminDb } from "@/lib/db";
import { createRequestBudget } from "@/lib/shopee/budget";
import { ShopeeClient } from "@/lib/shopee/client";
import { isShopeeConfigured, readShopeeConfig } from "@/lib/shopee/config";
import { shopeeSkipResponse, syncResponse } from "@/lib/shopee/cron";
import { applyConversion } from "@/lib/shopee/conversions";
import { flattenValidatedNode, VALIDATED_QUERY, type ValidatedRow } from "@/lib/shopee/reports";
import { acquireSyncLock, runPacedJob } from "@/lib/shopee/run";
import { advanceWatermark, recordSyncError } from "@/lib/shopee/sync-state";

export const dynamic = "force-dynamic";

/**
 * GET|POST /api/cron/shopee/validated
 *
 * Daily. `validatedReport` is the money Shopee has finalised; matching rows move the
 * conversion to `settled` with the net commission. `applyConversion` already rules that
 * status only moves forward, so a replay cannot demote a settled order.
 *
 * Two gates before any request:
 *   1. no App ID/Secret → 200 `SHOPEE_CRED_PENDING`;
 *   2. no `SHOPEE_VALIDATION_ID` → 200 `SHOPEE_VALIDATION_PENDING`. The id comes from
 *      Billing Information in the affiliate dashboard and the API requires it, so the
 *      route cannot invent one.
 */

const PAGE_LIMIT = 200;

async function run(request: Request) {
  const auth = authorizeCron(request);
  if (!auth.ok) return auth.response;

  if (!isShopeeConfigured()) return shopeeSkipResponse();

  const validationId = process.env.SHOPEE_VALIDATION_ID?.trim() ?? "";
  if (!validationId) return shopeeSkipResponse("SHOPEE_VALIDATION_PENDING");

  const db = adminDb();
  const kind = "validated" as const;
  const lock = await acquireSyncLock(db, kind, `cron-validated-${Date.now()}`);

  if (!lock.acquired) {
    return NextResponse.json(
      { ok: true, skipped: "SYNC_LOCKED", kind },
      { headers: { "cache-control": "no-store" } }
    );
  }

  try {
    const config = readShopeeConfig();
    const client = new ShopeeClient(config);
    let settled = 0;

    const result = await runPacedJob<ValidatedRow>({
      budget: createRequestBudget(config.maxRequestsPerRun),
      fetchPage: async (cursor) => {
        const data = await client.query<{
          validatedReport?: {
            nodes?: unknown[];
            pageInfo?: { hasNextPage?: boolean; scrollId?: string | null };
          };
        }>(VALIDATED_QUERY, { validationId, scrollId: cursor, limit: PAGE_LIMIT });

        const report = data.validatedReport;
        const rows = (report?.nodes ?? []).flatMap((node) => flattenValidatedNode(node));
        const next =
          report?.pageInfo?.hasNextPage && report?.pageInfo?.scrollId
            ? report.pageInfo.scrollId
            : null;

        return { items: rows, nextCursor: next };
      },
      ingestPage: async (rows) => {
        for (const row of rows) {
          await applyConversion(db, row);
          settled += 1;
        }

        return new Date();
      },
      commitWatermark: async (at) => {
        await advanceWatermark(db, kind, at);
      },
      recordError: async (message) => {
        await recordSyncError(db, kind, message);
      }
    });

    return syncResponse(kind, result, { settled });
  } finally {
    await lock.release();
  }
}

export const GET = run;
export const POST = run;
