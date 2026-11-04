export type AffiliatePlatform = "shopee" | "lazada" | "other";

function normalizeHost(input: string): string {
  try {
    return new URL(input).hostname.toLowerCase();
  } catch {
    return input.toLowerCase();
  }
}

function hostMatches(host: string, allowed: string): boolean {
  return host === allowed || host.endsWith(`.${allowed}`);
}

/**
 * Detects the e-commerce platform of an affiliate link from its hostname.
 *
 * - `shopee.vn`, `s.shopee.vn`, `shp.ee`, `shope.ee` and their subdomains → `shopee`
 * - `lazada.vn`, `s.lazada.vn` and their subdomains → `lazada`
 * - everything else → `other`
 *
 * Accepts either a full URL or a bare hostname. `www.` is ignored and matching is
 * case-insensitive.
 */
export function platformOf(link: string): AffiliatePlatform {
  const host = normalizeHost(link).replace(/^www\./, "");

  if (
    hostMatches(host, "shopee.vn") ||
    hostMatches(host, "s.shopee.vn") ||
    hostMatches(host, "shp.ee") ||
    hostMatches(host, "shope.ee")
  ) {
    return "shopee";
  }

  if (hostMatches(host, "lazada.vn") || hostMatches(host, "s.lazada.vn")) {
    return "lazada";
  }

  return "other";
}
