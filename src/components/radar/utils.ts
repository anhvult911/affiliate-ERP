import type { Json, Tables } from "@/lib/database.types";

type ScanState = Pick<
  Tables<"target_sources">,
  "is_active" | "last_scanned_at" | "scan_interval_mins"
>;

/**
 * Source is due when it is active and never scanned, or its last scan is older
 * than its own cadence. Kept dependency-free so both the server query layer and
 * the client cards use one definition.
 */
export function isSourceDue(source: ScanState, now = Date.now()): boolean {
  if (!source.is_active) return false;
  if (!source.last_scanned_at) return true;
  return now - new Date(source.last_scanned_at).getTime() > source.scan_interval_mins * 60_000;
}

/** `post_images` is a jsonb array of absolute URLs; anything else is ignored. */
export function parsePostImages(value: Json): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && /^https?:\/\//.test(item)
  );
}
