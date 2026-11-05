"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { Tables, TablesInsert } from "@/lib/database.types";
import { parseProductCsv, type ParsedProduct } from "@/lib/products/parse-csv";
import { resolvePastedLinks, type PreviewRow } from "@/lib/products/link-resolver";
import { platformOf } from "@/lib/products/platform";
import { parseProductLinks } from "@/lib/products/parse-links";
import { fail, fromZodError, ok, type ActionResult } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  productIdSchema,
  productSchema,
  type ProductInput,
  type ProductValues
} from "@/lib/validations/product";

type ProductRow = Tables<"products">;

function normalizeOptional(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Maps validated form values onto the exact insert/update shape. */
function toProductRow(values: ProductValues): TablesInsert<"products"> {
  return {
    name: values.name,
    shopee_item_id: normalizeOptional(values.shopee_item_id),
    price: values.price,
    commission_rate: values.commission_rate,
    affiliate_short_link: values.affiliate_short_link,
    // Always a JSON array — never a JSON-encoded string.
    review_images: values.review_images,
    pros_cons_summary: normalizeOptional(values.pros_cons_summary),
    niche: normalizeOptional(values.niche),
    is_active: values.is_active
  };
}

/** Turns Postgres errors into operator-readable messages (not raw SQL). */
function mutationError(error: { code: string; message: string; details: string | null }): string {
  if (error.code === "23505") {
    const context = `${error.message} ${error.details ?? ""}`.toLowerCase();
    if (context.includes("shopee_item_id")) {
      return "That Shopee item ID is already linked to another product.";
    }
    return "Another product already uses these values.";
  }
  return error.message;
}

export async function createProduct(input: ProductInput): Promise<ActionResult<ProductRow>> {
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("products")
    .insert(toProductRow(parsed.data))
    .select("*")
    .single();

  if (error) return fail(mutationError(error));

  revalidatePath("/products");
  return ok(data);
}

export async function updateProduct(
  id: string,
  input: ProductInput
): Promise<ActionResult<ProductRow>> {
  const parsedId = productIdSchema.safeParse(id);
  if (!parsedId.success) return fromZodError(parsedId.error);

  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("products")
    .update(toProductRow(parsed.data))
    .eq("id", parsedId.data)
    .select("*")
    .maybeSingle();

  if (error) return fail(mutationError(error));
  if (!data) return fail("Product not found. It may have been deleted already.");

  revalidatePath("/products");
  revalidatePath(`/products/${parsedId.data}`);
  return ok(data);
}

export async function deleteProduct(id: string): Promise<ActionResult> {
  const parsedId = productIdSchema.safeParse(id);
  if (!parsedId.success) return fromZodError(parsedId.error);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("products")
    .delete()
    .eq("id", parsedId.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(error.message);
  if (!data) return fail("Product not found. It may have been deleted already.");

  // comment_tasks.matched_product_id is ON DELETE SET NULL: task history stays,
  // only the product link is cleared (surfaced in the confirm dialog).
  revalidatePath("/products");
  revalidatePath(`/products/${parsedId.data}`);
  return ok();
}

export async function toggleProductActive(id: string, isActive: boolean): Promise<ActionResult> {
  const parsedId = productIdSchema.safeParse(id);
  if (!parsedId.success) return fromZodError(parsedId.error);

  if (typeof isActive !== "boolean") {
    return fail("Choose whether the product is active.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("products")
    .update({ is_active: isActive })
    .eq("id", parsedId.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(error.message);
  if (!data) return fail("Product not found. It may have been deleted already.");

  revalidatePath("/products");
  revalidatePath(`/products/${parsedId.data}`);
  return ok();
}

export type ImportProductsResult = {
  created: number;
  skipped: number;
  issues: { line: number; error: string }[];
};

const importSchema = z.object({
  csv: z.string().trim().min(1, "Dán hoặc chọn file CSV trước."),
  defaultNiche: z.string().trim().max(60).optional()
});

/**
 * Bulk import from a Shopee/Lazada affiliate export.
 *
 * Rows are inserted one at a time so a single duplicate cannot roll back the rest
 * of the file; both existing products (by affiliate link or item id) and rows inside
 * the file are treated as duplicates and reported, not silently dropped.
 */
export async function importProductsCsv(
  input: unknown
): Promise<ActionResult<ImportProductsResult>> {
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const { products, issues } = parseProductCsv(parsed.data.csv);
  if (products.length === 0 && issues.length === 0) {
    return fail("File không có dòng dữ liệu nào.");
  }

  return insertParsedProducts(products, parsed.data.defaultNiche?.trim() || null, issues);
}

const pasteLinksSchema = z.object({
  // 200 lines x ~2 KB per line: a Server Action is untrusted input, so the payload is
  // capped before parsing rather than after building 200 objects from a 10 MB paste.
  links: z.string().trim().min(1, "Dán ít nhất một link Shopee affiliate.").max(400_000, "Danh sách quá dài — chia nhỏ ra dán."),
  defaultNiche: z.string().trim().max(60).optional()
});

/**
 * Creates products from pasted affiliate links, one per line.
 *
 * The eight-field form is fine once and hostile ten times: name and item id are
 * already inside the Shopee URL, so the parser derives them and the operator only
 * supplies what the link cannot know (`link | tên | giá | ngách`). Rows land with the
 * same duplicate rules as the CSV import because both go through insertParsedProducts.
 */
export async function createProductsFromLinks(
  input: unknown
): Promise<ActionResult<ImportProductsResult>> {
  const parsed = pasteLinksSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const { products, issues } = parseProductLinks(parsed.data.links);
  if (products.length === 0) {
    return fail(issues[0]?.error ?? "Không đọc được link nào trong danh sách.");
  }

  return insertParsedProducts(products, parsed.data.defaultNiche?.trim() || null, issues);
}

const previewLinksSchema = z.object({
  links: z.string().trim().min(1, "Dán ít nhất một link.").max(20_000, "Dán ít link hơn mỗi lần.")
});

/**
 * Resolves pasted links for the review table (no writes).
 *
 * Short affiliate codes carry no product data, so each link is expanded through its
 * redirect chain (Shopee's product page is not scrapable: JS app, captcha, 403 on the
 * API). Whatever the chain reveals is pre-filled; the rest comes back `null` so the
 * operator types one cell instead of filling the eight-field form.
 */
export async function previewProductLinks(input: unknown): Promise<ActionResult<PreviewRow[]>> {
  const parsed = previewLinksSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const { rows, issues } = await resolvePastedLinks(parsed.data.links);
  if (rows.length === 0) {
    return fail(issues[0]?.error ?? "Không đọc được link nào.");
  }

  return ok(rows);
}

const reviewRowSchema = z.object({
  link: z.string().url("Link không hợp lệ."),
  name: z.string().trim().min(1, "Mỗi dòng cần một tên sản phẩm.").max(200),
  price: z.number().int().nonnegative().max(1_000_000_000_000).nullable(),
  niche: z.string().trim().max(60).nullable(),
  itemId: z.string().trim().max(40).nullable()
});

const reviewRowsSchema = z.object({
  rows: z.array(reviewRowSchema).min(1, "Chưa có dòng nào để lưu.").max(100)
});

/** Saves the reviewed rows; same duplicate rules as CSV import and paste. */
export async function createProductsFromRows(
  input: unknown
): Promise<ActionResult<ImportProductsResult>> {
  const parsed = reviewRowsSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const products: ParsedProduct[] = parsed.data.rows.map((row, index) => ({
    line: index + 1,
    name: row.name,
    affiliateLink: row.link,
    price: row.price,
    commissionRate: null,
    niche: row.niche?.trim() ? row.niche.trim() : null,
    shopeeItemId: row.itemId?.trim() ? row.itemId.trim() : null,
    platform: platformOf(row.link)
  }));

  return insertParsedProducts(products, null, []);
}

/**
 * Shared insert loop for both bulk paths.
 *
 * Rows are inserted one at a time so a single duplicate cannot roll back the rest of
 * the batch; both existing products (by affiliate link or item id) and rows inside the
 * batch are treated as duplicates and reported, not silently dropped.
 */
async function insertParsedProducts(
  products: ParsedProduct[],
  defaultNiche: string | null,
  issues: { line: number; error: string }[]
): Promise<ActionResult<ImportProductsResult>> {
  const supabase = await createSupabaseServerClient();

  // One query for the existing keys, instead of one per row.
  const { data: existing, error: existingError } = await supabase
    .from("products")
    .select("affiliate_short_link,shopee_item_id");

  if (existingError) return fail(existingError.message);

  const knownLinks = new Set(
    (existing ?? []).map((row) => row.affiliate_short_link.trim().toLowerCase())
  );
  const knownItems = new Set(
    (existing ?? []).map((row) => row.shopee_item_id).filter((id): id is string => Boolean(id))
  );

  const result: ImportProductsResult = { created: 0, skipped: 0, issues: [...issues] };

  for (const product of products) {
    if (knownLinks.has(product.affiliateLink.toLowerCase())) {
      result.skipped += 1;
      result.issues.push({ line: product.line, error: "Link đã có trong hệ thống." });
      continue;
    }
    if (product.shopeeItemId && knownItems.has(product.shopeeItemId)) {
      result.skipped += 1;
      result.issues.push({ line: product.line, error: "Item ID đã có trong hệ thống." });
      continue;
    }

    const { error } = await supabase.from("products").insert({
      name: product.name,
      affiliate_short_link: product.affiliateLink,
      price: product.price,
      commission_rate: product.commissionRate,
      niche: product.niche ?? defaultNiche,
      shopee_item_id: product.shopeeItemId,
      review_images: [],
      is_active: true
    });

    if (!error) {
      result.created += 1;
      knownLinks.add(product.affiliateLink.toLowerCase());
      if (product.shopeeItemId) knownItems.add(product.shopeeItemId);
      continue;
    }

    if (error.code === "23505") {
      result.skipped += 1;
      result.issues.push({ line: product.line, error: "Trùng với sản phẩm đã có." });
      continue;
    }

    // Never surface raw Postgres text to the operator; 23505 is handled above, and
    // everything else is either a constraint we can explain or an internal failure.
    result.issues.push({
      line: product.line,
      error: "Không lưu được dòng này — kiểm tra lại giá/tên rồi thử lại."
    });
  }

  if (result.created > 0) revalidatePath("/products");

  if (result.created === 0 && result.skipped === 0) {
    return fail("Không nhập được sản phẩm nào.");
  }

  return ok(result);
}
