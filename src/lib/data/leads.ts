import type { Tables } from "@/lib/database.types";
import type { Views } from "@/lib/db-types";
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
export type LeadMilestone = Tables<"lead_milestones">;
export type LeadReceipt = Tables<"lead_receipts">;
export type LeadRecurringTerm = Tables<"lead_recurring_terms">;

/** A page of leads plus the explicit sales facts attached to those leads. */
export type LeadWithSales = Lead & {
  milestones: LeadMilestone[];
  receipts: LeadReceipt[];
  recurringTerm: LeadRecurringTerm | null;
};

export type LeadGroupFunnelRow = Views<"v_lead_group_funnel_14d">;

export type LeadListFilters = {
  status?: LeadStatus | null;
  minScore?: number | null;
  category?: LeadCategory | null;
  query?: string;
  page?: number;
  pageSize?: number;
};

export type LeadListResult = {
  rows: LeadWithSales[];
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
  const rows = (data ?? []) as Lead[];
  const enriched = await attachSalesFacts(rows);

  return {
    rows: enriched,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    pageSize
  };
}

/**
 * Three bounded, owner-scoped queries for the current page instead of an N+1
 * lookup per card. Rows are grouped in memory; a lead with no milestone/receipt
 * stays explicitly empty (missing, not inferred).
 */
async function attachSalesFacts(leads: Lead[]): Promise<LeadWithSales[]> {
  if (leads.length === 0) return [];

  const supabase = await createSupabaseServerClient();
  const ids = leads.map((lead) => lead.id);

  const [milestones, receipts, terms] = await Promise.all([
    supabase
      .from("lead_milestones")
      .select("*")
      .in("lead_id", ids)
      .eq("user_id", LEAD_OWNER_ID)
      .order("occurred_at", { ascending: true }),
    supabase
      .from("lead_receipts")
      .select("*")
      .in("lead_id", ids)
      .eq("user_id", LEAD_OWNER_ID)
      .order("paid_at", { ascending: false }),
    supabase
      .from("lead_recurring_terms")
      .select("*")
      .in("lead_id", ids)
      .eq("user_id", LEAD_OWNER_ID)
      .is("ended_on", null)
  ]);

  if (milestones.error) throw new Error(milestones.error.message);
  if (receipts.error) throw new Error(receipts.error.message);
  if (terms.error) throw new Error(terms.error.message);

  const byLead = new Map<string, LeadWithSales>(
    leads.map(
      (lead) =>
        [lead.id, { ...lead, milestones: [], receipts: [], recurringTerm: null }] as const
    )
  );

  for (const milestone of (milestones.data ?? []) as LeadMilestone[]) {
    byLead.get(milestone.lead_id)?.milestones.push(milestone);
  }
  for (const receipt of (receipts.data ?? []) as LeadReceipt[]) {
    byLead.get(receipt.lead_id)?.receipts.push(receipt);
  }
  for (const term of (terms.data ?? []) as LeadRecurringTerm[]) {
    const lead = byLead.get(term.lead_id);
    if (lead) lead.recurringTerm = term;
  }

  return leads.map(
    (lead) =>
      byLead.get(lead.id) ?? { ...lead, milestones: [], receipts: [], recurringTerm: null }
  );
}

/**
 * Per-group 14-day funnel. All aggregation happens in the view so the report
 * cannot accidentally double-count a lead across a page boundary or a repeat
 * receipt. RLS keeps the result owner-scoped even if the view is queried alone.
 */
export async function listLeadGroupFunnel(): Promise<LeadGroupFunnelRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("v_lead_group_funnel_14d")
    .select("*")
    .order("cash_total_vnd", { ascending: false })
    .order("qualified_leads", { ascending: false })
    .order("group_name", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as LeadGroupFunnelRow[];
}
