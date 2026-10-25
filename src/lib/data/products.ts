import type { Tables } from "@/lib/database.types";
import type { ConversionStatus, TaskStatus } from "@/lib/db-types";
import { asStringArray } from "@/lib/json";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ProductRecord = Tables<"products">;

/** A product row plus the parsed review-image list the UI renders. */
export type ProductListItem = ProductRecord & { images: string[] };

export type ProductSort = "newest" | "name" | "commission" | "price";

export type ProductFilters = {
  /** Case-insensitive match on the product name. */
  query?: string;
  niche?: string;
  activeOnly?: boolean;
  sort?: ProductSort;
};

export type ProductStats = {
  total: number;
  active: number;
  /** Mean of the non-null commission rates, null when none are set. */
  averageCommissionRate: number | null;
  withReviewImages: number;
};

export type ProductRoi = {
  tasksTotal: number;
  tasksCompleted: number;
  tasksFailed: number;
  orders: number;
  /** Sum of non-canceled order amounts. */
  revenue: number;
  /** Sum of non-canceled estimated commissions. */
  commission: number;
  /** Commission from conversions already marked settled. */
  settledCommission: number;
};

export type ProductTask = {
  id: string;
  status: TaskStatus;
  post_url: string;
  created_at: string;
  account: { id: string; name: string } | null;
};

type RoiTaskRow = {
  status: TaskStatus;
  affiliate_conversions: {
    order_amount: number;
    estimated_commission: number;
    status: ConversionStatus;
  }[];
};

/**
 * review_images is jsonb: the API can hand back any JSON value. The schema check
 * only guarantees an array, so `asStringArray` narrows it before rendering.
 */
export function toProductListItem(product: ProductRecord): ProductListItem {
  return { ...product, images: asStringArray(product.review_images) };
}

export async function listProducts(filters: ProductFilters = {}): Promise<ProductRecord[]> {
  const supabase = await createSupabaseServerClient();
  const search = filters.query?.trim();

  let query = supabase.from("products").select("*");

  if (search) query = query.ilike("name", `%${search}%`);
  if (filters.niche) query = query.eq("niche", filters.niche);
  if (filters.activeOnly) query = query.eq("is_active", true);

  switch (filters.sort) {
    case "name":
      query = query.order("name", { ascending: true });
      break;
    case "commission":
      query = query.order("commission_rate", { ascending: false, nullsFirst: false });
      break;
    case "price":
      query = query.order("price", { ascending: true, nullsFirst: false });
      break;
    default:
      query = query.order("created_at", { ascending: false });
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getProduct(id: string): Promise<ProductRecord | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("products").select("*").eq("id", id).maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Aggregates in JS from a narrow projection: the product pool is small and this
 * keeps one round-trip instead of four count/avg queries.
 */
export async function getProductStats(): Promise<ProductStats> {
  const supabase = await createSupabaseServerClient();

  // Aggregated in SQL: the previous version transferred every product row
  // (including review_images jsonb) just to count them.
  const { data, error } = await supabase.rpc("product_stats");
  if (error) throw new Error(`Could not load product stats: ${error.message}`);

  const row = data?.[0];

  return {
    total: Number(row?.total ?? 0),
    active: Number(row?.active ?? 0),
    averageCommissionRate: row?.avg_commission === null || row?.avg_commission === undefined
      ? null
      : Number(row.avg_commission),
    withReviewImages: Number(row?.with_reviews ?? 0)
  };
}

/** Distinct non-empty niches, alphabetically sorted for the filter select. */
export async function listNicheOptions(): Promise<string[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("products")
    .select("niche")
    .not("niche", "is", null)
    .order("niche", { ascending: true });

  if (error) throw new Error(error.message);

  const niches = new Set<string>();
  for (const row of data ?? []) {
    const niche = row.niche?.trim();
    if (niche) niches.add(niche);
  }

  return [...niches].sort((a, b) => a.localeCompare(b));
}

export async function getProductRoi(id: string): Promise<ProductRoi> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("comment_tasks")
    .select("status, affiliate_conversions(order_amount, estimated_commission, status)")
    .eq("matched_product_id", id)
    .returns<RoiTaskRow[]>();

  if (error) throw new Error(error.message);

  const roi: ProductRoi = {
    tasksTotal: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    orders: 0,
    revenue: 0,
    commission: 0,
    settledCommission: 0
  };

  for (const task of data ?? []) {
    roi.tasksTotal += 1;
    if (task.status === "completed") roi.tasksCompleted += 1;
    if (task.status === "failed") roi.tasksFailed += 1;

    for (const conversion of task.affiliate_conversions ?? []) {
      roi.orders += 1;
      if (conversion.status === "canceled") continue;

      roi.revenue += Number(conversion.order_amount);
      roi.commission += Number(conversion.estimated_commission);
      if (conversion.status === "settled") {
        roi.settledCommission += Number(conversion.estimated_commission);
      }
    }
  }

  return roi;
}

/**
 * A single query per product; the caller groups by URL in JS because the image
 * list lives in jsonb and has no rows of its own to aggregate against.
 */
export async function getReviewImageUsage(productId: string): Promise<Record<string, number>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("comment_tasks")
    .select("selected_review_image")
    .eq("matched_product_id", productId)
    .not("selected_review_image", "is", null);

  if (error) throw new Error(error.message);

  const usage: Record<string, number> = {};
  for (const row of data ?? []) {
    const url = row.selected_review_image;
    if (!url) continue;
    usage[url] = (usage[url] ?? 0) + 1;
  }

  return usage;
}

export async function listProductTasks(productId: string, limit = 50): Promise<ProductTask[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("comment_tasks")
    .select(
      "id, status, post_url, created_at, account:social_accounts!comment_tasks_assigned_account_id_fkey(id, name)"
    )
    .eq("matched_product_id", productId)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<ProductTask[]>();

  if (error) throw new Error(error.message);
  return data ?? [];
}
