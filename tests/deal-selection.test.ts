import assert from "node:assert/strict";
import test from "node:test";

import { pickDealCandidates, type DealCandidateRow } from "@/lib/deals/selection";

const NOW = new Date("2026-10-28T12:00:00.000Z");

function row(overrides: Partial<DealCandidateRow> & { id: string }): DealCandidateRow {
  return {
    name: `Product ${overrides.id}`,
    price: 100_000,
    commission_rate: 5,
    affiliate_short_link: `https://s.shopee.vn/${overrides.id}`,
    last_dealt_at: null,
    deal_previewed_at: null,
    ...overrides
  };
}

const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 24 * 3_600_000).toISOString();
const hoursAgo = (hours: number) =>
  new Date(NOW.getTime() - hours * 3_600_000).toISOString();

test("highest commission first, then price, then id", () => {
  const picked = pickDealCandidates(
    [
      row({ id: "low", commission_rate: 3 }),
      row({ id: "high-cheap", commission_rate: 12, price: 50_000 }),
      row({ id: "high-rich", commission_rate: 12, price: 200_000 }),
      row({ id: "b-tie", commission_rate: 12, price: 50_000 }),
      row({ id: "a-tie", commission_rate: 12, price: 50_000 })
    ],
    { now: NOW, perDay: 5, mode: "auto" }
  );

  assert.deepEqual(
    picked.map((product) => product.id),
    ["high-rich", "a-tie", "b-tie", "high-cheap", "low"]
  );
});

test("a product dealt within the cooldown is skipped, an older one is eligible", () => {
  const picked = pickDealCandidates(
    [
      row({ id: "recent", last_dealt_at: hoursAgo(6) }),
      row({ id: "day-6", last_dealt_at: daysAgo(6) }),
      row({ id: "day-8", last_dealt_at: daysAgo(8) })
    ],
    { now: NOW, perDay: 5, mode: "auto" }
  );

  assert.deepEqual(picked.map((product) => product.id), ["day-8"]);
});

test("a product without an affiliate link is never picked", () => {
  const picked = pickDealCandidates(
    [row({ id: "no-link", affiliate_short_link: null }), row({ id: "blank", affiliate_short_link: "  " })],
    { now: NOW, perDay: 5, mode: "auto" }
  );

  assert.equal(picked.length, 0);
});

test("preview mode does not re-ask about a product previewed this morning", () => {
  const rows = [
    row({ id: "previewed-morning", deal_previewed_at: hoursAgo(8) }),
    row({ id: "previewed-yesterday", deal_previewed_at: hoursAgo(21) })
  ];

  assert.deepEqual(
    pickDealCandidates(rows, { now: NOW, perDay: 5, mode: "preview" }).map((product) => product.id),
    ["previewed-yesterday"]
  );

  // Auto mode ignores the preview marker: it exists only to protect the operator's chat.
  assert.equal(pickDealCandidates(rows, { now: NOW, perDay: 5, mode: "auto" }).length, 2);
});

test("the per-day limit caps the result, and 0 picks nothing", () => {
  const rows = [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })];

  assert.equal(pickDealCandidates(rows, { now: NOW, perDay: 2, mode: "auto" }).length, 2);
  assert.equal(pickDealCandidates(rows, { now: NOW, perDay: 0, mode: "auto" }).length, 0);
});

test("an unparseable timestamp counts as never dealt instead of hiding the product", () => {
  const picked = pickDealCandidates([row({ id: "bad-date", last_dealt_at: "not-a-date" })], {
    now: NOW,
    perDay: 1,
    mode: "auto"
  });

  assert.equal(picked.length, 1);
});
