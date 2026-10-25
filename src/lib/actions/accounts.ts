"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ACCOUNT_STATUSES, SOCIAL_PLATFORMS } from "@/lib/constants";
import {
  defaultAccountName,
  parseAccountLines
} from "@/lib/accounts/credential-format";
import { defaultSchedule } from "@/lib/warming/defaults";
import {
  encryptSecret,
  isCredentialsKeyConfigured,
  MissingCredentialsKeyError
} from "@/lib/crypto/secret-box";
import { fail, fromZodError, ok, type ActionResult } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { accountInputSchema, personaInputSchema } from "@/lib/validations/account";

const idSchema = z.string().uuid("Unknown account.");
const idObjectSchema = z.object({ id: idSchema });

const statusChangeSchema = z.object({
  id: idSchema,
  status: z.enum(ACCOUNT_STATUSES, {
    errorMap: () => ({ message: "Choose a supported status." })
  }),
  cooldownUntil: z.string().trim().min(1).optional().nullable()
});

const trustAdjustSchema = z.object({
  id: idSchema,
  delta: z
    .number({ invalid_type_error: "Trust change must be a number." })
    .int("Trust change must be a whole number.")
    .min(-100, "Cannot drop trust by more than 100.")
    .max(100, "Cannot raise trust by more than 100.")
});

const warmupSchema = z.object({
  id: idSchema,
  enabled: z.boolean({ invalid_type_error: "Choose on or off." })
});

function clampTrustScore(value: number) {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function writeError(
  message: string,
  code: string | undefined,
  browserProfileId: string | null
) {
  if (code === "23505" && browserProfileId) {
    return `Browser profile ${browserProfileId} is already linked to another account`;
  }
  return message;
}

export async function createAccount(input: unknown): Promise<ActionResult> {
  const parsed = accountInputSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await createSupabaseServerClient();
  const values = parsed.data;

  const { error } = await supabase.from("social_accounts").insert({
    name: values.name,
    platform: values.platform,
    persona_type: values.persona_type,
    browser_profile_id: values.browser_profile_id,
    proxy_ip: values.proxy_ip,
    status: values.status,
    trust_score: clampTrustScore(values.trust_score),
    bio_link_url: values.bio_link_url,
    notes: values.notes,
    // An empty list means "never warm", which looks identical to a healthy
    // account in the UI — so a new account starts with the default schedule and
    // `warmup_enabled` is the switch that turns warming off.
    persona_schedule:
      Array.isArray(values.persona_schedule) && values.persona_schedule.length > 0
        ? values.persona_schedule
        : defaultSchedule(),
    warmup_enabled: values.warmup_enabled,
    daily_comment_limit: values.daily_comment_limit,
    daily_warming_limit: values.daily_warming_limit,
    min_action_gap_minutes: values.min_action_gap_minutes,
    cooldown_until: values.status === "cooldown" ? values.cooldown_until : null
  });

  if (error) {
    return fail(writeError(error.message, error.code, values.browser_profile_id));
  }

  revalidatePath("/accounts");
  return ok();
}

export async function updateAccount(
  id: string,
  input: unknown
): Promise<ActionResult> {
  const idParsed = idObjectSchema.safeParse({ id });
  if (!idParsed.success) return fromZodError(idParsed.error);

  const parsed = accountInputSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await createSupabaseServerClient();
  const values = parsed.data;

  const { data, error } = await supabase
    .from("social_accounts")
    .update({
      name: values.name,
      platform: values.platform,
      persona_type: values.persona_type,
      browser_profile_id: values.browser_profile_id,
      proxy_ip: values.proxy_ip,
      status: values.status,
      trust_score: clampTrustScore(values.trust_score),
      bio_link_url: values.bio_link_url,
      notes: values.notes,
      // On edit the operator's list is taken literally: clearing it is a valid way
      // to stop the posting cadence without touching `warmup_enabled`.
      persona_schedule: values.persona_schedule ?? [],
      warmup_enabled: values.warmup_enabled,
      daily_comment_limit: values.daily_comment_limit,
      daily_warming_limit: values.daily_warming_limit,
      min_action_gap_minutes: values.min_action_gap_minutes,
      cooldown_until: values.status === "cooldown" ? values.cooldown_until : null
    })
    .eq("id", idParsed.data.id)
    .select("id")
    .maybeSingle();

  if (error) {
    return fail(writeError(error.message, error.code, values.browser_profile_id));
  }
  if (!data) return fail("Account not found.");

  revalidatePath("/accounts");
  revalidatePath(`/accounts/${idParsed.data.id}`);
  return ok();
}

export async function deleteAccount(id: string): Promise<ActionResult> {
  const idParsed = idObjectSchema.safeParse({ id });
  if (!idParsed.success) return fromZodError(idParsed.error);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("social_accounts")
    .delete()
    .eq("id", idParsed.data.id)
    .select("id")
    .maybeSingle();

  if (error) return fail(error.message);
  if (!data) return fail("Account not found.");

  revalidatePath("/accounts");
  return ok();
}

/** Persona-only save used by the schedule editor on the detail page. */
export async function updateAccountPersona(
  id: string,
  input: unknown
): Promise<ActionResult> {
  const idParsed = idObjectSchema.safeParse({ id });
  if (!idParsed.success) return fromZodError(idParsed.error);

  const parsed = personaInputSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("social_accounts")
    .update({
      persona_type: parsed.data.persona_type,
      persona_schedule: parsed.data.persona_schedule ?? []
    })
    .eq("id", idParsed.data.id)
    .select("id")
    .maybeSingle();

  if (error) return fail(error.message);
  if (!data) return fail("Account not found.");

  revalidatePath("/accounts");
  revalidatePath(`/accounts/${idParsed.data.id}`);
  return ok();
}

export async function adjustTrustScore(
  id: string,
  delta: number
): Promise<ActionResult> {
  const parsed = trustAdjustSchema.safeParse({ id, delta });
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { data: current, error: readError } = await supabase
    .from("social_accounts")
    .select("trust_score")
    .eq("id", parsed.data.id)
    .maybeSingle();

  if (readError) return fail(readError.message);
  if (!current) return fail("Account not found.");

  const nextScore = clampTrustScore(current.trust_score + parsed.data.delta);
  if (nextScore === current.trust_score) return ok();

  const { error } = await supabase
    .from("social_accounts")
    .update({ trust_score: nextScore })
    .eq("id", parsed.data.id);

  if (error) return fail(error.message);

  revalidatePath("/accounts");
  revalidatePath(`/accounts/${parsed.data.id}`);
  return ok();
}

export async function setAccountStatus(
  id: string,
  status: string,
  cooldownUntil?: string | null
): Promise<ActionResult> {
  const parsed = statusChangeSchema.safeParse({ id, status, cooldownUntil });
  if (!parsed.success) return fromZodError(parsed.error);

  let nextCooldown: string | null = null;
  if (parsed.data.status === "cooldown") {
    const raw = parsed.data.cooldownUntil;
    if (!raw) {
      return fail("Set a cooldown end time.", {
        cooldown_until: ["Cooldown end is required."]
      });
    }

    const when = new Date(raw);
    if (Number.isNaN(when.getTime())) {
      return fail("Enter a valid cooldown end time.", {
        cooldown_until: ["Enter a valid date and time."]
      });
    }
    if (when.getTime() <= Date.now()) {
      return fail("Cooldown must end in the future.", {
        cooldown_until: ["Cooldown must end in the future."]
      });
    }
    nextCooldown = when.toISOString();
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("social_accounts")
    .update({ status: parsed.data.status, cooldown_until: nextCooldown })
    .eq("id", parsed.data.id)
    .select("id")
    .maybeSingle();

  if (error) return fail(error.message);
  if (!data) return fail("Account not found.");

  revalidatePath("/accounts");
  revalidatePath(`/accounts/${parsed.data.id}`);
  return ok();
}

export async function toggleWarmup(
  id: string,
  enabled: boolean
): Promise<ActionResult> {
  const parsed = warmupSchema.safeParse({ id, enabled });
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("social_accounts")
    .update({ warmup_enabled: parsed.data.enabled })
    .eq("id", parsed.data.id)
    .select("id")
    .maybeSingle();

  if (error) return fail(error.message);
  if (!data) return fail("Account not found.");

  revalidatePath("/accounts");
  revalidatePath(`/accounts/${parsed.data.id}`);
  return ok();
}

const importSchema = z.object({
  lines: z.string().trim().min(1, "Dán ít nhất một dòng account."),
  personaType: z.string().trim().min(1, "Chọn người cho nhóm account này.").max(40),
  platform: z.enum(SOCIAL_PLATFORMS).default("facebook")
});

export type ImportAccountsResult = {
  created: number;
  duplicates: number;
  issues: { line: number; error: string }[];
};

/**
 * Imports `uid|password|2FA|proxy` lines (the operator's Facebook export).
 *
 * Passwords and TOTP secrets are encrypted before they reach the database; a
 * missing ACCOUNT_CREDENTIALS_KEY fails the whole import rather than silently
 * storing plain text. Rows are inserted one at a time so one duplicate cannot roll
 * back the other 19 accounts in the paste.
 */
export async function importAccounts(input: unknown): Promise<ActionResult<ImportAccountsResult>> {
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const { accounts, issues } = parseAccountLines(parsed.data.lines);
  if (accounts.length === 0 && issues.length === 0) {
    return fail("Không tìm thấy dòng nào để nhập.");
  }

  if (!isCredentialsKeyConfigured()) {
    return fail(new MissingCredentialsKeyError().message);
  }

  const supabase = await createSupabaseServerClient();
  const result: ImportAccountsResult = { created: 0, duplicates: 0, issues: [...issues] };

  for (const account of accounts) {
    const { error } = await supabase.from("social_accounts").insert({
      name: defaultAccountName(account.identifier),
      platform: parsed.data.platform,
      persona_type: parsed.data.personaType,
      status: "active",
      login_identifier: account.identifier,
      login_password_enc: encryptSecret(account.password),
      twofa_secret_enc: encryptSecret(account.twofaSecret),
      proxy_ip: account.proxy ? `${account.proxy.host}:${account.proxy.port}` : null,
      proxy_host: account.proxy?.host ?? null,
      proxy_port: account.proxy?.port ?? null,
      proxy_username: account.proxy?.username ?? null,
      proxy_password_enc: account.proxy?.password ? encryptSecret(account.proxy.password) : null,
      credentials_imported_at: new Date().toISOString(),
      persona_schedule: defaultSchedule(),
      notes: "Nhập từ file account (uid|pass|2FA|proxy)."
    });

    if (!error) {
      result.created += 1;
      continue;
    }

    if (error.code === "23505") {
      result.duplicates += 1;
      result.issues.push({ line: account.line, error: `UID ${account.identifier} đã có trong hệ thống.` });
      continue;
    }

    result.issues.push({ line: account.line, error: error.message });
  }

  if (result.created > 0) {
    revalidatePath("/accounts");
  }

  if (result.created === 0 && result.duplicates === 0 && issues.length === 0) {
    return fail("Không nhập được account nào.");
  }

  return ok(result);
}
