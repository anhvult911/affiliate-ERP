import { QUEUE_PAGE_SIZE, TASK_STATUSES, type TaskStatus } from "@/lib/constants";
import type { Tables } from "@/lib/database.types";
import { resolveDb, type SupabaseDb } from "@/lib/db";
import type { AssignableAccount } from "@/lib/queue/assignment";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type QueueSource = Pick<
  Tables<"target_sources">,
  "id" | "name" | "url" | "source_type" | "niche" | "tone_of_voice" | "group_rules"
>;

export type QueueProduct = Pick<
  Tables<"products">,
  | "id"
  | "name"
  | "price"
  | "commission_rate"
  | "affiliate_short_link"
  | "review_images"
  | "pros_cons_summary"
  | "niche"
>;

export type QueueAccount = AssignableAccount;

export type QueueAccountSummary = Pick<
  Tables<"social_accounts">,
  "id" | "name" | "persona_type" | "status" | "trust_score"
>;

export type QueueTask = Tables<"comment_tasks"> & {
  source: QueueSource | null;
  product: QueueProduct | null;
  account: QueueAccount | null;
  secondary: QueueAccountSummary | null;
};

/**
 * Two FKs point at social_accounts, so the embeds carry the constraint name —
 * without the hint PostgREST cannot disambiguate and errors out.
 */
const QUEUE_SELECT = `
  *,
  source:target_sources(id,name,url,source_type,niche,tone_of_voice,group_rules),
  product:products(id,name,price,commission_rate,affiliate_short_link,review_images,pros_cons_summary,niche),
  account:social_accounts!comment_tasks_assigned_account_id_fkey(id,name,persona_type,status,trust_score,browser_profile_id,proxy_ip),
  secondary:social_accounts!comment_tasks_secondary_account_id_fkey(id,name,persona_type,status,trust_score)
`;

export async function listQueueTasks(
  {
    status,
    sourceId,
    limit = QUEUE_PAGE_SIZE
  }: {
    status: TaskStatus;
    sourceId?: string | null;
    limit?: number;
  },
  client?: SupabaseDb
): Promise<QueueTask[]> {
  const supabase = await resolveDb(client);

  let query = supabase
    .from("comment_tasks")
    .select(QUEUE_SELECT)
    .eq("status", status)
    .order("match_score", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (sourceId) query = query.eq("source_id", sourceId);

  const { data, error } = await query.overrideTypes<QueueTask[], { merge: false }>();
  if (error) throw new Error(`Could not load the queue: ${error.message}`);

  return data ?? [];
}

export async function getQueueTask(id: string): Promise<QueueTask | null> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("comment_tasks")
    .select(QUEUE_SELECT)
    .eq("id", id)
    .maybeSingle()
    .overrideTypes<QueueTask | null, { merge: false }>();

  if (error) throw new Error(`Could not load the task: ${error.message}`);

  return data ?? null;
}

/** Per-status counts for the filter rail badges — one round trip, aggregated in SQL. */
export async function getQueueCounts(
  client?: SupabaseDb
): Promise<Record<TaskStatus, number> & { total: number }> {
  const supabase = await resolveDb(client);

  const { data, error } = await supabase.rpc("queue_counts");
  if (error) throw new Error(`Could not count the queue: ${error.message}`);

  const counts = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<
    TaskStatus,
    number
  >;

  for (const row of data ?? []) {
    counts[row.status] = Number(row.total);
  }

  const total = TASK_STATUSES.reduce((sum, status) => sum + counts[status], 0);

  return { ...counts, total };
}

/** Accounts a task may be assigned to — every account, so a checkpointed one is visible with a warning. */
export async function listAssignableAccounts(): Promise<QueueAccount[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("social_accounts")
    .select("id,name,persona_type,status,trust_score,browser_profile_id,proxy_ip")
    .order("trust_score", { ascending: false });

  if (error) throw new Error(`Could not load accounts: ${error.message}`);

  return data ?? [];
}

export async function listQueueSourceOptions(): Promise<
  Pick<Tables<"target_sources">, "id" | "name" | "source_type">[]
> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("target_sources")
    .select("id,name,source_type")
    .order("name");

  if (error) throw new Error(`Could not load radar sources: ${error.message}`);

  return data ?? [];
}

export type QueueConversionRow = Pick<
  Tables<"affiliate_conversions">,
  | "id"
  | "sub_id"
  | "external_order_id"
  | "order_amount"
  | "estimated_commission"
  | "status"
  | "converted_at"
>;

export async function getTaskConversions({
  taskId,
  subIdCode
}: {
  taskId: string;
  subIdCode: string | null;
}): Promise<QueueConversionRow[]> {
  const supabase = await createSupabaseServerClient();

  /*
   * A postback can land before the Sub_ID resolves (or after the task row was
   * deleted, which nulls task_id). v_task_roi attributes those rows by sub_id, so
   * the detail pane must as well — otherwise the task shows "no conversions"
   * while the ROI view counts the order.
   */
  const filter = subIdCode
    ? `task_id.eq.${taskId},and(task_id.is.null,sub_id.eq.${subIdCode})`
    : `task_id.eq.${taskId}`;

  const { data, error } = await supabase
    .from("affiliate_conversions")
    .select("id,sub_id,external_order_id,order_amount,estimated_commission,status,converted_at")
    .or(filter)
    .order("converted_at", { ascending: false });

  if (error) throw new Error(`Could not load conversions: ${error.message}`);

  return data ?? [];
}
