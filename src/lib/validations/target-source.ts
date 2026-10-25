import { z } from "zod";

import { SOURCE_TYPES } from "@/lib/constants";

/** Empty strings (and absent fields) from form inputs mean "not provided". */
const blankToUndefined = (value: unknown) => {
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value ?? undefined;
};

/**
 * Optional free-text column. Stored as NULL (not "") because the prompt builder
 * tests for presence before injecting a block.
 */
function optionalText(max: number, message: string) {
  return z
    .preprocess(blankToUndefined, z.string().trim().max(max, message).optional())
    .transform((value) => value ?? null);
}

/**
 * `is_active` reaches the action from three places: a Radix Switch (hidden
 * input submitting "true"/"false"), a native checkbox ("on"/absent) and direct
 * programmatic calls (boolean/undefined). Normalise all of them before the
 * boolean check — plain `z.coerce.boolean()` would turn "false" into true.
 */
const booleanField = z.preprocess((value) => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["true", "on", "1", "yes"].includes(normalized);
  }
  return value;
}, z.boolean().default(true));

export const targetSourceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(120, "Name must be 120 characters or fewer."),
  url: z
    .string()
    .trim()
    .regex(/^https?:\/\//i, "URL must start with http:// or https://."),
  source_type: z.enum(SOURCE_TYPES),
  niche: optionalText(120, "Niche must be 120 characters or fewer."),
  // Injected into the Gemini draft prompt so replies imitate the room.
  tone_of_voice: optionalText(500, "Tone of voice must be 500 characters or fewer."),
  group_rules: optionalText(2000, "Group rules must be 2,000 characters or fewer."),
  scan_interval_mins: z.coerce
    .number()
    .int("Scan interval must be a whole number of minutes.")
    .min(1, "Scan interval must be at least 1 minute.")
    .max(1440, "Scan interval cannot exceed 1,440 minutes (24 hours)."),
  is_active: booleanField
});

export type TargetSourceInput = z.infer<typeof targetSourceSchema>;

export const targetSourceIdSchema = z.string().uuid("Unknown target source.");
