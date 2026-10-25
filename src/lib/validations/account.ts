import { z } from "zod";

import { ACCOUNT_STATUSES, SOCIAL_PLATFORMS } from "@/lib/constants";
import type { Json } from "@/lib/database.types";

/** 24-hour wall-clock time used by the Auto-Profile Builder schedule. */
export const SCHEDULE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export type PersonaScheduleEntry = { at: string; kind: string };

export const personaScheduleEntrySchema = z.object({
  at: z
    .string()
    .trim()
    .regex(SCHEDULE_TIME_PATTERN, "Use 24-hour HH:MM, e.g. 09:30."),
  kind: z
    .string()
    .trim()
    .min(1, "Describe the warming action.")
    .max(80, "Keep the action under 80 characters.")
});

/**
 * Empty strings from form inputs mean "not provided", not the literal value.
 */
function blankToUndefined(value: unknown) {
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value ?? undefined;
}

function optionalText(max: number, message: string) {
  return z
    .preprocess(
      blankToUndefined,
      z.string().trim().max(max, message).optional()
    )
    .transform((value) => value ?? null);
}

const optionalUrl = z
  .preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .max(500, "Keep the bio link under 500 characters.")
      .refine((value) => /^https?:\/\/[^\s]+$/i.test(value), "Enter a full http(s) URL.")
      .optional()
  )
  .transform((value) => value ?? null);

function booleanField(fallback: boolean) {
  return z.preprocess(
    (value) => {
      if (value === null || value === undefined) return undefined;
      if (typeof value === "boolean") return value;
      if (typeof value === "number") return value !== 0;
      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["true", "on", "1", "yes"].includes(normalized)) return true;
        if (["false", "off", "0", "no", ""].includes(normalized)) return false;
      }
      return value;
    },
    z.boolean({ invalid_type_error: "Choose on or off." }).default(fallback)
  );
}

const trustScoreField = z.preprocess(
  (value) => (value === null || value === undefined || value === "" ? 10 : value),
  z.coerce
    .number({ invalid_type_error: "Trust score must be a number." })
    .int("Trust score must be a whole number.")
    .min(0, "Trust score cannot be below 0.")
    .max(100, "Trust score cannot exceed 100.")
);

/** Whole number with a fallback, for the per-account volume limits. */
function limitField(fallback: number, min: number, max: number, label: string) {
  return z.preprocess(
    (value) => (value === null || value === undefined || value === "" ? fallback : value),
    z.coerce
      .number({ invalid_type_error: `${label} must be a number.` })
      .int(`${label} must be a whole number.`)
      .min(min, `${label} cannot be below ${min}.`)
      .max(max, `${label} cannot exceed ${max}.`)
  );
}

const cooldownField = z
  .preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date and time.")
      .optional()
  )
  .transform((value) => (value ? new Date(value).toISOString() : null));

/**
 * Schedule arrives either as an already-parsed array (internal callers) or as
 * the JSON textarea value from the account form. Invalid JSON becomes `null` so
 * the array schema reports a readable field error instead of a generic one.
 */
const scheduleField = z
  .preprocess(
    (value) => {
      if (typeof value !== "string") return value ?? [];
      const trimmed = value.trim();
      if (trimmed === "") return [];
      try {
        return JSON.parse(trimmed) as unknown;
      } catch {
        return null;
      }
    },
    z
      .array(personaScheduleEntrySchema, {
        invalid_type_error: "Enter a JSON array of { at, kind } entries.",
        required_error: "Enter a JSON array of { at, kind } entries."
      })
      .max(24, "Keep the schedule under 24 entries.")
  )
  .transform((entries) => entries as unknown as Json);

export const accountInputSchema = z
  .object({
    name: z
      .string({
        required_error: "Account name is required.",
        invalid_type_error: "Account name is required."
      })
      .trim()
      .min(1, "Account name is required.")
      .max(80, "Keep the name under 80 characters."),
    platform: z.preprocess(
      blankToUndefined,
      z
        .enum(SOCIAL_PLATFORMS, {
          errorMap: () => ({ message: "Choose a supported platform." })
        })
        .default("facebook")
    ),
    persona_type: z
      .string({
        required_error: "Persona type is required.",
        invalid_type_error: "Persona type is required."
      })
      .trim()
      .min(1, "Persona type is required.")
      .max(40, "Keep the persona type under 40 characters."),
    browser_profile_id: optionalText(
      120,
      "Keep the browser profile id under 120 characters."
    ),
    proxy_ip: optionalText(120, "Keep the proxy under 120 characters."),
    status: z.preprocess(
      blankToUndefined,
      z
        .enum(ACCOUNT_STATUSES, {
          errorMap: () => ({ message: "Choose a supported status." })
        })
        .default("active")
    ),
    trust_score: trustScoreField,
    bio_link_url: optionalUrl,
    notes: optionalText(2000, "Keep notes under 2000 characters."),
    persona_schedule: scheduleField,
    warmup_enabled: booleanField(true),
    cooldown_until: cooldownField,
    // Volume limits: enforced by claim_comment_tasks() and the warming cycle.
    daily_comment_limit: limitField(8, 0, 50, "Daily comment limit"),
    daily_warming_limit: limitField(4, 0, 20, "Daily warming limit"),
    min_action_gap_minutes: limitField(20, 0, 1440, "Minimum action gap")
  })
  .superRefine((value, ctx) => {
    if (value.status !== "cooldown") return;
    if (!value.cooldown_until) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cooldown_until"],
        message: "Set when the cooldown ends."
      });
      return;
    }
    if (Date.parse(value.cooldown_until) <= Date.now()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cooldown_until"],
        message: "Cooldown must end in the future."
      });
    }
  });

export const createAccountSchema = accountInputSchema;
export const updateAccountSchema = accountInputSchema;

export type AccountInput = z.infer<typeof accountInputSchema>;
export type CreateAccountInput = AccountInput;
export type UpdateAccountInput = AccountInput;

export const personaInputSchema = z.object({
  persona_type: z
    .string({
      required_error: "Persona type is required.",
      invalid_type_error: "Persona type is required."
    })
    .trim()
    .min(1, "Persona type is required.")
    .max(40, "Keep the persona type under 40 characters."),
  persona_schedule: scheduleField
});

export type PersonaInput = z.infer<typeof personaInputSchema>;

/**
 * Reads a stored jsonb schedule back into rows the editor can render. Malformed
 * entries (hand-edited rows, older shapes) are skipped rather than crashing the
 * persona manager.
 */
export function parsePersonaSchedule(
  value: Json | null | undefined
): PersonaScheduleEntry[] {
  if (!Array.isArray(value)) return [];

  const entries: PersonaScheduleEntry[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const at = typeof item.at === "string" ? item.at : null;
    const kind = typeof item.kind === "string" ? item.kind : null;
    if (!at || !kind || !SCHEDULE_TIME_PATTERN.test(at)) continue;
    entries.push({ at, kind });
  }
  return entries;
}
