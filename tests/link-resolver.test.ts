import assert from "node:assert/strict";
import test from "node:test";

import { expandAffiliateLink, platformOfLink, resolvePastedLinks } from "../src/lib/products/link-resolver.js";

type Hop = { status: number; location?: string };

/** Fetch stub: answers each URL with the queued hop and records the visited chain. */
function stubFetch(plan: Record<string, Hop[]>) {
  const visited: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    visited.push(url);
    const queue = plan[url];
    const hop = queue?.shift() ?? { status: 200 };
    const headers = new Headers();
    if (hop.location) headers.set("location", hop.location);
    return new Response("", { status: hop.status, headers });
  }) as unknown as typeof fetch;
  return { impl, visited };
}

test("a short link that redirects to a slug URL auto-fills name and item id", async () => {
  const { impl, visited } = stubFetch({
    "https://s.shopee.vn/abc123": [
      { status: 301, location: "https://shopee.vn/May-loc-khong-khi-Xiaomi-Elite-i.111.222" }
    ]
  });

  const { rows } = await resolvePastedLinks("https://s.shopee.vn/abc123", { fetchImpl: impl });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.error, null);
  assert.equal(rows[0]?.name, "May loc khong khi Xiaomi Elite");
  assert.equal(rows[0]?.itemId, "222");
  assert.equal(rows[0]?.platform, "shopee");
  assert.equal(rows[0]?.finalUrl, "https://shopee.vn/May-loc-khong-khi-Xiaomi-Elite-i.111.222");
  assert.equal(visited.length, 1);
});

test("a short link that lands on /product/<shop>/<item> fills the id but asks for a name", async () => {
  const { impl } = stubFetch({
    "https://s.shopee.vn/short": [{ status: 302, location: "https://shopee.vn/product/111/222" }]
  });

  const { rows } = await resolvePastedLinks("https://s.shopee.vn/short", { fetchImpl: impl });

  assert.equal(rows[0]?.itemId, "222");
  assert.equal(rows[0]?.name, null);
  assert.match(rows[0]?.error ?? "", /nhập tên/);
});

test("a redirect outside Shopee/Lazada is refused, not followed", async () => {
  const { impl, visited } = stubFetch({
    "https://s.shopee.vn/bad": [{ status: 302, location: "https://evil.example.com/free-iphone" }]
  });

  const { rows } = await resolvePastedLinks("https://s.shopee.vn/bad", { fetchImpl: impl });

  assert.equal(visited.length, 1);
  assert.match(rows[0]?.error ?? "", /ngoài Shopee\/Lazada/);
});

test("a redirect loop stops at the hop cap instead of spinning", async () => {
  const loop = "https://s.shopee.vn/loop";
  const { impl } = stubFetch({
    [loop]: [
      { status: 302, location: loop },
      { status: 302, location: loop },
      { status: 302, location: loop }
    ]
  });

  const result = await expandAffiliateLink(loop, { fetchImpl: impl, maxHops: 3 });
  assert.match(result.error ?? "", /quá nhiều lần/);
});

test("a transport failure becomes a per-row error, never a thrown exception", async () => {
  const impl = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;

  const { rows } = await resolvePastedLinks("https://s.shopee.vn/dead", { fetchImpl: impl });
  assert.match(rows[0]?.error ?? "", /Không mở được link/);
});

test("pipes still win over what the link says, and a Lazada link is labelled Lazada", async () => {
  const { impl } = stubFetch({
    "https://s.lazada.vn/s.abc": [
      { status: 302, location: "https://www.lazada.vn/products/noi-chien-philips-i1234567890-s9876543210.html" }
    ]
  });

  const { rows } = await resolvePastedLinks(
    "https://s.lazada.vn/s.abc | Nồi chiên nhà mình | 1.290.000 | gia_dung",
    { fetchImpl: impl }
  );

  assert.equal(rows[0]?.platform, "lazada");
  assert.equal(rows[0]?.name, "Nồi chiên nhà mình");
  assert.equal(rows[0]?.price, 1290000);
  assert.equal(rows[0]?.niche, "gia_dung");
});

test("platformOfLink separates the two marketplaces from anything else", () => {
  assert.equal(platformOfLink("https://shopee.vn/product/1/2"), "shopee");
  assert.equal(platformOfLink("https://shope.ee/x"), "shopee");
  assert.equal(platformOfLink("https://www.lazada.vn/products/x.html"), "lazada");
  assert.equal(platformOfLink("https://tiki.vn/x"), "other");
  assert.equal(platformOfLink("not a url"), "other");
});
