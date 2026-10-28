import { NextResponse } from "next/server";

import { authorizeCron } from "@/lib/cron/auth";
import { adminDb } from "@/lib/db";
import { createRequestBudget } from "@/lib/shopee/budget";
import { ShopeeClient } from "@/lib/shopee/client";
import { isShopeeConfigured, readShopeeConfig } from "@/lib/shopee/config";
import { shopeeSkipResponse, syncResponse } from "@/lib/shopee/cron";
import { applyConversion, reconcileAfterIngest } from "@/lib/shopee/conversions";
import { CONVERSIONS_QUERY, flattenConversionNodes, type ConversionRow } from "@/lib/shopee/reports";
import { acquireSyncLock, runPacedJob } from "@/lib/shopee/run";
import { advanceWatermark, readSyncState, recordSyncError } from "@/lib/shopee/sync-state";
import { planSyncWindow } from "@/lib/shopee/sync-state";

export const dynamic = "force-dynamic";

/**
 * GET|POST /api/cron/shopee/conversions
 *
 * Pulls `conversionReport` every 60 minutes and writes it through `applyConversion` — the
 * same merge path as the postback — then reconciles orders whose Sub_ID only appeared
 * later. Window and watermark come from `affiliate_sync_state`, so a run that dies on
 * page 4 keeps pages 1–3 and the next tick re-reads a small overlap
 * (`planSyncWindow`), because Shopee reports late.
 *
 * Credential-gated: 200 `skipped` until App ID/Secret exist.
 */

const PAGE_LIMIT = 200;

async function run(request: Request) {
  const auth = authorizeCron(request);
  if (!auth.ok) return auth.response;

  if (!isShopeeConfigured()) return shopeeSkipResponse();

  const db = adminDb();
  const kind = "conversion" as const;
  const lock = await acquireSyncLock(db, kind, `cron-conversions-${Date.now()}`);

  if (!lock.acquired) {
    return NextResponse.json(
      { ok: true, skipped: "SYNC_LOCKED", kind },
      { headers: { "cache-control": "no-store" } }
    );
  }

  try {
    const config = readShopeeConfig();
    const client = new ShopeeClient(config);
    const state = await readSyncState(db, kind);
    const window = planSyncWindow({
      now: new Date(),
      watermark: state.watermark ? new Date(state.watermark) : null
    });

    let written = 0;
    let unattributable = 0;
    let reconciled = 0;

    const result = await runPacedJob<ConversionRow>({
      budget: createRequestBudget(config.maxRequestsPerRun),
      fetchPage: async (cursor) => {
        const data = await client.query<{
          conversionReport?: {
            nodes?: unknown[];
            pageInfo?: { hasNextPage?: boolean; scrollId?: string | null };
          };
        }>(CONVERSIONS_QUERY, {
          start: Math.floor(window.start.getTime() / 1_000),
          end: Math.floor(window.end.getTime() / 1_000),
          scrollId: cursor,
          limit: PAGE_LIMIT
        });

        const report = data.conversionReport;
        const rows = flattenConversionNodes(report?.nodes ?? []);
        const next =
          report?.pageInfo?.hasNextPage && report?.pageInfo?.scrollId
            ? report.pageInfo.scrollId
            : null;

        return { items: rows, nextCursor: next };
      },
      ingestPage: async (rows) => {
        let newest = window.start;

        for (const row of rows) {
          // An empty Sub_ID cannot be attributed, but the row must still be stored so the
          // money is visible and `reconcile_conversions()` can attach it later.
          if (!row.subId) unattributable += 1;

          await applyConversion(db, row);
          written += 1;

          if (row.convertedAt) {
            const at = new Date(row.convertedAt);
            if (at.getTime() > newest.getTime()) newest = at;
          }
        }

        const reconcile = await reconcileAfterIngest(db);
        reconciled += reconcile.attributed;

        return newest;
      },
      commitWatermark: async (at) => {
        await advanceWatermark(db, kind, at);
      },
      recordError: async (message) => {
        await recordSyncError(db, kind, message);
      }
    });

    return syncResponse(kind, result, {
      windowStart: window.start.toISOString(),
      windowEnd: window.end.toISOString(),
      written,
      unattributable,
      reconciled
    });
  } finally {
    await lock.release();
  }
}

export const GET = run;
export const POST = run;
