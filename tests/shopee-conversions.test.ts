import assert from "node:assert/strict";
import test from "node:test";

import type { ConversionStatus } from "@/lib/constants";
import { mergeAmount, nextConversionStatus } from "@/lib/shopee/conversions";

const STATUSES: ConversionStatus[] = ["pending", "settled", "canceled"];

test("an identical status is a no-op", () => {
  for (const status of STATUSES) {
    assert.equal(nextConversionStatus(status, status), status);
  }
});

test("canceled wins from anywhere — refunds and cancellations arrive late", () => {
  assert.equal(nextConversionStatus("pending", "canceled"), "canceled");
  assert.equal(nextConversionStatus("settled", "canceled"), "canceled");
  assert.equal(nextConversionStatus("canceled", "pending"), "canceled");
  assert.equal(nextConversionStatus("canceled", "settled"), "canceled");
});

test("settled is never demoted by an out-of-order replay", () => {
  assert.equal(nextConversionStatus("settled", "pending"), "settled");
});

test("pending can move forward to settled", () => {
  assert.equal(nextConversionStatus("pending", "settled"), "settled");
});

test("amounts never decrease, and an omitted amount keeps the stored one", () => {
  assert.equal(mergeAmount(100_000, null), 100_000);
  assert.equal(mergeAmount(100_000, undefined), 100_000);
  assert.equal(mergeAmount(100_000, 0), 100_000);
  assert.equal(mergeAmount(100_000, 120_000), 120_000);
  assert.equal(mergeAmount(100_000, 90_000), 100_000);
  assert.equal(mergeAmount(null, 50_000), 50_000);
  assert.equal(mergeAmount("250.50", 100), 250.5);
});

test("a settled order keeps its money when a status-only callback replays", () => {
  // The realistic sequence: postback says settled with the commission, the pull later
  // re-reads the same order as pending with no amounts.
  let status: ConversionStatus = "pending";
  let commission = 0;

  status = nextConversionStatus(status, "settled");
  commission = mergeAmount(commission, 42_000);

  status = nextConversionStatus(status, "pending");
  commission = mergeAmount(commission, null);

  assert.equal(status, "settled");
  assert.equal(commission, 42_000);
});
