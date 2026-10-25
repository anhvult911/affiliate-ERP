"use server";

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fail, fromZodError, ok, type ActionResult } from "@/lib/result";
import { signInSchema } from "@/lib/validations/auth";

const NOT_ALLOWLISTED =
  "This account is signed in but not an operator yet. Add its user id to public.operators " +
  "(see README → Bootstrap the operator account).";

export async function signInAction(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password")
  });

  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) return fail(error.message);

  // Signed in, but RLS only shows rows to allowlisted operators — fail loudly
  // here instead of rendering an empty dashboard.
  const { data: isOperator, error: rpcError } = await supabase.rpc("is_operator");
  if (rpcError) return fail(rpcError.message);
  if (!isOperator) {
    await supabase.auth.signOut();
    return fail(NOT_ALLOWLISTED);
  }

  const next = formData.get("next");
  const target = typeof next === "string" && next.startsWith("/") ? next : "/queue";
  redirect(target);
}

export async function signOutAction(): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut();
  if (error) return fail(error.message);
  return ok();
}
