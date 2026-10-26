import type { ConversionStatus } from "@/lib/constants";
import type { SupabaseDb } from "@/lib/db";

/**
 * The one write path into `affiliate_conversions` (docs/TASKS.md T-SHOPEE-12).
 *
 * Two sources write orders here: the network/CDN postback relay and, once Shopee
 * grants API access, the `conversionReport` pull. They must agree on three rules or
 * the same order ends up counted twice and money moves between tasks:
 *
 *   1. `external_order_id` is the identity — one row per order, whoever writes first.
 *   2. A replay may be poorer than what is stored (status-only callbacks, no amounts,
 *      an older Sub_ID), so amounts only ever increase and `converted_at` keeps the
 *      first sighting.
 *   3. Status moves forward only: `canceled` wins from anywhere, `settled` is never
 *      demoted back to `pending` by an out-of-order replay.
 *
 * The postback route used to implement this inline; it now calls `applyConversion` so
 * the future pull job cannot drift from it.
 */

export type ConversionInput = {
  /** Sub_ID echoed back from the clicked affiliate link. */
  subId: string;
  /** Shopee order id — the idempotency key. */
  externalOrderId: string;
  orderAmount?: number | null;
  estimatedCommission?: number | null;
  status: ConversionStatus;
  convertedAt?: string | null;
};

export type ConversionWriteResult = {
  conversionId: string;
  taskId: string | null;
  status: ConversionStatus;
  created: boolean;
  warnings: string[];
};

/**
 * Status only ever moves forward. Exported for tests: this is the rule that decides
 * which number analytics shows.
 */
export function nextConversionStatus(
  current: ConversionStatus,
  incoming: ConversionStatus
): ConversionStatus {
  if (current === incoming) return current;
  if (incoming === "canceled") return "canceled";
  if (current === "canceled") return "canceled";
  if (current === "settled" && incoming === "pending") return "settled";
  return incoming;
}

type ExistingRow = {
  id: string;
  task_id: string | null;
  sub_id: string;
  external_order_id: string;
  order_amount: number | string | null;
  estimated_commission: number | string | null;
  status: ConversionStatus;
  converted_at: string | null;
};

/** Amounts never decrease; an omitted amount keeps what is stored. */
export function mergeAmount(current: number | string | null, incoming: number | null | undefined): number {
  const stored = Number(current ?? 0);
  return Math.max(stored, incoming ?? 0);
}

export async function applyConversion(
  db: SupabaseDb,
  input: ConversionInput
): Promise<ConversionWriteResult> {
  const warnings: string[] = [];

  const { data: existing, error: existingError } = await db
    .from("affiliate_conversions")
    .select("id,task_id,sub_id,external_order_id,order_amount,estimated_commission,status,converted_at")
    .eq("external_order_id", input.externalOrderId)
    .maybeSingle()
    .overrideTypes<ExistingRow | null, { merge: false }>();

  if (existingError) throw new Error(`Could not look up order ${input.externalOrderId}: ${existingError.message}`);

  if (existing) {
    if (existing.sub_id !== input.subId) {
      warnings.push(
        `Sub_ID mismatch: kept ${existing.sub_id}, ignored ${input.subId}. Reassignment would move revenue between tasks.`
      );
    }
    if (input.orderAmount != null && input.orderAmount < Number(existing.order_amount ?? 0)) {
      warnings.push("Incoming amount is lower than the stored one; kept the higher value.");
    }

    const { data: updated, error: updateError } = await db
      .from("affiliate_conversions")
      .update({
        status: nextConversionStatus(existing.status, input.status),
        order_amount: mergeAmount(existing.order_amount, input.orderAmount),
        estimated_commission: mergeAmount(existing.estimated_commission, input.estimatedCommission),
        // converted_at keeps the first sighting; replays must not re-date it.
        task_id: existing.task_id
      })
      .eq("id", existing.id)
      .select("id,task_id,status")
      .single();

    if (updateError) throw new Error(`Could not update order ${input.externalOrderId}: ${updateError.message}`);

    return {
      conversionId: updated.id,
      taskId: updated.task_id,
      status: updated.status,
      created: false,
      warnings
    };
  }

  const { data: task, error: taskError } = await db
    .from("comment_tasks")
    .select("id")
    .eq("sub_id_code", input.subId)
    .maybeSingle();

  // A failed lookup must not silently store an unattributed row that would then shadow
  // the attributed one for this order id.
  if (taskError) throw new Error(`Could not resolve the task for ${input.subId}: ${taskError.message}`);

  const { data: inserted, error: insertError } = await db
    .from("affiliate_conversions")
    .insert({
      task_id: task?.id ?? null,
      sub_id: input.subId,
      external_order_id: input.externalOrderId,
      order_amount: input.orderAmount ?? 0,
      estimated_commission: input.estimatedCommission ?? 0,
      status: input.status,
      converted_at: input.convertedAt ?? new Date().toISOString()
    })
    .select("id,task_id,status")
    .single();

  if (insertError) {
    // 23505: a concurrent writer inserted the same order id between the read and the
    // write. The row exists now, so the caller can replay and take the merge path.
    if (insertError.code === "23505") {
      throw new Error(`Order ${input.externalOrderId} was stored concurrently — replay the callback.`);
    }
    throw new Error(`Could not store order ${input.externalOrderId}: ${insertError.message}`);
  }

  if (!task) warnings.push("No task owns this Sub_ID yet — stored unattributed.");

  return {
    conversionId: inserted.id,
    taskId: inserted.task_id,
    status: inserted.status,
    created: true,
    warnings
  };
}

/**
 * Attaches orders whose Sub_ID only appeared after the conversion was stored.
 *
 * Called after a pull/postback batch. The same RPC powers `/api/cron/reconcile`, so
 * there is one attribution rule in the system, not two.
 */
export async function reconcileAfterIngest(db: SupabaseDb): Promise<{ attributed: number; remaining: number }> {
  const { data, error } = await db.rpc("reconcile_conversions").maybeSingle();

  if (error) throw new Error(`Could not reconcile conversions: ${error.message}`);

  const result = (data ?? { attributed: 0, remaining: 0 }) as { attributed: number; remaining: number };
  return { attributed: result.attributed, remaining: result.remaining };
}
