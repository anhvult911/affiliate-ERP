import assert from "node:assert/strict";
import test from "node:test";

import {
  generateShortLink,
  isUsableShortLink,
  originUrlFor,
  preferShortLink
} from "@/lib/shopee/short-link";
import type { ShopeeClient } from "@/lib/shopee/client";

test("the plain product link is preferred as originUrl", () => {
  assert.equal(
    originUrlFor({
      origin_link: "https://shopee.vn/p-i.1.2",
      affiliate_short_link: "https://s.shopee.vn/abc"
    }),
    "https://shopee.vn/p-i.1.2"
  );
});

test("a CSV row falls back to its affiliate link", () => {
  assert.equal(
    originUrlFor({ affiliate_short_link: "https://s.shopee.vn/abc" }),
    "https://s.shopee.vn/abc"
  );
});

test("an existing Sub_ID is stripped, so a previous task is not re-tracked", () => {
  assert.equal(
    originUrlFor({ affiliate_short_link: "https://s.shopee.vn/abc?sub_id=T-OLD123" }),
    "https://s.shopee.vn/abc"
  );
});

test("no link at all is null, not an empty string", () => {
  assert.equal(originUrlFor({}), null);
  assert.equal(originUrlFor({ affiliate_short_link: "  " }), null);
});

test("only http(s) strings count as a short link", () => {
  assert.equal(isUsableShortLink("https://shope.ee/5XyZ7WqR"), true);
  assert.equal(isUsableShortLink("http://shope.ee/x"), true);
  assert.equal(isUsableShortLink(""), false);
  assert.equal(isUsableShortLink(null), false);
  assert.equal(isUsableShortLink("javascript:alert(1)"), false);
  assert.equal(isUsableShortLink("not a url"), false);
});

test("the API link replaces the query-string link only when it is usable", () => {
  const tracked = "https://s.shopee.vn/abc?sub_id=T-ABC123";

  assert.equal(preferShortLink(tracked, "https://shope.ee/xyz"), "https://shope.ee/xyz");
  assert.equal(preferShortLink(tracked, null), tracked);
  assert.equal(preferShortLink(tracked, "  "), tracked);
  assert.equal(preferShortLink(tracked, "garbage"), tracked);
});

test("the mutation carries exactly the task's Sub_ID", async () => {
  const calls: { query: string; variables?: Record<string, unknown> }[] = [];
  const client = {
    query: async (query: string, variables?: Record<string, unknown>) => {
      calls.push({ query, variables });
      return { generateShortLink: { shortLink: "https://shope.ee/abc" } };
    }
  } as unknown as ShopeeClient;

  const link = await generateShortLink(client, {
    originUrl: "https://shopee.vn/p-i.1.2",
    subId: "T-ABC123"
  });

  assert.equal(link, "https://shope.ee/abc");
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.query, /generateShortLink/);
  assert.deepEqual(calls[0]!.variables, {
    originUrl: "https://shopee.vn/p-i.1.2",
    subIds: ["T-ABC123"]
  });
});

test("a rejected mutation returns null instead of breaking the claim", async () => {
  const client = {
    query: async () => {
      throw new Error("Shopee rate limit reached (10030)");
    }
  } as unknown as ShopeeClient;

  assert.equal(
    await generateShortLink(client, { originUrl: "https://shopee.vn/p-i.1.2", subId: "T-1" }),
    null
  );
});

test("a malformed response is ignored", async () => {
  const client = {
    query: async () => ({ generateShortLink: { shortLink: 42 } })
  } as unknown as ShopeeClient;

  assert.equal(
    await generateShortLink(client, { originUrl: "https://shopee.vn/p-i.1.2", subId: "T-1" }),
    null
  );
});

test("an empty origin or Sub_ID never reaches the API", async () => {
  let called = false;
  const client = {
    query: async () => {
      called = true;
      return { generateShortLink: { shortLink: "https://shope.ee/x" } };
    }
  } as unknown as ShopeeClient;

  assert.equal(await generateShortLink(client, { originUrl: "", subId: "T-1" }), null);
  assert.equal(await generateShortLink(client, { originUrl: "https://shopee.vn/p-i.1.2", subId: "" }), null);
  assert.equal(called, false);
});
