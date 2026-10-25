/**
 * Attribution URL convention.
 *
 * The affiliate short link plus the task's Sub_ID is what the network postback
 * echoes back into affiliate_conversions.sub_id. The parameter name differs per
 * network (Shopee: `sub_id`, Lazada: `sub_id1`), so it is configurable —
 * defaults to `sub_id`.
 */
export function buildTrackedAffiliateUrl(affiliateShortLink: string, subIdCode: string | null) {
  if (!subIdCode) return affiliateShortLink;

  const param = process.env.AFFILIATE_SUB_ID_PARAM?.trim() || "sub_id";

  try {
    const url = new URL(affiliateShortLink);
    url.searchParams.set(param, subIdCode);
    return url.toString();
  } catch {
    // Short links are always http(s); if the pool holds something odd, fall back
    // to a documented append rather than dropping attribution silently.
    const separator = affiliateShortLink.includes("?") ? "&" : "?";
    return `${affiliateShortLink}${separator}${param}=${subIdCode}`;
  }
}
