import type { ConversionStatus } from "@/lib/constants";

/**
 * Shopee report payloads → rows (docs/SHOPEE_API.md §4–5, P5-2).
 *
 * The API returns money and rates as **strings** (`"0.25"`, `"150000.00"`) and nests a
 * conversion around several orders. Everything here is pure and tolerant: an unexpected
 * field is skipped and counted by the caller rather than throwing mid-page, because a
 * single malformed node must not lose the rest of the report — the watermark only moves
 * forward after a page is written.
 *
 * The shapes follow the documented schema; the exact field names are verified against
 * docs/SHOPEE_API.md, not against a live publisher (access is still pending).
 */

/* --------------------------------------------------------------- parsing */

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

export function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const parsed = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Unix seconds (the API never sends milliseconds) → ISO, or null. */
export function asIsoFromUnix(value: unknown): string | null {
  const seconds = asNumber(value);
  if (seconds === null || seconds <= 0) return null;
  return new Date(seconds * 1_000).toISOString();
}

/* --------------------------------------------------------------- products */

export type OfferRow = {
  shopee_item_id: string;
  name: string;
  affiliate_short_link: string;
  origin_link: string | null;
  price: number | null;
  /** Percent, as the DB stores it (15.5 = 15.5%). */
  commission_rate: number | null;
  seller_commission_rate: number | null;
  shopee_commission_rate: number | null;
  shop_id: string | null;
  shop_name: string | null;
  image_url: string | null;
  sales: number | null;
  rating_star: number | null;
  offer_period_end_at: string | null;
};

/** `"0.25"` is 25% in this API; the DB column is already a percentage. */
export function commissionPercent(value: unknown): number | null {
  const raw = asNumber(value);
  if (raw === null) return null;
  const percent = raw <= 1 && raw >= 0 ? raw * 100 : raw;
  return Math.min(100, Math.max(0, Math.round(percent * 100) / 100));
}

export function mapOfferNode(node: unknown): OfferRow | null {
  if (!node || typeof node !== "object") return null;
  const row = node as Record<string, unknown>;

  const itemId = asString(row.itemId);
  const name = asString(row.productName);
  const link = asString(row.offerLink);

  // Without these three the row cannot satisfy products' NOT NULL columns or the
  // shopee_item_id upsert key.
  if (!itemId || !name || !link) return null;

  const priceMin = asNumber(row.priceMin);
  const priceMax = asNumber(row.priceMax);

  return {
    shopee_item_id: itemId,
    name,
    affiliate_short_link: link,
    origin_link: asString(row.productLink) || null,
    price: priceMin ?? priceMax,
    commission_rate: commissionPercent(row.commissionRate),
    seller_commission_rate: commissionPercent(row.sellerCommissionRate),
    shopee_commission_rate: commissionPercent(row.shopeeCommissionRate),
    shop_id: asString(row.shopId) || null,
    shop_name: asString(row.shopName) || null,
    image_url: asString(row.imageUrl) || null,
    sales: Math.trunc(asNumber(row.sales) ?? 0) || null,
    rating_star: asNumber(row.ratingStar),
    offer_period_end_at: asIsoFromUnix(row.periodEndTime)
  };
}

/* ------------------------------------------------------------ conversions */

export type ConversionRow = {
  subId: string;
  externalOrderId: string;
  orderAmount: number | null;
  estimatedCommission: number | null;
  status: ConversionStatus;
  convertedAt: string | null;
};

/** `CANCELLED` → canceled; everything still open or completed → pending (validated settles). */
export function conversionStatus(orderStatus: unknown): ConversionStatus {
  return asString(orderStatus).toUpperCase() === "CANCELLED" ? "canceled" : "pending";
}

function itemsTotals(items: unknown): { amount: number | null; commission: number | null } {
  if (!Array.isArray(items)) return { amount: null, commission: null };

  let amount = 0;
  let commission = 0;
  let sawAmount = false;
  let sawCommission = false;

  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;

    const explicitAmount = asNumber(item.actualAmount);
    const unit = asNumber(item.itemPrice);
    const quantity = asNumber(item.qty);
    const itemAmount = explicitAmount ?? (unit !== null ? unit * (quantity ?? 1) : null);
    if (itemAmount !== null) {
      amount += itemAmount;
      sawAmount = true;
    }

    const itemCommission = asNumber(item.itemTotalCommission);
    if (itemCommission !== null) {
      commission += itemCommission;
      sawCommission = true;
    }
  }

  return {
    amount: sawAmount ? amount : null,
    commission: sawCommission ? commission : null
  };
}

/**
 * One conversion node holds several orders (API change 2023-05-22), and the DB keys on
 * the order — so the flattening is not optional: writing per conversion would merge
 * distinct orders into one row.
 */
export function flattenConversionNode(node: unknown): ConversionRow[] {
  if (!node || typeof node !== "object") return [];
  const record = node as Record<string, unknown>;

  const subId = asString(record.utmContent);
  const convertedAt = asIsoFromUnix(record.purchaseTime);
  const conversionCommission = asNumber(record.totalCommission);
  const orders = Array.isArray(record.orders) ? record.orders : [];

  const rows: ConversionRow[] = [];

  for (const raw of orders) {
    if (!raw || typeof raw !== "object") continue;
    const order = raw as Record<string, unknown>;
    const orderId = asString(order.orderId);
    if (!orderId) continue;

    const totals = itemsTotals(order.items);

    rows.push({
      subId,
      externalOrderId: orderId,
      orderAmount: asNumber(order.actualAmount) ?? totals.amount,
      // Per-order commission first: using the checkout total for every order would count
      // the same money once per order.
      estimatedCommission: totals.commission ?? conversionCommission,
      status: conversionStatus(order.orderStatus),
      convertedAt
    });
  }

  return rows;
}

export function flattenConversionNodes(nodes: unknown): ConversionRow[] {
  if (!Array.isArray(nodes)) return [];
  return nodes.flatMap((node) => flattenConversionNode(node));
}

/* -------------------------------------------------------------- validated */

export type ValidatedRow = {
  subId: string;
  externalOrderId: string;
  estimatedCommission: number | null;
  status: "settled";
  convertedAt: string | null;
};

/**
 * `validatedReport` is the money that survived validation. Same flattening rule as the
 * conversion report; `netCommission` is the final figure (post-MCN fee), so it wins over
 * any estimate.
 */
export function flattenValidatedNode(node: unknown): ValidatedRow[] {
  if (!node || typeof node !== "object") return [];
  const record = node as Record<string, unknown>;

  const subId = asString(record.utmContent ?? record.subId1);
  const convertedAt = asIsoFromUnix(record.purchaseTime);
  const netCommission = asNumber(record.netCommission);
  const orders = Array.isArray(record.orders) ? record.orders : [];

  const rows: ValidatedRow[] = [];

  for (const raw of orders) {
    if (!raw || typeof raw !== "object") continue;
    const order = raw as Record<string, unknown>;
    const orderId = asString(order.orderId);
    if (!orderId) continue;

    const totals = itemsTotals(order.items);

    rows.push({
      subId,
      externalOrderId: orderId,
      estimatedCommission: netCommission ?? totals.commission,
      status: "settled",
      convertedAt
    });
  }

  return rows;
}

/* ---------------------------------------------------------------- queries */

/** Page-based, unlike the reports: `productOfferV2` pages by number. */
export const OFFERS_QUERY = `query Offers($page: Int!, $limit: Int!) {
  productOfferV2(listType: 0, sortType: 5, page: $page, limit: $limit) {
    nodes {
      itemId productName priceMin priceMax commissionRate sellerCommissionRate
      shopeeCommissionRate sales ratingStar imageUrl shopId shopName
      productLink offerLink periodEndTime
    }
    pageInfo { page limit hasNextPage }
  }
}`;

export const CONVERSIONS_QUERY = `query Conversions($start: Int!, $end: Int!, $scrollId: String, $limit: Int!) {
  conversionReport(
    purchaseTimeStart: $start,
    purchaseTimeEnd: $end,
    orderStatus: ALL,
    limit: $limit,
    scrollId: $scrollId
  ) {
    nodes {
      utmContent purchaseTime totalCommission netCommission
      orders {
        orderId orderStatus actualAmount
        items { itemPrice qty actualAmount itemTotalCommission }
      }
    }
    pageInfo { hasNextPage scrollId }
  }
}`;

export const VALIDATED_QUERY = `query Validated($validationId: String!, $scrollId: String, $limit: Int!) {
  validatedReport(validationId: $validationId, limit: $limit, scrollId: $scrollId) {
    nodes {
      utmContent purchaseTime netCommission
      orders {
        orderId actualAmount
        items { itemPrice qty actualAmount itemTotalCommission }
      }
    }
    pageInfo { hasNextPage scrollId }
  }
}`;
