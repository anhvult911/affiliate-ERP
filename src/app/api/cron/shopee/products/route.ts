import { NextResponse } from "next/server";

import { authorizeCron } from "@/lib/cron/auth";
import { adminDb } from "@/lib/db";
import { createRequestBudget } from "@/lib/shopee/budget";
import { ShopeeClient } from "@/lib/shopee/client";
import { isShopeeConfigured, readShopeeConfig } from "@/lib/shopee/config";
import { shopeeSkipResponse, syncResponse } from "@/lib/shopee/cron";
import { mapOfferNode, OFFERS_QUERY, type OfferRow } from "@/lib/shopee/reports";
import { acquireSyncLock, runPacedJob } from "@/lib/shopee/run";
import { advanceWatermark, recordSyncError } from "@/lib/shopee/sync-state";

export const dynamic = "force-dynamic";

/**
 * GET|POST /api/cron/shopee/products
 *
 * Pulls `productOfferV2` into `products`, upserting on `shopee_item_id` (the unique key
 * the CSV path also relies on). Runs every 6 hours; a rate limit stops the run and the
 * next tick continues, because the offer list is paged by number, not by cursor.
 *
 * Credential-gated: with no App ID/Secret this answers 200 `skipped`, so the schedule can
 * be registered before Shopee grants access.
 */

const PAGE_LIMIT = 50;
const MAX_PAGES = 20;

async function run(request: Request) {
  const auth = authorizeCron(request);
  if (!auth.ok) return auth.response;

  if (!isShopeeConfigured()) return shopeeSkipResponse();

  const db = adminDb();
  const kind = "product" as const;
  const lock = await acquireSyncLock(db, kind, `cron-products-${Date.now()}`);

  if (!lock.acquired) {
    return NextResponse.json(
      { ok: true, skipped: "SYNC_LOCKED", kind },
      { headers: { "cache-control": "no-store" } }
    );
  }

  try {
    const config = readShopeeConfig();
    const client = new ShopeeClient(config);
    let skippedRows = 0;

    const result = await runPacedJob<OfferRow>({
      budget: createRequestBudget(config.maxRequestsPerRun),
      fetchPage: async (cursor) => {
        const pageNumber = cursor ? Number.parseInt(cursor, 10) : 1;

        const data = await client.query<{
          productOfferV2?: { nodes?: unknown[]; pageInfo?: { hasNextPage?: boolean } };
        }>(OFFERS_QUERY, { page: pageNumber, limit: PAGE_LIMIT });

        const nodes = data.productOfferV2?.nodes ?? [];
        const rows: OfferRow[] = [];

        for (const node of nodes) {
          const row = mapOfferNode(node);
          if (row) rows.push(row);
          else skippedRows += 1;
        }

        const hasNext = Boolean(data.productOfferV2?.pageInfo?.hasNextPage) && pageNumber < MAX_PAGES;
        return { items: rows, nextCursor: hasNext ? String(pageNumber + 1) : null };
      },
      ingestPage: async (rows) => {
        if (rows.length === 0) return new Date();

        const { error } = await db.from("products").upsert(
          rows.map((row) => ({ ...row, is_active: true, sync_source: "api", last_synced_at: new Date().toISOString() })),
          { onConflict: "shopee_item_id" }
        );

        if (error) throw new Error(`product upsert failed: ${error.message}`);
        return new Date();
      },
      commitWatermark: async (at) => {
        await advanceWatermark(db, kind, at);
      },
      recordError: async (message) => {
        await recordSyncError(db, kind, message);
      }
    });

    // A node without itemId/name/offerLink is skipped, not fatal; say how many.
    return syncResponse(kind, result, skippedRows > 0 ? { skippedRows } : {});
  } finally {
    await lock.release();
  }
}

export const GET = run;
export const POST = run;
