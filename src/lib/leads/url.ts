import {
  isLeadStatus,
  LEAD_CATEGORIES,
  type LeadCategory,
  type LeadStatus
} from "@/lib/leads/status";

/**
 * The leads list keeps all of its navigation state in the URL so filters and
 * page position survive refresh, the mobile back gesture and sharing.
 *
 * Every value is parsed against a closed set before it reaches PostgREST, and
 * every value written here is encoded by URLSearchParams, so a hand-edited URL
 * can never turn into a wildcard filter.
 */
export const LEADS_PAGE_SIZE = 20;
const LEADS_MAX_PAGE = 1000;
const LEADS_MAX_QUERY_LENGTH = 120;

export type LeadListUrlState = {
  status: LeadStatus | null;
  minScore: number | null;
  category: LeadCategory | null;
  query: string;
  page: number;
};

type RawParam = string | string[] | undefined;

function firstString(value: RawParam): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function parseLeadStatus(value: RawParam): LeadStatus | null {
  const raw = firstString(value)?.trim();
  return isLeadStatus(raw) ? raw : null;
}

/** Only whole scores from 1 to 5 are meaningful; anything else means "no floor". */
export function parseLeadMinScore(value: RawParam): number | null {
  const raw = firstString(value)?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : null;
}

export function parseLeadCategory(value: RawParam): LeadCategory | null {
  const raw = firstString(value)?.trim();
  if (!raw) return null;
  return LEAD_CATEGORIES.find((category) => category === raw) ?? null;
}

export function parseLeadPage(value: RawParam): number {
  const raw = firstString(value)?.trim();
  if (!raw) return 1;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return Math.min(parsed, LEADS_MAX_PAGE);
}

export function parseLeadListState(params: Record<string, RawParam>): LeadListUrlState {
  return {
    status: parseLeadStatus(params.status),
    // Canonical names from the Phase 1 spec; the short aliases keep old links
    // and hand-written URLs working.
    minScore: parseLeadMinScore(params.min_score ?? params.score),
    category: parseLeadCategory(params.matched_category ?? params.category),
    query: (firstString(params.q ?? params.search) ?? "")
      .trim()
      .slice(0, LEADS_MAX_QUERY_LENGTH),
    page: parseLeadPage(params.page)
  };
}

/** One builder for filters, pagination and the reset link. */
export function buildLeadsHref(state: Partial<LeadListUrlState>): string {
  const params = new URLSearchParams();

  if (isLeadStatus(state.status)) params.set("status", state.status);
  if (
    typeof state.minScore === "number" &&
    Number.isInteger(state.minScore) &&
    state.minScore >= 1 &&
    state.minScore <= 5
  ) {
    params.set("min_score", String(state.minScore));
  }
  if (state.category && LEAD_CATEGORIES.includes(state.category)) {
    params.set("matched_category", state.category);
  }

  const query = state.query?.trim().slice(0, LEADS_MAX_QUERY_LENGTH) ?? "";
  if (query) params.set("q", query);

  if (typeof state.page === "number" && Number.isInteger(state.page) && state.page > 1) {
    params.set("page", String(Math.min(state.page, LEADS_MAX_PAGE)));
  }

  const search = params.toString();
  return search ? `/leads?${search}` : "/leads";
}

export function hasLeadFilters(state: LeadListUrlState): boolean {
  return Boolean(state.status || state.minScore || state.category || state.query);
}
