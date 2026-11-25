import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  EMPTY_ORDER_INPUT,
  calculateOrder,
  type ShopProfitOrderInput
} from "@/lib/shop-profit/calc";
import {
  appendShopProfitConsent,
  hasShopProfitConsent,
  hasShopProfitTemplateReceipt,
  SHOP_PROFIT_CONSENT_MARKER
} from "@/lib/shop-profit/fulfillment";
import { buildFreeWorkbook } from "@/lib/shop-profit/free-workbook";

function close(actual: number, expected: number, message?: string) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    message ?? `expected ${actual} to be close to ${expected}`
  );
}

function order(overrides: Partial<ShopProfitOrderInput>): ShopProfitOrderInput {
  return { ...EMPTY_ORDER_INPUT, ...overrides };
}

test("no fees: gross, payout, cogs and profit follow the documented formula", () => {
  const result = calculateOrder(
    order({
      quantity: 2,
      unitPrice: 100_000,
      unitCost: 50_000,
      buyerShipping: 20_000,
      sellerShipping: 15_000,
      packagingCost: 5_000
    })
  );

  assert.equal(result.grossRevenue, 220_000);
  assert.equal(result.netRevenue, 220_000);
  assert.equal(result.feeBase, 220_000);
  assert.equal(result.platformFee, 0);
  assert.equal(result.paymentFee, 0);
  assert.equal(result.expectedPayout, 205_000);
  assert.equal(result.cogs, 100_000);
  assert.equal(result.totalCosts, 105_000);
  assert.equal(result.profit, 100_000);
  close(result.marginPct, (100_000 / 220_000) * 100);
  close(result.roiPct, (100_000 / 105_000) * 100);
});

test("fixed + percentage fees and affiliate commission are deducted once", () => {
  const result = calculateOrder(
    order({
      quantity: 1,
      unitPrice: 300_000,
      unitCost: 120_000,
      sellerShipping: 30_000,
      shopDiscount: 20_000,
      platformFeeRatePct: 5,
      platformFixedFee: 3_000,
      paymentFeeRatePct: 2,
      paymentFixedFee: 1_000,
      affiliateRatePct: 4,
      packagingCost: 5_000,
      adCost: 25_000
    })
  );

  assert.equal(result.grossRevenue, 300_000);
  assert.equal(result.netRevenue, 280_000);
  assert.equal(result.feeBase, 280_000);
  assert.equal(result.platformFee, 17_000);
  assert.equal(result.paymentFee, 6_600);
  assert.equal(result.affiliateCommission, 11_200);
  assert.equal(result.expectedPayout, 215_200);
  assert.equal(result.cogs, 120_000);
  assert.equal(result.totalCosts, 150_000);
  assert.equal(result.profit, 65_200);
  close(result.marginPct, (65_200 / 300_000) * 100);
});

test("partial return: refund, return shipping and refunded fees are respected", () => {
  const result = calculateOrder(
    order({
      quantity: 3,
      unitPrice: 200_000,
      unitCost: 80_000,
      sellerShipping: 40_000,
      shopDiscount: 30_000,
      platformFeeRatePct: 6,
      platformFixedFee: 2_000,
      paymentFeeRatePct: 2.5,
      returnedQuantity: 1,
      refundAmount: 200_000,
      returnShipping: 20_000,
      platformFeeRefund: 5_000,
      damagedReturnCost: 30_000,
      packagingCost: 9_000,
      adCost: 30_000,
      otherCost: 10_000
    })
  );

  assert.equal(result.grossRevenue, 600_000);
  assert.equal(result.netRevenue, 370_000);
  assert.equal(result.feeBase, 370_000);
  assert.equal(result.platformFee, 19_200);
  assert.equal(result.paymentFee, 9_250);
  assert.equal(result.expectedPayout, 281_550);
  assert.equal(result.remainingQuantity, 2);
  assert.equal(result.cogs, 190_000);
  assert.equal(result.totalCosts, 239_000);
  assert.equal(result.profit, 42_550);
});

test("full return: revenue is zero, return costs and damaged stock produce a loss", () => {
  const result = calculateOrder(
    order({
      quantity: 1,
      unitPrice: 150_000,
      unitCost: 60_000,
      sellerShipping: 20_000,
      returnedQuantity: 1,
      refundAmount: 150_000,
      returnShipping: 20_000,
      damagedReturnCost: 60_000,
      packagingCost: 2_000,
      adCost: 5_000
    })
  );

  assert.equal(result.grossRevenue, 150_000);
  assert.equal(result.netRevenue, 0);
  assert.equal(result.feeBase, 0);
  assert.equal(result.platformFee, 0);
  assert.equal(result.expectedPayout, -40_000);
  assert.equal(result.remainingQuantity, 0);
  assert.equal(result.cogs, 60_000);
  assert.equal(result.totalCosts, 67_000);
  assert.equal(result.profit, -107_000);
});

test("inputs are clamped and the product has no built-in fee rate", () => {
  const result = calculateOrder(
    order({
      quantity: 2.9,
      unitPrice: -100,
      unitCost: 50_000,
      platformFeeRatePct: -5,
      paymentFeeRatePct: -2,
      affiliateRatePct: -1,
      returnedQuantity: 99
    })
  );

  assert.equal(result.remainingQuantity, 0);
  assert.equal(result.platformFee, 0);
  assert.equal(result.paymentFee, 0);
  assert.equal(result.affiliateCommission, 0);

  for (const key of [
    "platformFeeRatePct",
    "platformFixedFee",
    "paymentFeeRatePct",
    "paymentFixedFee",
    "affiliateRatePct"
  ] as const) {
    assert.equal(EMPTY_ORDER_INPUT[key], 0, `${key} must not have a guessed default`);
  }
});

test("free workbook is a valid xlsx zip with only the free sheets", () => {
  const workbook = buildFreeWorkbook();
  assert.equal(workbook.subarray(0, 4).toString("hex"), "504b0304");

  const text = workbook.toString("utf8");
  assert.match(text, /name="Hướng dẫn"/);
  assert.match(text, /name="Tính lãi 1 đơn"/);
  assert.doesNotMatch(text, /name="Nhập đơn"/);
  assert.doesNotMatch(text, /name="Đối soát"/);
  assert.doesNotMatch(text, /name="Tổng hợp"/);
  assert.doesNotMatch(text, /name="Mẫu"/);
  assert.match(text, /B7\*B6\+B9/);
  assert.match(text, /249\.000/);
  assert.match(text, /Không có tỷ lệ phí nào/);
});

test("public/ carries no spreadsheet artefact", () => {
  const publicDir = path.resolve(process.cwd(), "public");
  const spreadsheets = readdirSync(publicDir, { recursive: true })
    .map((entry) => String(entry))
    .filter((entry) => /\.(xlsx|xls)$/i.test(entry));

  assert.deepEqual(spreadsheets, []);
});

test("payment gate requires a positive template receipt, not a lead status", () => {
  assert.equal(hasShopProfitTemplateReceipt([]), false);
  assert.equal(hasShopProfitTemplateReceipt([{ kind: "setup", amount_vnd: 249_000 }]), false);
  assert.equal(hasShopProfitTemplateReceipt([{ kind: "template", amount_vnd: 0 }]), false);
  assert.equal(
    hasShopProfitTemplateReceipt([{ kind: "template", amount_vnd: 249_000 }]),
    true
  );
});

test("consent marker is recorded once and survives the 4.000-character note cap", () => {
  const first = appendShopProfitConsent("Khách đã nhắn đồng ý.", new Date("2026-11-23T10:00:00Z"));
  assert.ok(hasShopProfitConsent(first));
  assert.match(first, new RegExp(SHOP_PROFIT_CONSENT_MARKER.replace(/[[\]]/g, "\\$&")));

  const second = appendShopProfitConsent(first, new Date("2026-11-23T11:00:00Z"));
  assert.equal(second, first);

  const longExisting = "x".repeat(4_500);
  const capped = appendShopProfitConsent(longExisting, new Date("2026-11-23T10:00:00Z"));
  assert.equal(capped.length, 4_000);
  assert.ok(capped.includes(SHOP_PROFIT_CONSENT_MARKER));
});
