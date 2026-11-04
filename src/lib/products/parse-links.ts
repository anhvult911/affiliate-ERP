import type { ParsedProduct } from "./parse-csv";

/**
 * Bulk creation from pasted affiliate links.
 *
 * The product form asks for eight fields, which is fine for one product and hostile
 * for ten: the operator retypes what the URL already contains (name, item id) and
 * leaves most of the rest blank anyway. Import CSV solves it only if the links are
 * already in a spreadsheet, which is the duplication the form was meant to avoid.
 *
 * So this parser accepts one link per line and fills what the link can prove:
 *   - name: derived from the Shopee slug (`/May-loc-khong-khi-Xiaomi-i.1.2` →
 *     "May loc khong khi Xiaomi"),
 *   - shopee item id: the `i.<itemId>.<shopId>` segment or a numeric `/product/<id>/`
 *     path,
 *   - price and niche: only when the operator appends them.
 *
 * Line grammar (all optional parts after the link):
 *     <link> | <name> | <price> | <niche>
 * Short links (`s.shopee.vn/abc`) carry no slug, so they need at least a name.
 */

export type ParsedLinkProduct = ParsedProduct;

export type LinkParseIssue = { line: number; error: string };

export type LinkParseResult = {
  products: ParsedLinkProduct[];
  issues: LinkParseIssue[];
};

const MAX_LINES = 200;
const HTTP_URL = /^https?:\/\//i;

/** `150k`, `150K`, `150.000đ`, `150,000`, `150000` → 150000. */
export function parsePrice(raw: string): number | null {
  const cleaned = raw.trim().toLowerCase().replace(/[₫đ]/g, "").replace(/\s/g, "");
  if (cleaned.length === 0) return null;

  const withK = /^(\d+(?:[.,]\d+)?)k$/.exec(cleaned);
  const thousands = withK?.[1];
  if (thousands) return Math.round(Number(thousands.replace(",", ".")) * 1000);

  // Dots/commas are thousands separators in VN prices; strip them entirely.
  const digits = cleaned.replace(/[.,]/g, "");
  if (!/^\d+$/.test(digits)) return null;

  const value = Number(digits);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Extracts `{ name, itemId }` from a Shopee product URL; both may be null. */
export function describeShopeeLink(link: string): { name: string | null; itemId: string | null } {
  let path: string;
  try {
    path = new URL(link).pathname;
  } catch {
    return { name: null, itemId: null };
  }

  const segment = decodeURIComponent(path.split("/").filter(Boolean).pop() ?? "");
  if (segment.length === 0) return { name: null, itemId: null };

  const itemMatch = /-i\.(\d+)\.(\d+)$/.exec(segment) ?? /^i\.(\d+)\.(\d+)$/.exec(segment);
  if (itemMatch) {
    const slug = segment.slice(0, itemMatch.index).replace(/[-_]+/g, " ").trim();
    return { name: slug.length > 0 ? slug : null, itemId: itemMatch[1] ?? null };
  }

  // /product/<itemId>/<shopId> — no slug, but the id is explicit.
  const numeric = /^\/product\/(\d+)\/(\d+)/.exec(path);
  if (numeric) return { name: null, itemId: numeric[1] ?? null };

  // Short links (s.shopee.vn/abc123) carry an opaque code, nothing usable.
  return { name: null, itemId: null };
}

export function parseProductLinks(input: string): LinkParseResult {
  const products: ParsedLinkProduct[] = [];
  const issues: LinkParseIssue[] = [];
  const seenLinks = new Set<string>();
  const seenItems = new Set<string>();

  const lines = input.split(/\r?\n/).slice(0, MAX_LINES);

  lines.forEach((rawLine, index) => {
    const line = index + 1;
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) return;

    const parts = trimmed.split("|").map((part) => part.trim());
    const link = parts[0] ?? "";

    if (!HTTP_URL.test(link)) {
      issues.push({ line, error: "Dòng này không bắt đầu bằng http(s) — dán link Shopee affiliate." });
      return;
    }

    const key = link.toLowerCase();
    if (seenLinks.has(key)) {
      issues.push({ line, error: "Link lặp lại trong danh sách." });
      return;
    }

    const derived = describeShopeeLink(link);
    const explicitName = parts[1]?.trim() ?? "";
    const name = explicitName.length > 0 ? explicitName : derived.name;

    if (!name) {
      issues.push({
        line,
        error: "Link rút gọn không có tên sản phẩm — thêm vào sau dấu | (link | tên sản phẩm)."
      });
      return;
    }

    if (derived.itemId && seenItems.has(derived.itemId)) {
      issues.push({ line, error: "Item ID trùng với dòng khác trong danh sách." });
      return;
    }

    products.push({
      line,
      name,
      affiliateLink: link,
      price: parsePrice(parts[2] ?? ""),
      commissionRate: null,
      niche: parts[3]?.trim() || null,
      shopeeItemId: derived.itemId
    });

    seenLinks.add(key);
    if (derived.itemId) seenItems.add(derived.itemId);
  });

  if (lines.length >= MAX_LINES) {
    issues.push({ line: MAX_LINES, error: `Chỉ nhận tối đa ${MAX_LINES} dòng mỗi lần.` });
  }

  return { products, issues };
}
