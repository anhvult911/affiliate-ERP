import type { ShopeeClient } from "@/lib/shopee/client";

/**
 * Per-task short link via `generateShortLink` (P5-4, docs/SHOPEE_API.md §4.2).
 *
 * Why this exists: the Sub_ID is attached differently depending on where the link came
 * from. A CSV/Lazada link gets `?sub_id=<code>` appended (`buildTrackedAffiliateUrl`), and
 * docs §4.2 says that mechanism is **not verified** for a link Shopee's API produced. The
 * supported path for API links is to pass `subIds: [<code>]` to the mutation and let Shopee
 * mint the tracked link.
 *
 * Everything here is best-effort: the claim must keep working with no credential, a rate
 * limit, or a malformed response, and the existing query-string link stays in place then.
 */

export const SHORT_LINK_MUTATION = `mutation ShortLink($originUrl: String!, $subIds: [String!]!) {
  generateShortLink(input: { originUrl: $originUrl, subIds: $subIds }) {
    shortLink
  }
}`;

/** The link the mutation expects: the plain product URL, never a tracked one. */
export function originUrlFor(product: {
  origin_link?: string | null;
  affiliate_short_link?: string | null;
}): string | null {
  const origin = product.origin_link?.trim() ?? "";
  if (origin) return origin;

  const affiliate = product.affiliate_short_link?.trim() ?? "";
  if (!affiliate) return null;

  // A CSV row has no origin_link. Use the affiliate link only if it is not already
  // carrying a Sub_ID — otherwise the mutation would track the previous task's code.
  try {
    const url = new URL(affiliate);
    const param = process.env.AFFILIATE_SUB_ID_PARAM?.trim() || "sub_id";
    const existing = url.searchParams.get(param) ?? url.searchParams.get("sub_id");
    if (existing) {
      url.searchParams.delete(param);
      url.searchParams.delete("sub_id");
      return url.toString();
    }
    return affiliate;
  } catch {
    return null;
  }
}

/** Telegram/Shopee can return anything; only an http(s) URL is usable on a page. */
export function isUsableShortLink(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;

  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Calls the mutation and returns the short link, or null on any failure.
 *
 * `subIds` takes at most five entries and the worker only ever needs one, so the whole
 * attribution is the single Sub_ID of this task.
 */
export async function generateShortLink(
  client: ShopeeClient,
  input: { originUrl: string; subId: string }
): Promise<string | null> {
  const originUrl = input.originUrl.trim();
  const subId = input.subId.trim();
  if (!originUrl || !subId) return null;

  try {
    const data = await client.query<{ generateShortLink?: { shortLink?: unknown } }>(
      SHORT_LINK_MUTATION,
      { originUrl, subIds: [subId] }
    );

    const shortLink = data.generateShortLink?.shortLink;
    return isUsableShortLink(shortLink) ? shortLink.trim() : null;
  } catch (error) {
    console.warn(
      "[shopee] generateShortLink failed, keeping the query-string link:",
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

/** Applies the API link when it exists, otherwise leaves the tracked URL untouched. */
export function preferShortLink(trackedUrl: string, shortLink: string | null): string {
  return isUsableShortLink(shortLink) ? shortLink.trim() : trackedUrl;
}
