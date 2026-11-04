import type { ParsedProduct } from "./parse-csv";
import { platformOf } from "./platform";

/**
 * Bulk creation from pasted affiliate links.
 *
 * The product form asks for eight fields, which is fine for one product and hostile
 * for ten: the operator retypes what the URL already contains (name, item id) and
 * leaves most of the rest blank anyway. Import CSV solves it only if the links are
 * already in a spreadsheet, which is the duplication the form was meant to avoid.
 *
 * Line grammar (all optional parts after the link):
 *     <link> | <name> | <price> | <niche>
 *
 * Short links (`s.shopee.vn/abc`) carry no slug, so they need at least a name.
 *
 * Two rules here are load-bearing and easy to get wrong:
 *   - Shopee URLs are `...-i.<shopId>.<itemId>` and `/product/<shopId>/<itemId>`: the
 *     **item** id is the LAST group. Taking the first stores a shop id in a UNIQUE
 *     column, so two products from one shop collide and the Shopee product upsert then
 *     writes price/commission from an unrelated product.
 *   - Only known affiliate hosts are accepted, because the stored link is later opened
 *     inside a browser profile that holds a logged-in Facebook session.
 */

export type ParsedLinkProduct = ParsedProduct;

export type LinkParseIssue = { line: number; error: string };

export type LinkParseResult = {
  products: ParsedLinkProduct[];
  issues: LinkParseIssue[];
};

const MAX_LINES = 200;
const MAX_LINE_LENGTH = 2_000;
const MAX_NAME_LENGTH = 200;
const MAX_NICHE_LENGTH = 60;
const MAX_PRICE = 1_000_000_000_000;

/**
 * Hosts a pasted link may use. Keep in sync with the platforms the deal copy and the
 * short-link service support; an unlisted host is rejected per line, never stored.
 */
export const ALLOWED_AFFILIATE_HOSTS = [
  "shopee.vn",
  "s.shopee.vn",
  "shp.ee",
  "shope.ee",
  "lazada.vn",
  "s.lazada.vn"
] as const;

/** `www.` and any subdomain of an allowed host count as that host. */
export function isAllowedAffiliateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return ALLOWED_AFFILIATE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/** `150k`, `150.000đ`, `1.290.000`, `150000`, `0` → VND integer; anything else → null. */
export function parsePrice(raw: string): number | null {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[₫đ]/g, "")
    .replace(/\s/g, "");
  if (cleaned.length === 0) return null;

  const withK = /^(\d+(?:[.,]\d+)?)k$/.exec(cleaned);
  const thousands = withK?.[1];

  let value: number;
  if (thousands) {
    value = Number(thousands.replace(",", ".")) * 1000;
  } else {
    // A separator followed by exactly three digits is a thousands group ("1.290.000");
    // anything else is a decimal, and VND prices have no minor unit.
    const normalized = cleaned.replace(/([.,])(\d{3})(?!\d)/g, "$2");
    if (!/^\d+(?:[.,]\d+)?$/.test(normalized)) return null;
    value = Number(normalized.replace(",", "."));
  }

  if (!Number.isFinite(value) || value < 0 || value > MAX_PRICE) return null;
  return Number.isInteger(value) ? value : null;
}

export type AffiliateLinkDescription = {
  name: string | null;
  itemId: string | null;
  platform: "shopee" | "lazada" | "other";
};

/** Extracts `{ name, itemId, platform }` from a Shopee/Lazada product URL. */
export function describeAffiliateLink(link: string): AffiliateLinkDescription {
  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch {
    return { name: null, itemId: null, platform: "other" };
  }

  const platform = platformOf(link);
  if (platform === "other") return { name: null, itemId: null, platform };

  const rawSegment = parsed.pathname.split("/").filter(Boolean).pop() ?? "";
  let segment: string;
  try {
    segment = decodeURIComponent(rawSegment);
  } catch {
    // Malformed percent-escape in pasted text: nothing here can be trusted, but the
    // caller must still get a per-line issue rather than an exception out of the parser.
    return { name: null, itemId: null, platform };
  }

  if (platform === "shopee") {
    if (segment.length === 0) return { name: null, itemId: null, platform };

    // `Name-i.<shopId>.<itemId>` → item id is the last group.
    const itemMatch = /-i\.(\d+)\.(\d+)$/.exec(segment) ?? /^i\.(\d+)\.(\d+)$/.exec(segment);
    if (itemMatch) {
      const slug = segment.slice(0, itemMatch.index).replace(/[-_]+/g, " ").trim();
      return { name: slug.length > 0 ? slug : null, itemId: itemMatch[2] ?? null, platform };
    }

    // `/product/<shopId>/<itemId>` — no slug, the item id is still the last group.
    const numeric = /^\/product\/(\d+)\/(\d+)/.exec(parsed.pathname);
    if (numeric) return { name: null, itemId: numeric[2] ?? null, platform };

    // `/<shopSlug>/<shopId>/<itemId>` — what a live affiliate share link redirects to
    // (`shopee.vn/opaanlp/729014007/52460495899?...`). The last two segments are numeric
    // in that order, so the item id is the final one.
    const share = /^\/(?:[^/]+\/)?(\d+)\/(\d+)\/?$/.exec(parsed.pathname);
    if (share) return { name: null, itemId: share[2] ?? null, platform };
  }

  if (platform === "lazada") {
    // `slug-i<itemId>-s<skuId>.html` → item id is the `-i` group, not the sku.
    const lazadaMatch = /-i(\d+)(?:-s\d+)?\.html$/i.exec(segment);
    if (lazadaMatch) {
      const slug = segment.slice(0, lazadaMatch.index).replace(/[-_]+/g, " ").trim();
      return { name: slug.length > 0 ? slug : null, itemId: lazadaMatch[1] ?? null, platform };
    }
  }

  // Short links carry an opaque code; the row can still be created if the operator
  // pastes a name.
  return { name: null, itemId: null, platform };
}

/**
 * Compatibility alias used by older tests; returns the same `name` and `itemId`
 * that `describeAffiliateLink` returns for Shopee/Lazada URLs.
 */
export function describeShopeeLink(link: string): { name: string | null; itemId: string | null } {
  const { name, itemId } = describeAffiliateLink(link);
  return { name, itemId };
}

export function parseProductLinks(input: string): LinkParseResult {
  const products: ParsedLinkProduct[] = [];
  const issues: LinkParseIssue[] = [];
  const seenLinks = new Set<string>();
  const seenItems = new Set<string>();

  const allLines = input.split(/\r?\n/);
  const lines = allLines.slice(0, MAX_LINES);

  lines.forEach((rawLine, index) => {
    const line = index + 1;
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) return;

    if (trimmed.length > MAX_LINE_LENGTH) {
      issues.push({ line, error: "Dòng quá dài — mỗi dòng chỉ chứa một link." });
      return;
    }

    const parts = trimmed.split("|").map((part) => part.trim());
    const link = parts[0] ?? "";

    let hostname: string;
    try {
      hostname = new URL(link).hostname;
    } catch {
      issues.push({ line, error: "Dòng này không phải link http(s) hợp lệ." });
      return;
    }

    if (!isAllowedAffiliateHost(hostname)) {
      issues.push({
        line,
        error: `Link không thuộc Shopee/Lazada (${hostname}) — chỉ nhận link affiliate của 2 sàn.`
      });
      return;
    }

    const key = link.toLowerCase();
    if (seenLinks.has(key)) {
      issues.push({ line, error: "Link lặp lại trong danh sách." });
      return;
    }

    const derived = describeAffiliateLink(link);
    const explicitName = parts[1]?.trim() ?? "";
    const name = explicitName.length > 0 ? explicitName : derived.name;

    if (!name) {
      issues.push({
        line,
        error:
          "Không đọc được tên từ link (link rút gọn hoặc ký tự mã hoá lỗi) — thêm tên sau dấu | (link | tên)."
      });
      return;
    }

    if (name.length > MAX_NAME_LENGTH) {
      issues.push({ line, error: `Tên sản phẩm dài quá ${MAX_NAME_LENGTH} ký tự.` });
      return;
    }

    const niche = parts[3]?.trim() ?? "";
    if (niche.length > MAX_NICHE_LENGTH) {
      issues.push({ line, error: `Ngách dài quá ${MAX_NICHE_LENGTH} ký tự.` });
      return;
    }

    if (derived.itemId && seenItems.has(derived.itemId)) {
      issues.push({ line, error: "Item ID trùng với dòng khác trong danh sách." });
      return;
    }

    const rawPrice = parts[2] ?? "";
    const price = parsePrice(rawPrice);
    if (rawPrice.trim().length > 0 && price === null) {
      issues.push({
        line,
        error: `Giá "${rawPrice}" không đọc được (ví dụ hợp lệ: 150.000, 150k).`
      });
      return;
    }

    products.push({
      line,
      name,
      affiliateLink: link,
      price,
      commissionRate: null,
      niche: niche || null,
      shopeeItemId: derived.itemId,
      platform: derived.platform
    });

    seenLinks.add(key);
    if (derived.itemId) seenItems.add(derived.itemId);
  });

  if (allLines.length > MAX_LINES) {
    issues.push({ line: MAX_LINES + 1, error: `Chỉ nhận tối đa ${MAX_LINES} dòng mỗi lần.` });
  }

  return { products, issues };
}
