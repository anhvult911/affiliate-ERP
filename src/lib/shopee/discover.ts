/**
 * Product discovery: turn Shopee's offer search into a product pool that the radar can use.
 *
 * The existing `/api/cron/shopee/products` sync already imports offers, but it imports whatever
 * the default list returns and writes rows with `niche = null` and no embedding — and a product
 * with neither can never be retrieved as a candidate by `match_products`. So "auto import" looked
 * done while the radar stayed at zero matches.
 *
 * This module fixes the two gaps that matter: a per-niche keyword plan (so each row lands in a
 * niche that target_sources actually use) and advisory filters (so the pool is products people
 * ask about, not whatever Shopee promotes today).
 */

export type DiscoverPlan = {
  niche: string;
  keywords: string[];
};

/**
 * Keywords are the questions the sourcing groups actually ask, not categories from a taxonomy.
 * Kept short on purpose: every keyword costs one API page against a rate limit.
 */
export const DISCOVER_PLANS: DiscoverPlan[] = [
  {
    niche: "me_bim",
    keywords: ["bỉm sơ sinh", "sữa bột cho bé", "kem đánh răng trẻ em", "khăn ướt em bé", "đồ chơi giáo dục"]
  },
  {
    niche: "gia_dung",
    keywords: ["nồi chiên không dầu", "máy hút bụi cầm tay", "hộp đựng thực phẩm", "chảo chống dính"]
  }
];

export type AvailableOffer = {
  shopee_item_id: string;
  name: string;
  /** products.affiliate_short_link is NOT NULL, so an offer without a link is not usable. */
  affiliate_short_link: string;
  price: number | null;
  commission_rate: number | null;
  sales: number | null;
  rating_star: number | null;
};

export type Advisories = {
  /** Percent, e.g. 4 means 4%. */
  minCommissionRate: number;
  minSales: number;
  minRating: number;
  minPrice: number;
  maxPrice: number;
};

/**
 * Chosen from what the groups discuss (150-500k baby/kitchen items, well-reviewed, real sellers):
 * a product that pays 1% or has 12 sales cannot fund a channel and adds noise to every match.
 */
export const DEFAULT_ADVISORIES: Advisories = {
  minCommissionRate: 4,
  minSales: 100,
  minRating: 4.3,
  minPrice: 100_000,
  maxPrice: 800_000
};

/** Null rating/sales means Shopee did not report it — treated as "unknown", not as "good". */
export function passesAdvisories(offer: AvailableOffer, advisories: Advisories = DEFAULT_ADVISORIES): boolean {
  if (!offer.shopee_item_id || !offer.name) return false;
  if (!offer.affiliate_short_link || !/^https?:\/\//i.test(offer.affiliate_short_link)) return false;

  if (offer.commission_rate === null || offer.commission_rate < advisories.minCommissionRate) return false;
  if (offer.sales === null || offer.sales < advisories.minSales) return false;
  if (offer.rating_star === null || offer.rating_star < advisories.minRating) return false;

  if (offer.price === null) return false;
  if (offer.price < advisories.minPrice || offer.price > advisories.maxPrice) return false;

  return true;
}

/**
 * Filters one keyword's page and returns at most `limit` rows, cheapest commission risk first:
 * higher commission, then more sales. Deterministic so a re-run produces the same pool.
 */
export function selectDiscoveries(
  offers: AvailableOffer[],
  advisoryInput: Advisories = DEFAULT_ADVISORIES,
  limit = 8
): AvailableOffer[] {
  const seen = new Set<string>();
  const kept: AvailableOffer[] = [];

  for (const offer of offers) {
    if (!passesAdvisories(offer, advisoryInput)) continue;
    if (seen.has(offer.shopee_item_id)) continue;
    seen.add(offer.shopee_item_id);
    kept.push(offer);
  }

  kept.sort((a, b) => {
    const commission = (b.commission_rate ?? 0) - (a.commission_rate ?? 0);
    if (commission !== 0) return commission;
    return (b.sales ?? 0) - (a.sales ?? 0);
  });

  return kept.slice(0, Math.max(limit, 0));
}

/**
 * Merges per-keyword results into one pool, de-duplicated by item id.
 *
 * The same item can appear under several keywords (a "sữa bột" search also returns toothbrushes
 * for some sellers), and upserting the same key twice in one statement is a Postgres error.
 */
export function mergeDiscoveries(lists: AvailableOffer[][], limit = 40): AvailableOffer[] {
  const seen = new Set<string>();
  const merged: AvailableOffer[] = [];

  for (const list of lists) {
    for (const offer of list) {
      if (seen.has(offer.shopee_item_id)) continue;
      seen.add(offer.shopee_item_id);
      merged.push(offer);
      if (merged.length >= limit) return merged;
    }
  }

  return merged;
}

/** Product row shape the upsert needs; `niche` is what makes the radar able to retrieve it. */
export function toProductRow(offer: AvailableOffer, niche: string): {
  shopee_item_id: string;
  name: string;
  price: number | null;
  commission_rate: number | null;
  affiliate_short_link: string;
  niche: string;
  is_active: boolean;
} {
  return {
    shopee_item_id: offer.shopee_item_id,
    name: offer.name,
    price: offer.price,
    commission_rate: offer.commission_rate,
    affiliate_short_link: offer.affiliate_short_link,
    niche,
    is_active: true
  };
}
