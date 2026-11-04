import {
  describeShopeeLink,
  isAllowedAffiliateHost,
  parsePrice,
  type LinkParseIssue
} from "./parse-links";

/**
 * Expands affiliate short links so the create form can fill itself.
 *
 * `s.shopee.vn/abc123` and `shope.ee/xyz` carry an opaque code: no product name, no item
 * id, nothing a parser can read. The only server-side data source that works is the
 * redirect chain — Shopee's product page is a JS app behind captcha (no og:title, the
 * v4 API answers 403), so scraping the page is not an option. A real short link answers
 * 301/302 to the product URL, which usually carries the slug and always carries the item
 * id, and that is exactly what auto-fill needs.
 *
 * The expansion is deliberately paranoid: manual redirects, capped hops, a timeout per
 * hop, and every hop must stay inside the affiliate host allowlist (an affiliate code
 * that redirects to an arbitrary host is a delivery vector, not a product).
 */

export type PreviewRow = {
  line: number;
  /** What the operator pasted, after trimming the pipe parts off. */
  link: string;
  finalUrl: string | null;
  platform: "shopee" | "lazada" | "other";
  name: string | null;
  price: number | null;
  niche: string | null;
  itemId: string | null;
  /** Set when the row cannot be saved yet (no name, blocked host, dead link). */
  error: string | null;
};

export type ResolveDeps = {
  fetchImpl?: typeof fetch;
  maxHops?: number;
  timeoutMs?: number;
  maxLinks?: number;
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export function platformOfLink(link: string): "shopee" | "lazada" | "other" {
  try {
    const host = new URL(link).hostname.toLowerCase().replace(/^www\./, "");
    if (host === "lazada.vn" || host.endsWith(".lazada.vn")) return "lazada";
    if (host === "shopee.vn" || host.endsWith(".shopee.vn") || host === "shp.ee" || host === "shope.ee") {
      return "shopee";
    }
    return "other";
  } catch {
    return "other";
  }
}

/** Follows redirects for one link; returns the final URL or an error string. */
export async function expandAffiliateLink(
  link: string,
  deps: Pick<ResolveDeps, "fetchImpl" | "maxHops" | "timeoutMs"> = {}
): Promise<{ finalUrl: string | null; error: string | null }> {
  const doFetch = deps.fetchImpl ?? fetch;
  const maxHops = deps.maxHops ?? 5;
  const timeoutMs = deps.timeoutMs ?? 6000;

  let current = link;

  for (let hop = 0; hop < maxHops; hop += 1) {
    let response: Response;
    try {
      response = await doFetch(current, {
        method: "GET",
        redirect: "manual",
        headers: { "user-agent": USER_AGENT, accept: "text/html,*/*" },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      return { finalUrl: null, error: `Không mở được link (${String(error).slice(0, 80)})` };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { finalUrl: current, error: null };

      let next: string;
      try {
        next = new URL(location, current).toString();
      } catch {
        return { finalUrl: current, error: null };
      }

      let host: string;
      try {
        host = new URL(next).hostname;
      } catch {
        return { finalUrl: current, error: null };
      }

      if (!isAllowedAffiliateHost(host)) {
        return { finalUrl: current, error: `Link chuyển hướng ra ngoài Shopee/Lazada (${host})` };
      }

      current = next;

      // Once the product id is readable there is nothing left to learn: the product page
      // is a JS app behind captcha, so fetching it would cost time and return no name.
      if (describeShopeeLink(current).itemId) {
        return { finalUrl: current, error: null };
      }

      continue;
    }

    return { finalUrl: current, error: null };
  }

  return { finalUrl: current, error: "Link chuyển hướng quá nhiều lần." };
}

function splitLine(line: string): { link: string; name: string; price: string; niche: string } {
  const parts = line.split("|").map((part) => part.trim());
  return { link: parts[0] ?? "", name: parts[1] ?? "", price: parts[2] ?? "", niche: parts[3] ?? "" };
}

/**
 * Turns a paste into editable preview rows: everything derivable is filled, everything
 * else comes back as `null` (or an `error`) so the operator types one field in a table
 * instead of filling the eight-field form ten times.
 */
export async function resolvePastedLinks(
  input: string,
  deps: ResolveDeps = {}
): Promise<{ rows: PreviewRow[]; issues: LinkParseIssue[] }> {
  const maxLinks = deps.maxLinks ?? 50;
  const lines = input.split(/\r?\n/);
  const rows: PreviewRow[] = [];
  const issues: LinkParseIssue[] = [];

  const candidates: { line: number; raw: ReturnType<typeof splitLine> }[] = [];

  lines.forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) return;

    const parts = splitLine(trimmed);
    if (!/^https?:\/\//i.test(parts.link)) {
      issues.push({ line, error: "Dòng này không phải link http(s)." });
      return;
    }

    if (candidates.length >= maxLinks) return;
    candidates.push({ line, raw: parts });
  });

  if (lines.filter((line) => line.trim().length > 0).length > maxLinks) {
    issues.push({ line: maxLinks + 1, error: `Chỉ kiểm tra tối đa ${maxLinks} link mỗi lần.` });
  }

  // Redirects are I/O: run them together, each hop already has its own timeout.
  const expanded = await Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      result: await expandAffiliateLink(candidate.raw.link, deps)
    }))
  );

  for (const { candidate, result } of expanded) {
    const { line, raw } = candidate;
    const finalUrl = result.finalUrl ?? raw.link;
    const derived = describeShopeeLink(finalUrl);
    const platform = platformOfLink(finalUrl);

    const name = raw.name || derived.name;
    const price = raw.price ? parsePrice(raw.price) : null;
    const niche = raw.niche || null;

    let error = result.error;

    // Shopee answers a dead or expired affiliate code with 301 -> shope.ee/error_page.
    // Saying "không đọc được tên" there sends the operator hunting for a product name
    // when the link itself is unusable.
    if (!error && /(^|\/)error_page(\/|$)/i.test(new URL(finalUrl).pathname)) {
      error = "Link rút gọn đã hết hạn hoặc không còn hiệu lực (Shopee trả error_page).";
    }

    if (!error && platform === "other") {
      error = "Link không thuộc Shopee/Lazada.";
    }
    if (!error && !name) {
      error = "Không đọc được tên từ link — nhập tên ở cột bên cạnh.";
    }
    if (!error && raw.price && price === null) {
      error = `Giá "${raw.price}" không đọc được.`;
    }

    rows.push({
      line,
      link: raw.link,
      finalUrl: result.finalUrl,
      platform,
      name,
      price,
      niche,
      itemId: derived.itemId,
      error
    });
  }

  return { rows, issues };
}
