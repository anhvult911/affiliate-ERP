import { z } from "zod";

/**
 * Parser for a Shopee/Lazada affiliate export.
 *
 * Exports differ per locale and per affiliate program, so the parser does not
 * assume a column order: it reads the header row, matches aliases (Vietnamese and
 * English), and only requires the two fields a product cannot exist without —
 * a name and an affiliate link. Everything else is optional and simply not set.
 *
 * Pure and synchronous so it can be tested and reused from a Server Action without
 * pulling in the request lifecycle.
 */

export type ParsedProduct = {
  /** 1-based data row number (header excluded), for error messages. */
  line: number;
  name: string;
  affiliateLink: string;
  price: number | null;
  /** Percent, e.g. 15.5. */
  commissionRate: number | null;
  niche: string | null;
  shopeeItemId: string | null;
};

export type ProductCsvIssue = { line: number; error: string };

export type ProductCsvResult = {
  products: ParsedProduct[];
  issues: ProductCsvIssue[];
};

const MAX_ROWS = 500;

const ALIASES: Record<keyof Omit<ParsedProduct, "line">, string[]> = {
  name: ["tên sản phẩm", "ten san pham", "product name", "name", "tên", "ten"],
  affiliateLink: [
    "link tiếp thị",
    "link tiep thi",
    "affiliate link",
    "link affiliate",
    "link",
    "url",
    "product link",
    "link sản phẩm"
  ],
  price: ["giá", "gia", "price", "giá bán", "gia ban", "sale price"],
  commissionRate: [
    "tỷ lệ hoa hồng",
    "ty le hoa hong",
    "commission rate",
    "hoa hồng (%)",
    "hoa hong (%)",
    "rate"
  ],
  niche: ["ngành hàng", "nganh hang", "category", "niche", "danh mục", "danh muc"],
  shopeeItemId: ["item id", "itemid", "mã sản phẩm", "ma san pham", "product id"]
};

const PRODUCT_SCHEMA = z.object({
  name: z.string().trim().min(1).max(200),
  affiliate_link: z.string().trim().url("Link affiliate phải là URL."),
  price: z.number().min(0).nullable(),
  commission_rate: z.number().min(0).max(100).nullable(),
  niche: z.string().trim().max(60).nullable()
});

/** Splits one CSV line, honouring double quotes and doubled quotes. */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }

    if (char === delimiter) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function detectDelimiter(headerLine: string): string {
  const candidates = [",", ";", "\t"];
  let best = ",";
  let bestCount = 0;

  for (const candidate of candidates) {
    const count = headerLine.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }

  return best;
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function findColumn(headers: string[], field: keyof typeof ALIASES): number {
  for (const alias of ALIASES[field]) {
    const index = headers.indexOf(alias);
    if (index >= 0) return index;
  }
  // Fall back to a contains-match, so "Link tiếp thị (Shopee)" still resolves.
  for (const alias of ALIASES[field]) {
    const index = headers.findIndex((header) => header.includes(alias));
    if (index >= 0) return index;
  }
  return -1;
}

/**
 * Money and percentages are written differently, so they are parsed differently.
 *
 * `890.000đ` is eight hundred ninety thousand, not 890 — treating every dot as a
 * decimal point silently imported every Vietnamese price divided by a thousand.
 */
function parseMoney(raw: string | undefined): number | null {
  if (!raw) return null;

  const cleaned = raw.replace(/[^\d.,]/g, "");
  if (cleaned.length === 0) return null;

  // 1.250.000 / 1,250,000 / 890.000 — grouped thousands, no decimals.
  if (/^\d{1,3}([.,]\d{3})+$/.test(cleaned)) {
    return Number(cleaned.replace(/[.,]/g, ""));
  }

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  if (lastComma >= 0 && lastDot >= 0) {
    // Both present: the last one is the decimal separator.
    const decimalIsComma = lastComma > lastDot;
    const normalized = decimalIsComma
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
  }

  if (lastComma >= 0 || lastDot >= 0) {
    const separator = lastComma >= 0 ? "," : ".";
    const decimals = cleaned.length - cleaned.lastIndexOf(separator) - 1;
    const integerPart = cleaned.slice(0, cleaned.lastIndexOf(separator));

    // A single separator with exactly three digits after it is a thousands group,
    // unless the integer part is empty ("0.500" is a price, ".500" is not).
    if (decimals === 3 && integerPart.length > 0 && /^\d+$/.test(integerPart)) {
      return Number(integerPart + cleaned.slice(cleaned.lastIndexOf(separator) + 1));
    }

    const value = Number(cleaned.replace(separator, "."));
    return Number.isFinite(value) ? value : null;
  }

  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function parseRate(raw: string | undefined): number | null {
  if (!raw) return null;

  const cleaned = raw.replace(/[^\d.,]/g, "");
  if (cleaned.length === 0) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  let normalized = cleaned;

  if (lastComma >= 0 && lastDot >= 0) {
    normalized =
      lastComma > lastDot
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned.replace(/,/g, "");
  } else if (lastComma >= 0 || lastDot >= 0) {
    const separator = lastComma >= 0 ? "," : ".";
    const decimals = cleaned.length - cleaned.lastIndexOf(separator) - 1;
    // "12,5" is twelve and a half percent; "1.250" would be a thousands group.
    normalized =
      decimals === 3
        ? cleaned.replace(separator, "")
        : cleaned.replace(separator, ".");
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function itemIdFromLink(link: string): string | null {
  const patterns = [/\/product\/(\d+)\/(\d+)/, /[?&]item_id=(\d+)/, /-i\.(\d+)\.(\d+)/];

  for (const pattern of patterns) {
    const match = link.match(pattern);
    if (!match) continue;
    // Shopee URLs carry shopId then itemId; the item id is the last group.
    return match[match.length - 1] ?? null;
  }

  return null;
}

export function parseProductCsv(input: string): ProductCsvResult {
  const lines = input.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    return { products: [], issues: [{ line: 1, error: "Cần dòng tiêu đề và ít nhất một dòng dữ liệu." }] };
  }

  const delimiter = detectDelimiter(lines[0] ?? "");
  const headers = splitCsvLine(lines[0] ?? "", delimiter).map(normalizeHeader);

  const columns = {
    name: findColumn(headers, "name"),
    affiliateLink: findColumn(headers, "affiliateLink"),
    price: findColumn(headers, "price"),
    commissionRate: findColumn(headers, "commissionRate"),
    niche: findColumn(headers, "niche"),
    shopeeItemId: findColumn(headers, "shopeeItemId")
  };

  if (columns.name < 0 || columns.affiliateLink < 0) {
    return {
      products: [],
      issues: [
        {
          line: 1,
          error:
            "Không tìm thấy cột tên sản phẩm và/hoặc link affiliate. Cần tiêu đề có 'Tên sản phẩm' và 'Link tiếp thị' (hoặc name / affiliate link)."
        }
      ]
    };
  }

  const products: ParsedProduct[] = [];
  const issues: ProductCsvIssue[] = [];
  const seenLinks = new Set<string>();

  lines.slice(1).forEach((raw, index) => {
    const line = index + 2; // header is line 1
    if (products.length >= MAX_ROWS) {
      issues.push({ line, error: `Chỉ nhập tối đa ${MAX_ROWS} sản phẩm mỗi lần.` });
      return;
    }

    const cells = splitCsvLine(raw, delimiter);
    const name = cells[columns.name] ?? "";
    const link = cells[columns.affiliateLink] ?? "";

    const parsed = PRODUCT_SCHEMA.safeParse({
      name,
      affiliate_link: link,
      price: columns.price >= 0 ? parseMoney(cells[columns.price]) : null,
      commission_rate:
        columns.commissionRate >= 0 ? parseRate(cells[columns.commissionRate]) : null,
      niche: columns.niche >= 0 ? (cells[columns.niche] ?? "").trim() || null : null
    });

    if (!parsed.success) {
      const first = parsed.error.issues[0];
      issues.push({ line, error: first?.message ?? "Dòng không hợp lệ." });
      return;
    }

    const key = parsed.data.affiliate_link.toLowerCase();
    if (seenLinks.has(key)) {
      issues.push({ line, error: "Link trùng với một dòng phía trên." });
      return;
    }
    seenLinks.add(key);

    products.push({
      line,
      name: parsed.data.name,
      affiliateLink: parsed.data.affiliate_link,
      price: parsed.data.price,
      commissionRate: parsed.data.commission_rate,
      niche: parsed.data.niche,
      shopeeItemId:
        (columns.shopeeItemId >= 0 ? (cells[columns.shopeeItemId] ?? "").trim() : "") ||
        itemIdFromLink(parsed.data.affiliate_link)
    });
  });

  return { products, issues };
}
