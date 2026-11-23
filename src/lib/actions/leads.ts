"use server";

import { revalidatePath } from "next/cache";

import type { TablesUpdate } from "@/lib/database.types";
import { LEAD_OWNER_ID } from "@/lib/leads/config";
import { fail, fromZodError, ok, type ActionResult } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { leadUpdateSchema } from "@/lib/validations/lead";

/**
 * Applies operator edits; the database trigger owns the CRM clock:
 *   - entering `replied` / `sent_freebie` stamps `last_contacted_at` and
 *     schedules +48h unless the update supplies a different follow-up value
 *   - entering `bought_template` / `upsold_automation` / `ignored` clears it
 *
 * This action only forwards an explicit manual override, so the arithmetic
 * exists in one place (the trigger) instead of drifting between layers.
 *
 * The update is scoped by both id and owner in addition to RLS; a lead that
 * belongs to another tenant (Phase 2) is reported as not found rather than
 * silently updated.
 */
export async function updateLead(input: unknown): Promise<
  ActionResult<{ status: string; nextFollowupAt: string | null }>
> {
  const parsed = leadUpdateSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const patch: TablesUpdate<"leads"> = {};

  if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes;
  if (parsed.data.status !== undefined) patch.status = parsed.data.status;
  if (parsed.data.next_followup_at !== undefined) {
    patch.next_followup_at = parsed.data.next_followup_at;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("leads")
    .update(patch)
    .eq("id", parsed.data.id)
    .eq("user_id", LEAD_OWNER_ID)
    .select("id, status, next_followup_at")
    .maybeSingle();

  if (error) return fail(error.message);
  if (!data) return fail("Lead không còn tồn tại hoặc bạn không có quyền cập nhật.");

  revalidatePath("/leads");
  return ok({ status: data.status, nextFollowupAt: data.next_followup_at });
}
