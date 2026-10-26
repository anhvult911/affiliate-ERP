import { z } from "zod";

import { CONVERSION_STATUSES } from "@/lib/constants";
import { applyConversion, reconcileAfterIngest } from "@/lib/shopee/conversions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
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

  const contentType = request.headers.get("content-type") ?? "";
  const rawBody = contentType.includes("application/json")
    ? await request.json().catch(() => null)
    : Object.fromEntries((await request.formData().catch(() => new FormData())).entries());

  const parsed = postbackSchema.safeParse(rawBody);
  if (!parsed.success) {
    return workerJson({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid postback." }, 400);
  }

  const payload = parsed.data;

  try {
    const result = await applyConversion(createSupabaseAdminClient(), {
      subId: payload.sub_id,
      externalOrderId: payload.order_id,
      orderAmount: payload.order_amount ?? null,
      estimatedCommission: payload.estimated_commission ?? null,
      status: payload.status,
      convertedAt: payload.converted_at ?? null
    });

    // Attribution is a single rule shared with the cron: a Sub_ID that appears later
    // still attaches, without a second write path that could double-count.
    await reconcileAfterIngest(createSupabaseAdminClient()).catch(() => undefined);

    return workerJson({
      ok: true,
      conversionId: result.conversionId,
      attributed: Boolean(result.taskId),
      updated: !result.created,
      created: result.created,
      status: result.status,
      warnings: result.warnings
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const conflict = /stored concurrently/.test(message);
    return workerJson({ ok: false, error: message }, conflict ? 409 : 500);
  }
}
