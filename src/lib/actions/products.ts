"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { Tables, TablesInsert } from "@/lib/database.types";
import { parseProductCsv } from "@/lib/products/parse-csv";
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
  const defaultNiche = parsed.data.defaultNiche?.trim() || null;

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

    result.issues.push({ line: product.line, error: error.message });
  }

  if (result.created > 0) revalidatePath("/products");

  if (result.created === 0 && result.skipped === 0) {
    return fail("Không nhập được sản phẩm nào.");
  }

  return ok(result);
}
