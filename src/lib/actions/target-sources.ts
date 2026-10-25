"use server";

import { revalidatePath } from "next/cache";

import { fail, fromZodError, ok, type ActionResult } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  targetSourceIdSchema,
  targetSourceSchema
} from "@/lib/validations/target-source";

/** Duplicate URLs are rejected by the unique index — surface a field-level message. */
function databaseError(error: { code?: string; message: string }): ActionResult<never> {
  if (error.code === "23505") {
    return fail("A source with this URL is already on the radar.", {
      url: ["This URL is already monitored."]
    });
  }
  return fail(error.message);
}

function revalidateRadar(sourceId?: string) {
  revalidatePath("/radar");
  if (sourceId) revalidatePath(`/radar/${sourceId}`);
}

export async function createSource(input: unknown): Promise<ActionResult> {
  const parsed = targetSourceSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("target_sources").insert(parsed.data);

  if (error) return databaseError(error);

  revalidateRadar();
  return ok();
}

export async function updateSource(id: string, input: unknown): Promise<ActionResult> {
  const parsedId = targetSourceIdSchema.safeParse(id);
  if (!parsedId.success) return fromZodError(parsedId.error);

  const parsed = targetSourceSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("target_sources")
    .update(parsed.data)
    .eq("id", parsedId.data);

  if (error) return databaseError(error);

  revalidateRadar(parsedId.data);
  return ok();
}

/**
 * The FK from comment_tasks is `on delete set null`, so captured tasks survive
 * the deletion — the confirm dialog states this explicitly.
 */
export async function deleteSource(id: string): Promise<ActionResult> {
  const parsedId = targetSourceIdSchema.safeParse(id);
  if (!parsedId.success) return fromZodError(parsedId.error);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("target_sources")
    .delete()
    .eq("id", parsedId.data)
    .select("id");

  if (error) return fail(error.message);
  if (!data || data.length === 0) return fail("This source no longer exists.");

  revalidateRadar(parsedId.data);
  return ok();
}

export async function toggleSourceActive(id: string, isActive: boolean): Promise<ActionResult> {
  const parsedId = targetSourceIdSchema.safeParse(id);
  if (!parsedId.success) return fromZodError(parsedId.error);
  if (typeof isActive !== "boolean") return fail("Invalid monitoring state.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("target_sources")
    .update({ is_active: isActive })
    .eq("id", parsedId.data);

  if (error) return fail(error.message);

  revalidateRadar(parsedId.data);
  return ok();
}

/**
 * Resets the scan clock so the worker's `last_scanned_at + interval < now()`
 * check skips this source until the next cadence window.
 */
export async function markSourceScanned(id: string): Promise<ActionResult> {
  const parsedId = targetSourceIdSchema.safeParse(id);
  if (!parsedId.success) return fromZodError(parsedId.error);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("target_sources")
    .update({ last_scanned_at: new Date().toISOString() })
    .eq("id", parsedId.data);

  if (error) return fail(error.message);

  revalidateRadar(parsedId.data);
  return ok();
}
