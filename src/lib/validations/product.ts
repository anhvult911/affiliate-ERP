import { z } from "zod";

/** Affiliate links and review images must be absolute http(s) URLs. */
const HTTP_URL = /^https?:\/\//i;

/**
 * Form inputs arrive as (possibly empty) strings. Blank means "unset", never 0,
 * so both optional money/rate fields can be cleared from the UI.
 */
function numericInput<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === "string") {
      const trimmed = value.trim().replace(/\s/g, "");
      return trimmed === "" ? null : Number(trimmed);
    }
    return value;
  }, schema);
}

const priceSchema = numericInput(
  z
    .number({ invalid_type_error: "Price must be a number." })
    .finite("Price must be a number.")
    .nonnegative("Price cannot be negative.")
    // VND has no minor unit — keep prices whole dong.
    .int("Price must be a whole number of VND.")
    .nullable()
);

const commissionRateSchema = numericInput(
  z
    .number({ invalid_type_error: "Commission rate must be a number." })
    .finite("Commission rate must be a number.")
    .min(0, "Commission rate cannot be negative.")
    .max(100, "Commission rate cannot exceed 100%.")
    .nullable()
);

export const reviewImageUrlSchema = z
  .string()
  .trim()
  .regex(HTTP_URL, "Image URL must start with http:// or https://.");

export const productSchema = z.object({
  name: z
    .string({ required_error: "Product name is required." })
    .trim()
    .min(1, "Product name is required.")
    .max(200, "Product name must be 200 characters or fewer."),
  shopee_item_id: z
    .string()
    .trim()
    .max(64, "Shopee item ID must be 64 characters or fewer.")
    .optional(),
  price: priceSchema,
  commission_rate: commissionRateSchema,
  affiliate_short_link: z
    .string({ required_error: "Affiliate link is required." })
    .trim()
    .min(1, "Affiliate link is required.")
    .max(2048, "Affiliate link is too long.")
    .regex(HTTP_URL, "Affiliate link must start with http:// or https://."),
  review_images: z
    .array(reviewImageUrlSchema, {
      invalid_type_error: "Review images must be a list of URLs."
    })
    .max(20, "You can add at most 20 review images.")
    .default([]),
  pros_cons_summary: z
    .string()
    .trim()
    .max(1000, "Pros / cons summary must be 1000 characters or fewer.")
    .optional(),
  niche: z.string().trim().max(100, "Niche must be 100 characters or fewer.").optional(),
  is_active: z.boolean({ required_error: "Choose whether the product is active." })
});

export const productIdSchema = z.string().uuid("Invalid product id.");

export type ProductInput = z.input<typeof productSchema>;
export type ProductValues = z.output<typeof productSchema>;
