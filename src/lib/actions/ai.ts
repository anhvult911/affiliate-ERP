"use server";

import { revalidatePath } from "next/cache";

import { fail, fromZodError, ok, type ActionResult } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { saveDraftSchema } from "@/lib/validations/ai";

/**
 * Persists an operator-reviewed draft. The draft playground calls this after
 * generation so manual edits survive; the API route already stores the raw
 * Gemini output as soon as it is produced.
 */
export async function saveDraft(
  taskId: string,
  draft: string
): Promise<ActionResult<{ taskId: string }>> {
  const parsed = saveDraftSchema.safeParse({ taskId, draft });
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("comment_tasks")
    .update({ ai_draft_comment: parsed.data.draft })
    .eq("id", parsed.data.taskId)
    .eq("status", "pending_approval")
    .select("id")
    .maybeSingle();

  if (error) return fail(error.message);
  if (!data) {
    return fail("Task is no longer awaiting approval; the draft was not saved.");
  }

  revalidatePath("/queue");
  revalidatePath("/ai");
  return ok({ taskId: parsed.data.taskId });
}
