import type { Json } from "@/lib/database.types";

/**
 * `jsonb` columns come back untyped from PostgREST. The database enforces
 * `jsonb_typeof(...) = 'array'`, but individual entries are only guaranteed by
 * the writers, so narrow before use.
 */
export function asStringArray(value: Json | null | undefined): string[] {
  if (!Array.isArray(value)) return [];

  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

export type ScheduleEntry = { at: string; kind: string };

/** persona_schedule: [{"at":"09:30","kind":"lifestyle_post"}, ...] */
export function asSchedule(value: Json | null | undefined): ScheduleEntry[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const at = entry.at;
    const kind = entry.kind;
    if (typeof at !== "string" || typeof kind !== "string") return [];
    return [{ at, kind }];
  });
}
