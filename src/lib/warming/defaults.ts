import type { PersonaScheduleEntry } from "@/lib/validations/account";

/**
 * The schedule a new account starts with.
 *
 * Empty was the previous default, and it failed silently: an account with
 * `warmup_enabled = true` and no entries never gets a lifestyle post or a
 * cross-warm slot, so it sits there looking warm while doing nothing. Profile
 * dressing still runs (it is not scheduled), which made the account look healthy
 * in the UI while its wall stayed empty.
 *
 * Two slots a day, at human times, is deliberately gentle — warming is protection,
 * not volume. `warmup_enabled = false` is how you turn it off, not an empty list.
 */
export const DEFAULT_PERSONA_SCHEDULE: PersonaScheduleEntry[] = [
  { at: "09:30", kind: "lifestyle_post" },
  { at: "20:00", kind: "cross_warm" }
];

export function defaultSchedule(): PersonaScheduleEntry[] {
  return DEFAULT_PERSONA_SCHEDULE.map((entry) => ({ ...entry }));
}
