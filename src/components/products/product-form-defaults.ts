import type { ProductRecord } from "@/lib/data/products";
import { asStringArray } from "@/lib/json";

/** Plain, serialisable shape handed to the client product form. */
export type ProductFormDefaults = {
  id: string;
  name: string;
  shopee_item_id: string;
  price: string;
  commission_rate: string;
  affiliate_short_link: string;
  review_images: string[];
  pros_cons_summary: string;
  niche: string;
  is_active: boolean;
};

export function toProductFormDefaults(product: ProductRecord): ProductFormDefaults {
  return {
    id: product.id,
    name: product.name,
    shopee_item_id: product.shopee_item_id ?? "",
    price: product.price === null ? "" : String(product.price),
    commission_rate: product.commission_rate === null ? "" : String(product.commission_rate),
    affiliate_short_link: product.affiliate_short_link,
    review_images: asStringArray(product.review_images),
    pros_cons_summary: product.pros_cons_summary ?? "",
    niche: product.niche ?? "",
    is_active: product.is_active
  };
}
