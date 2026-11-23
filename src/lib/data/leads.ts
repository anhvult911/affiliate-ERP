import type { Tables } from "@/lib/database.types";
import { LEAD_OWNER_ID } from "@/lib/leads/config";
import type { LeadCategory, LeadStatus } from "@/lib/leads/status";
import { LEADS_PAGE_SIZE } from "@/lib/leads/url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Read layer for the mini lead CRM. Every statement runs through the
 * RLS-scoped server client as the signed-in operator AND filters by the Phase 1
 * owner, so the same code keeps working when Phase 2 adds real tenants.
 */
export type Lead = Tables<"leads">;

export type LeadListFilters = {
  status?: LeadStatus | null;
  minScore?: number | null;
  category?: LeadCategory | null;
  query?: string;
  page?: number;
  pageSize?: number;
};

export type LeadListResult = {
  rows: Lead[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
};

/** Escapes PostgREST `or`/`ilike` metacharacters so a search term stays one literal token. */
function escapeSearchToken(term: string) {
  // Level 1: Postgres LIKE — the token must match literally.
  const likeEscaped = term.replace(/[\\%_]/g, (match) => `\\${match}`);
  // Level 2: PostgREST `or=()` grammar — quote so commas, parentheses and
  // quotes cannot split the filter; backslashes are doubled for the parser.
  const grammared = `%${likeEscaped}%`.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${grammared}"`;
}

export async function listLeads(filters: LeadListFilters = {}): Promise<LeadListResult> {
  const supabase = await createSupabaseServerClient();
  const pageSize = Math.min(Math.max(filters.pageSize ?? LEADS_PAGE_SIZE, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const from = (page - 1) * pageSize;

  let query = supabase
    .from("leads")
    .select("*", { count: "exact" })
    .eq("user_id", LEAD_OWNER_ID);

  if (filters.status) query = query.eq("status", filters.status);
  if (typeof filters.minScore === "number") query = query.gte("score", filters.minScore);
  if (filters.category) query = query.eq("matched_category", filters.category);

  const term = filters.query?.trim().slice(0, 120);
  if (term) {
    const pattern = escapeSearchToken(term);
    query = query.or(
      [
        `group_name.ilike.${pattern}`,
        `author_name.ilike.${pattern}`,
        `post_content.ilike.${pattern}`,
        `summary.ilike.${pattern}`,
        `notes.ilike.${pattern}`
      ].join(",")
    );
  }

  // Hottest first, then newest. `id` is the final tie-breaker so two rows with
  // the same score and timestamp never swap between page loads.
  const { data, error, count } = await query
    .order("score", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + pageSize - 1);

  if (error) throw new Error(error.message);

  const total = count ?? 0;
  return {
    rows: (data ?? []) as Lead[],
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    pageSize
  };
}
