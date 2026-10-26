import {
  ShopeeAccessError,
  ShopeeAuthError,
  ShopeeClient,
  ShopeeError,
  ShopeeRateLimitError,
  type ShopeeTransport,
  type ShopeeTransportResponse
} from "@/lib/shopee/client";

/**
 * The smoke probe from docs/SHOPEE_API.md §6 (T-SHOPEE-03).
 *
 * Its job is to answer one question against the *real* API: does the signing recipe
 * in §3 work for this publisher, and are the operations we depend on (`productOfferV2`
 * today, reports later) actually available. Everything that decides pass/fail lives
 * here so it can be tested without credentials; `scripts/shopee-probe.ts` is only the
 * terminal wrapper.
 */

export type ProbeOutcome =
  | { ok: true; status: number; sample: unknown }
  | { ok: false; status: number | null; code: number | null; message: string; guidance: string };

const GUIDANCE: Record<number, string> = {
  10020:
    "Signature or timestamp rejected. Check the server clock (NTP) and SHOPEE_AFFILIATE_APP_SECRET. " +
    "If both are right, docs §3 says to try the HMAC-SHA256 variant.",
  10030: "Rate limit. Wait and retry; keep one request per second.",
  10035:
    "This publisher does not have Open API access yet. Request it from the affiliate dashboard " +
    "(Open API section) and retry once support confirms.",
  10010: "The query was rejected as invalid. The deployed schema may differ — reduce the selection set and retry."
};

export function guidanceFor(code: number | null): string {
  if (code === null) return "See docs/SHOPEE_API.md §3 for the error table.";
  return GUIDANCE[code] ?? "Unexpected error — capture the response and compare with the error table.";
}

/** 2 = not configured, 3 = auth/access, 4 = rate limit, 1 = anything else. */
export function probeExitCode(outcome: ProbeOutcome | { configured: false }): number {
  if ("configured" in outcome) return 2;
  if (outcome.ok) return 0;
  if (outcome.code === 10020 || outcome.code === 10035) return 3;
  if (outcome.code === 10030) return 4;
  return 1;
}

/** Wraps a transport so the probe can report the HTTP status even when the client throws. */
export function captureTransport(inner: ShopeeTransport): {
  transport: ShopeeTransport;
  lastStatus: () => number | null;
} {
  let status: number | null = null;
  return {
    transport: async (request) => {
      const response: ShopeeTransportResponse = await inner(request);
      status = response.status;
      return response;
    },
    lastStatus: () => status
  };
}

const PROBE_QUERY = `query ProbeProductOffers {
  productOfferV2(listType: 0, page: 1, limit: 1) {
    nodes { itemId productName commissionRate offerLink }
    pageInfo { page limit hasNextPage }
  }
}`;

export async function runProductOfferProbe(client: ShopeeClient): Promise<ProbeOutcome> {
  try {
    const data = await client.query<{ productOfferV2?: { nodes?: unknown[] } }>(PROBE_QUERY);
    const nodes = data.productOfferV2?.nodes ?? [];

    return { ok: true, status: 200, sample: { nodeCount: nodes.length, first: nodes[0] ?? null } };
  } catch (error) {
    const code = error instanceof ShopeeError ? error.code : null;
    const kind =
      error instanceof ShopeeAuthError
        ? "auth"
        : error instanceof ShopeeAccessError
          ? "access"
          : error instanceof ShopeeRateLimitError
            ? "rate-limit"
            : "error";

    return {
      ok: false,
      status: null,
      code,
      message: `${kind}: ${error instanceof Error ? error.message : String(error)}`,
      guidance: guidanceFor(code)
    };
  }
}
