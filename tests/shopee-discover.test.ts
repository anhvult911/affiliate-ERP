import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ADVISORIES,
  mergeDiscoveries,
  passesAdvisories,
  selectDiscoveries,
  toProductRow,
  type AvailableOffer
} from "../src/lib/shopee/discover.js";

function offer(partial: Partial<AvailableOffer>): AvailableOffer {
  return {
    shopee_item_id: "1001",
    name: "Khăn ướt em bé",
    affiliate_short_link: "https://s.shopee.vn/abc123",
    price: 250_000,
    commission_rate: 6,
    sales: 500,
    rating_star: 4.8,
    ...partial
  };
}

test("a healthy offer passes the advisories", () => {
  assert.equal(passesAdvisories(offer({})), true);
});

test("a 1% commission offer is rejected — it cannot fund a channel", () => {
  assert.equal(passesAdvisories(offer({ commission_rate: 1.65 })), false);
});

test("unknown rating or sales is treated as unknown, not as good", () => {
  assert.equal(passesAdvisories(offer({ rating_star: null })), false);
  assert.equal(passesAdvisories(offer({ sales: null })), false);
});

test("an offer without an affiliate link is unusable — the column is NOT NULL", () => {
  assert.equal(passesAdvisories(offer({ affiliate_short_link: "" })), false);
  assert.equal(passesAdvisories(offer({ affiliate_short_link: "javascript:alert(1)" })), false);
});

test("price outside the 100k-800k band is rejected", () => {
  assert.equal(passesAdvisories(offer({ price: 49_000 })), false);
  assert.equal(passesAdvisories(offer({ price: 1_200_000 })), false);
  assert.equal(passesAdvisories(offer({ price: 800_000 })), true);
});

test("selection sorts by commission then sales and cuts at the limit", () => {
  const pool = [
    offer({ shopee_item_id: "a", commission_rate: 5, sales: 900 }),
    offer({ shopee_item_id: "b", commission_rate: 9, sales: 200 }),
    offer({ shopee_item_id: "c", commission_rate: 7, sales: 1200 })
  ];

  const picked = selectDiscoveries(pool, DEFAULT_ADVISORIES, 2);
  assert.deepEqual(picked.map((p) => p.shopee_item_id), ["b", "c"]);
});

test("the same item under two keywords appears once", () => {
  const merged = mergeDiscoveries([
    [offer({ shopee_item_id: "x" })],
    [offer({ shopee_item_id: "x" }), offer({ shopee_item_id: "y" })]
  ]);
  assert.deepEqual(merged.map((m) => m.shopee_item_id), ["x", "y"]);
});

test("the product row carries the niche, which is what makes it retrievable", () => {
  const row = toProductRow(offer({ shopee_item_id: "42" }), "me_bim");
  assert.equal(row.niche, "me_bim");
  assert.equal(row.shopee_item_id, "42");
  assert.equal(row.is_active, true);
});
