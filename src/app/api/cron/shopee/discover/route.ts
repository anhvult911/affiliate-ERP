import { NextResponse } from "next/server";

import { embedText, isGeminiConfigured } from "@/lib/ai/gemini";
import { authorizeCron } from "@/lib/cron/auth";
import { adminDb, type SupabaseDb } from "@/lib/db";
import { ShopeeClient, ShopeeRateLimitError } from "@/lib/shopee/client";
import { isShopeeConfigured, readShopeeConfig } from "@/lib/shopee/config";
import { shopeeSkipResponse } from "@/lib/shopee/cron";
import {
  DISCOVER_PLANS,
  DEFAULT_ADVISORIES,
  mergeDiscoveries,
  selectDiscoveries,
  toProductRow,
  type AvailableOffer
} from "@/lib/shopee/discover";
import { mapOfferNode } from "@/lib/shopee/reports";

export const dynamic = "force-dynamic";

/**
 * GET|POST /api/cron/shopee/discover
 *
 * Keyword-targeted product discovery: for each niche plan, searches Shopee offers by keyword,
 * applies the advisory filters and upserts the survivors with a `niche`.
 *
 * Why a second product cron exists next to `/api/cron/shopee/products`:
 * that one pages the default offer list and only fills price/commission columns. Rows landed with
 * `niche = null` and `embedding = null`, and the radar retrieves candidates by vector — so a
 * product imported that way can never be matched. This route closes both gaps: the niche comes
 * from the plan, and the rows it writes are embedded right after the upsert.
 *
 * Credential-gated like the others: answers 200 `skipped` until App ID/Secret exist, so the
 * schedule can be registered now.
 */

const KEYWORD_LIMIT = 50;
const PER_KEYWORD_KEEP = 8;
const PER_NICHE_CAP = 40;
const EMBED_PER_RUN = 12;

type OfferPage = {
  productOfferV2?: { nodes?: unknown[]; pageInfo?: { hasNextPage?: boolean } };
};

/** Shopee's keyword argument on productOfferV2; kept next to the query so a field rename is one edit. */
function searchOffersQuery(): string {
  return `query SearchOffers($keyword: String!, $page: Int!, $limit: Int!) {
  productOfferV2(keyword: $keyword, listType: 0, sortType: 2, page: $page, limit: $limit) {
    nodes {
      itemId productName priceMin priceMax commissionRate sellerCommissionRate
      shopeeCommissionRate sales ratingStar imageUrl shopId shopName
      productLink offerLink periodEndTime
    }
    pageInfo { page limit hasNextPage }
  }
}`;
}

function toAvailable(node: unknown): AvailableOffer | null {
  const row = mapOfferNode(node);
  if (!row) return null;
  return {
    shopee_item_id: row.shopee_item_id,
    name: row.name,
    affiliate_short_link: row.affiliate_short_link,
    price: row.price,
    commission_rate: row.commission_rate,
    sales: row.sales,
    rating_star: row.rating_star
  };
}

/**
 * Embeds rows that still have no vector, oldest first.
 *
 * A product without an embedding is invisible to `match_products`, so discovery that skips this
 * step just fills a table nobody reads. Failures are reported, never fatal: the next run retries.
 */
async function embedMissing(db: SupabaseDb, limit: number): Promise<{ embedded: number; failed: number }> {
  if (!isGeminiConfigured()) return { embedded: 0, failed: 0 };

  const { data } = await db
    .from("products")
    .select("id,name,niche,pros_cons_summary")
    .is("embedding", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  let embedded = 0;
  let failed = 0;

  for (const product of data ?? []) {
    const text = [product.name, product.niche, product.pros_cons_summary]
      .filter((part): part is string => Boolean(part))
      .join("\n");

    try {
      const vector = await embedText(text);
      const { error } = await db
        .from("products")
        .update({ embedding: JSON.stringify(vector) })
        .eq("id", product.id);
      if (error) failed += 1;
      else embedded += 1;
    } catch {
      failed += 1;
    }
  }

  return { embedded, failed };
}

async function run(request: Request) {
  const auth = authorizeCron(request);
  if (!auth.ok) return auth.response;

  if (!isShopeeConfigured()) return shopeeSkipResponse();

  const config = readShopeeConfig();
  const client = new ShopeeClient(config);
  const db = adminDb();

  let requestsUsed = 0;
  let rateLimited = false;
  let upserted = 0;
  const perNiche: Record<string, number> = {};

  for (const plan of DISCOVER_PLANS) {
    const lists: AvailableOffer[][] = [];

    for (const keyword of plan.keywords) {
      if (requestsUsed >= config.maxRequestsPerRun) {
        rateLimited = true;
        break;
      }

      try {
        requestsUsed += 1;
        const data = await client.query<OfferPage>(searchOffersQuery(), {
          keyword,
          page: 1,
          limit: KEYWORD_LIMIT
        });

        const offers = (data.productOfferV2?.nodes ?? [])
          .map(toAvailable)
          .filter((row): row is AvailableOffer => row !== null);

        lists.push(selectDiscoveries(offers, DEFAULT_ADVISORIES, PER_KEYWORD_KEEP));
      } catch (error) {
        // A rate limit ends the run but keeps what was already collected; anything else is a
        // real failure worth surfacing in the response.
        if (error instanceof ShopeeRateLimitError) {
          rateLimited = true;
          break;
        }
        throw error;
      }
    }

    const merged = mergeDiscoveries(lists, PER_NICHE_CAP);
    if (merged.length === 0) continue;

    const now = new Date().toISOString();
    const rows = merged.map((offer) => ({
      ...toProductRow(offer, plan.niche),
      sync_source: "discover",
      last_synced_at: now
    }));

    const { error } = await db.from("products").upsert(rows, { onConflict: "shopee_item_id" });
    if (error) {
      return NextResponse.json(
        { ok: false, error: `product upsert failed: ${error.message}` },
        { status: 500, headers: { "cache-control": "no-store" } }
      );
    }

    upserted += rows.length;
    perNiche[plan.niche] = rows.length;
  }

  const embedding = await embedMissing(db, EMBED_PER_RUN);

  return NextResponse.json(
    {
      ok: true,
      requestsUsed,
      rateLimited,
      upserted,
      perNiche,
      embedded: embedding.embedded,
      embedFailed: embedding.failed
    },
    { headers: { "cache-control": "no-store" } }
  );
}

export const GET = run;
export const POST = run;
