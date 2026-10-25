import type { Database } from "@/lib/database.types";

/**
 * Convenience aliases over the generated schema.
 *
 * Kept out of `database.types.ts` on purpose: that file is overwritten by
 * `pnpm db:types`, so anything hand-written inside it would disappear on the next
 * regeneration.
 */

/** Row type of a database view, e.g. `Views<"v_task_roi">`. */
export type Views<Name extends keyof Database["public"]["Views"]> =
  Database["public"]["Views"][Name]["Row"];

export type ConversionStatus = Database["public"]["Enums"]["conversion_status"];
export type TaskStatus = Database["public"]["Enums"]["task_status"];
export type WarmingKind = Database["public"]["Enums"]["warming_kind"];
