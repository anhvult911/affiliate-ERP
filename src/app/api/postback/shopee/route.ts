import { z } from "zod";

import { CONVERSION_STATUSES, type ConversionStatus } from "@/lib/constants";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readPostbackBody } from "@/lib/worker/postback-body";
import { authorizeWorker, workerJson } from "@/lib/worker/auth";

export const dynamic = "force-dynamic";

const postbackSchema = z.object({
  /** Sub_ID the network echoed back from the clicked affiliate link. */
  sub_id: z.string().trim().min(1).max(64),
  order_id: z.string().trim().min(1).max(128),
  /**
   * Amounts are optional: networks send status-only callbacks (e.g. "settled"),
   * and an omitted/empty amount must never zero out a stored order.
   */
  order_amount: z.coerce.number().min(0).nullish(),
  estimated_commission: z.coerce.number().min(0).nullish(),
  status: z.enum(CONVERSION_STATUSES).default("pending"),
  converted_at: z.string().datetime().optional()
});

/**
 * Status only ever moves forward. `canceled` wins from anywhere (refunds and
 * cancellations arrive late); a `settled` order is never demoted back to
 * `pending` by a replayed or out-of-order callback.
 */
function nextStatus(current: ConversionStatus, incoming: ConversionStatus): ConversionStatus {
  if (current === incoming) return current;
  if (incoming === "canceled") return "canceled";
  if (current === "canceled") return "canceled";
  if (current === "settled" && incoming === "pending") return "settled";
  return incoming;
}

/**
 * POST /api/postback/shopee
 *
 * Network postback relay (the operator forwards Shopee/Lazada callbacks here,
 * or a scheduled job pulls them). Keyed by `external_order_id` and deliberately
 * *merged* rather than upserted: a replay may carry no amounts, an older status
 * or the wrong Sub_ID, and none of those may rewrite money already recorded.
 */
export async function POST(request: Request) {
  const auth = authorizeWorker(request);
  if (!auth.ok) return auth.response;

  const incoming = await readPostbackBody(request);
  if (!incoming.ok) {
    return workerJson({ ok: false, error: incoming.error }, incoming.status);
  }

  const parsed = postbackSchema.safeParse(incoming.body);
  if (!parsed.success) {
    return workerJson({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid postback." }, 400);
  }

  const payload = parsed.data;
  const supabase = createSupabaseAdminClient();

  const { data: existing, error: existingError } = await supabase
    .from("affiliate_conversions")
    .select(
      "id,task_id,sub_id,external_order_id,order_amount,estimated_commission,status,converted_at"
    )
    .eq("external_order_id", payload.order_id)
    .maybeSingle();

  if (existingError) return workerJson({ ok: false, error: existingError.message }, 500);

  const warnings: string[] = [];

  if (existing) {
    const subId = existing.sub_id;
    if (subId !== payload.sub_id) {
      warnings.push(
        `Sub_ID mismatch: kept ${subId}, ignored ${payload.sub_id}. Reassignment would move revenue between tasks.`
      );
    }
    if (payload.order_amount !== null && payload.order_amount !== undefined && payload.order_amount < Number(existing.order_amount)) {
      warnings.push("Incoming amount is lower than the stored one; kept the higher value.");
    }

    const { data: updated, error: updateError } = await supabase
      .from("affiliate_conversions")
      .update({
        status: nextStatus(existing.status, payload.status),
        order_amount: Math.max(Number(existing.order_amount), payload.order_amount ?? 0),
        estimated_commission: Math.max(
          Number(existing.estimated_commission),
          payload.estimated_commission ?? 0
        ),
        // converted_at stays at the first sighting; replays must not re-date it.
        task_id: existing.task_id
      })
      .eq("id", existing.id)
      .select("id,task_id,status")
      .single();

    if (updateError) return workerJson({ ok: false, error: updateError.message }, 500);

    return workerJson({
      ok: true,
      conversionId: updated.id,
      attributed: Boolean(updated.task_id),
      updated: true,
      status: updated.status,
      warnings
    });
  }

  const { data: task, error: taskError } = await supabase
    .from("comment_tasks")
    .select("id")
    .eq("sub_id_code", payload.sub_id)
    .maybeSingle();

  // A failed lookup must not silently store an unattributed row that would then
  // shadow the attributed one for this order id.
  if (taskError) return workerJson({ ok: false, error: taskError.message }, 500);

  const { data: inserted, error: insertError } = await supabase
    .from("affiliate_conversions")
    .insert({
      task_id: task?.id ?? null,
      sub_id: payload.sub_id,
      external_order_id: payload.order_id,
      order_amount: payload.order_amount ?? 0,
      estimated_commission: payload.estimated_commission ?? 0,
      status: payload.status,
      converted_at: payload.converted_at ?? new Date().toISOString()
    })
    .select("id,task_id")
    .single();

  if (insertError) {
    // 23505: a concurrent replay inserted the same order id between our read and
    // write. The row now exists, so the next callback takes the merge path.
    if (insertError.code === "23505") {
      return workerJson(
        { ok: false, error: "This order id was stored concurrently — replay the callback." },
        409
      );
    }
    return workerJson({ ok: false, error: insertError.message }, 500);
  }

  if (!task) {
    warnings.push("No task owns this Sub_ID yet — stored unattributed.");
  }

  return workerJson({
    ok: true,
    conversionId: inserted.id,
    attributed: Boolean(inserted.task_id),
    updated: false,
    status: payload.status,
    warnings
  });
}
