"use server";

import { revalidatePath } from "next/cache";

import { LEAD_OWNER_ID } from "@/lib/leads/config";
import type { LeadMilestoneKind } from "@/lib/leads/sales";
import { fail, fromZodError, ok, type ActionResult } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  clearLeadMilestoneSchema,
  deleteLeadReceiptSchema,
  leadMilestoneSchema,
  leadReceiptSchema,
  leadRecurringRateSchema
} from "@/lib/validations/lead-sales";

/**
 * Operator writes for lead sales. All statements run through the RLS-scoped
 * server client as the signed-in operator plus an explicit Phase 1 owner match.
 *
 * Milestones are upserted on (lead_id, kind): re-submitting a network retry or
 * a double click updates the same row. Receipts use an idempotency key so a
 * retried payment creates at most one row, while a genuinely repeated payment
 * (new key) is a second, countable receipt.
 */

export async function markLeadMilestone(
  input: unknown
): Promise<ActionResult<{ kind: LeadMilestoneKind; occurredAt: string }>> {
  const parsed = leadMilestoneSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("lead_milestones")
    .upsert(
      {
        lead_id: parsed.data.leadId,
        kind: parsed.data.kind,
        occurred_at: parsed.data.occurredAt,
        note: parsed.data.note ?? null,
        user_id: LEAD_OWNER_ID
      },
      { onConflict: "lead_id,kind" }
    )
    .select("kind, occurred_at")
    .maybeSingle();

  if (error) return fail(error.message);
  if (!data) return fail("Không lưu được mốc chốt cho lead này.");

  revalidatePath("/leads");
  return ok({ kind: data.kind, occurredAt: data.occurred_at });
}

export async function clearLeadMilestone(input: unknown): Promise<ActionResult> {
  const parsed = clearLeadMilestoneSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("lead_milestones")
    .delete()
    .eq("lead_id", parsed.data.leadId)
    .eq("kind", parsed.data.kind)
    .eq("user_id", LEAD_OWNER_ID)
    .select("id")
    .maybeSingle();

  if (error) return fail(error.message);
  if (!data) return fail("Mốc chốt không còn tồn tại hoặc bạn không có quyền xóa.");

  revalidatePath("/leads");
  return ok();
}

export async function recordLeadReceipt(
  input: unknown
): Promise<ActionResult<{ id: string; duplicate: boolean }>> {
  const parsed = leadReceiptSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await createSupabaseServerClient();
  // Plain INSERT (not upsert) needs only INSERT/SELECT privileges; the partial
  // no-update grant on receipts stays intact. A retry with the same key raises
  // 23505, which we resolve to the existing row below instead of surfacing an
  // error or creating a second payment.
  const { data: inserted, error } = await supabase
    .from("lead_receipts")
    .insert({
      lead_id: parsed.data.leadId,
      kind: parsed.data.kind,
      amount_vnd: parsed.data.amountVnd,
      paid_at: parsed.data.paidAt,
      note: parsed.data.note ?? null,
      idempotency_key: parsed.data.idempotencyKey,
      user_id: LEAD_OWNER_ID
    })
    .select("id")
    .maybeSingle();

  if (error && error.code !== "23505") return fail(error.message);
  if (!error && inserted) {
    revalidatePath("/leads");
    return ok({ id: inserted.id, duplicate: false });
  }

  const { data: existing, error: existingError } = await supabase
    .from("lead_receipts")
    .select("id, lead_id")
    .eq("user_id", LEAD_OWNER_ID)
    .eq("idempotency_key", parsed.data.idempotencyKey)
    .maybeSingle();

  if (existingError) return fail(existingError.message);
  if (!existing) return fail("Không ghi nhận được khoản thu. Vui lòng thử lại.");
  if (existing.lead_id !== parsed.data.leadId) {
    return fail("Mã chống trùng đã thuộc một lead khác. Tải lại trang rồi thử lại.");
  }

  // Already recorded by this exact submission: success, no new cash row.
  return ok({ id: existing.id, duplicate: true });
}

export async function deleteLeadReceipt(input: unknown): Promise<ActionResult> {
  const parsed = deleteLeadReceiptSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("lead_receipts")
    .delete()
    .eq("id", parsed.data.id)
    .eq("user_id", LEAD_OWNER_ID)
    .select("id")
    .maybeSingle();

  if (error) return fail(error.message);
  if (!data) return fail("Khoản thu không còn tồn tại hoặc bạn không có quyền xóa.");

  revalidatePath("/leads");
  return ok();
}

/**
 * `monthlyVnd = null` ends the current agreement (kept as history). A number
 * updates the live row or opens a new one. This is the agreed rate only; it
 * never writes a receipt and is never counted as collected cash.
 */
export async function saveLeadRecurringRate(
  input: unknown
): Promise<ActionResult<{ monthlyVnd: number | null }>> {
  const parsed = leadRecurringRateSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await createSupabaseServerClient();
  // Asia/Ho_Chi_Minh is a fixed UTC+7 offset (no DST); the view and the
  // capture report both use this calendar day.
  const today = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const monthlyVnd = parsed.data.monthlyVnd;

  const { data: active, error: activeError } = await supabase
    .from("lead_recurring_terms")
    .select("id, started_on")
    .eq("lead_id", parsed.data.leadId)
    .eq("user_id", LEAD_OWNER_ID)
    .is("ended_on", null)
    .maybeSingle();

  if (activeError) return fail(activeError.message);

  if (monthlyVnd === null) {
    if (!active) return ok({ monthlyVnd: null });
    const { error } = await supabase
      .from("lead_recurring_terms")
      // A future-dated agreement must not end before it starts.
      .update({ ended_on: active.started_on > today ? active.started_on : today })
      .eq("id", active.id)
      .eq("user_id", LEAD_OWNER_ID);
    if (error) return fail(error.message);
    revalidatePath("/leads");
    return ok({ monthlyVnd: null });
  }

  const startedOn = parsed.data.startedOn ?? today;

  if (active) {
    const { error } = await supabase
      .from("lead_recurring_terms")
      .update({
        monthly_vnd: monthlyVnd,
        started_on: startedOn,
        note: parsed.data.note ?? null
      })
      .eq("id", active.id)
      .eq("user_id", LEAD_OWNER_ID);
    if (error) return fail(error.message);
  } else {
    const { error } = await supabase.from("lead_recurring_terms").insert({
      lead_id: parsed.data.leadId,
      monthly_vnd: monthlyVnd,
      started_on: startedOn,
      note: parsed.data.note ?? null,
      user_id: LEAD_OWNER_ID
    });
    if (error) return fail(error.message);
  }

  revalidatePath("/leads");
  return ok({ monthlyVnd });
}
