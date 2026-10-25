import type { SourceType, TaskStatus } from "@/lib/constants";
import type { Json, Tables } from "@/lib/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { isSourceDue } from "@/components/radar/utils";

/**
 * Query layer for module 3 (radar watchlist). Every function is a plain
 * server-side read: RLS runs as the signed-in operator and errors are thrown
 * so the nearest error boundary can surface them (mutations never throw).
 */

export type SourceListItem = Tables<"target_sources"> & {
  /**
   * `comment_tasks(count)` embeds arrive as `[{ count: number }]`, not as a
   * scalar — normalised here so callers never touch the embed shape.
   */
  captureCount: number;
};

export type SourceOption = Pick<Tables<"target_sources">, "id" | "name" | "source_type">;

export type SourceStats = {
  active: number;
  paused: number;
  due: number;
  /** Posts captured across every source in the trailing 24 hours. */
  capturesLast24h: number;
};

export type SourceCapture = {
  id: string;
  post_url: string;
  post_content: string | null;
  post_images: Json;
  match_score: number | null;
  status: TaskStatus;
  created_at: string;
  product: { id: string; name: string } | null;
};

export type RadarActivityItem = {
  id: string;
  post_url: string;
  post_content: string | null;
  match_score: number | null;
  status: TaskStatus;
  created_at: string;
  source: { id: string; name: string; source_type: SourceType } | null;
};

export type ListSourcesFilters = {
  sourceType?: SourceType;
  activeOnly?: boolean;
  /** Substring match over name and url. */
  query?: string;
};

/** Route params are user input; a malformed uuid must 404, not hit PostgREST. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Escapes PostgREST `or`/`ilike` metacharacters so a search term cannot break the filter. */
function escapeLikeTerm(term: string) {
  return term.replace(/[\\%_]/g, (match) => `\\${match}`).replace(/[,()]/g, " ");
}

export async function listSources(filters: ListSourcesFilters = {}): Promise<SourceListItem[]> {
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("target_sources")
    .select("*, comment_tasks(count)")
    .order("name", { ascending: true });

  if (filters.sourceType) query = query.eq("source_type", filters.sourceType);
  if (filters.activeOnly) query = query.eq("is_active", true);

  const term = filters.query?.trim().slice(0, 120);
  if (term) {
    const pattern = escapeLikeTerm(term);
    query = query.or(`name.ilike.%${pattern}%,url.ilike.%${pattern}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as (Tables<"target_sources"> & {
    comment_tasks: { count: number }[];
  })[];

  return rows.map(({ comment_tasks, ...source }) => ({
    ...source,
    captureCount: comment_tasks[0]?.count ?? 0
  }));
}

export async function getSource(id: string): Promise<Tables<"target_sources"> | null> {
  if (!UUID_PATTERN.test(id)) return null;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("target_sources")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

/**
 * "Due for scan" is computed in JS: the active set is small (dozens of rows),
 * and Postgres has no portable interval-per-row expression through PostgREST.
 */
export async function getSourceStats(): Promise<SourceStats> {
  const supabase = await createSupabaseServerClient();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [activeResult, pausedResult, activeRowsResult, capturesResult] = await Promise.all([
    supabase
      .from("target_sources")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true),
    supabase
      .from("target_sources")
      .select("*", { count: "exact", head: true })
      .eq("is_active", false),
    supabase
      .from("target_sources")
      .select("is_active, last_scanned_at, scan_interval_mins")
      .eq("is_active", true),
    supabase
      .from("comment_tasks")
      .select("*", { count: "exact", head: true })
      .gte("created_at", dayAgo)
  ]);

  const error =
    activeResult.error ?? pausedResult.error ?? activeRowsResult.error ?? capturesResult.error;
  if (error) throw new Error(error.message);

  const activeRows = activeRowsResult.data ?? [];
  const now = Date.now();

  return {
    active: activeResult.count ?? 0,
    paused: pausedResult.count ?? 0,
    due: activeRows.filter((source) => isSourceDue(source, now)).length,
    capturesLast24h: capturesResult.count ?? 0
  };
}

export async function listSourceOptions(): Promise<SourceOption[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("target_sources")
    .select("id, name, source_type")
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as SourceOption[];
}

export async function listSourceCaptures(
  sourceId: string,
  limit = 20
): Promise<SourceCapture[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("comment_tasks")
    .select(
      "id, post_url, post_content, post_images, match_score, status, created_at, " +
        "product:products!comment_tasks_matched_product_id_fkey(id, name)"
    )
    .eq("source_id", sourceId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as SourceCapture[];
}

export async function getRadarActivity(limit = 8): Promise<RadarActivityItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("comment_tasks")
    .select(
      "id, post_url, post_content, match_score, status, created_at, " +
        "source:target_sources!comment_tasks_source_id_fkey(id, name, source_type)"
    )
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 50));

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as RadarActivityItem[];
}
