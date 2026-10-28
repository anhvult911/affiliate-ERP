import assert from "node:assert/strict";
import test from "node:test";

import {
  asIsoFromUnix,
  commissionPercent,
  conversionStatus,
  flattenConversionNode,
  flattenConversionNodes,
  flattenValidatedNode,
  mapOfferNode
} from "@/lib/shopee/reports";

test("commissionRate is a decimal fraction and the column is a percentage", () => {
  assert.equal(commissionPercent("0.25"), 25);
  assert.equal(commissionPercent("0.075"), 7.5);
  // Some regions already send a percentage; do not multiply it twice.
  assert.equal(commissionPercent("12.5"), 12.5);
  assert.equal(commissionPercent("1"), 100);
  assert.equal(commissionPercent("2"), 2);
  assert.equal(commissionPercent(null), null);
});

test("an offer maps every documented field, with money as numbers", () => {
  const row = mapOfferNode({
    itemId: 123456789,
    productName: "Máy hút sữa điện đôi",
    priceMin: "750000.00",
    priceMax: "990000.00",
    commissionRate: "0.12",
    sellerCommissionRate: "0.08",
    shopeeCommissionRate: "0.04",
    sales: 1200,
    ratingStar: 4.8,
    imageUrl: "https://cf.shopee.vn/file/x.jpg",
    shopId: 998877,
    shopName: "Shop Mẹ Bỉm",
    productLink: "https://shopee.vn/x-i.998877.123456789",
    offerLink: "https://s.shopee.vn/abc",
    periodEndTime: 1_800_000_000
  });

  assert.ok(row);
  assert.equal(row.shopee_item_id, "123456789");
  assert.equal(row.price, 750_000);
  assert.equal(row.commission_rate, 12);
  assert.equal(row.seller_commission_rate, 8);
  assert.equal(row.shopee_commission_rate, 4);
  assert.equal(row.shop_id, "998877");
  assert.equal(row.origin_link, "https://shopee.vn/x-i.998877.123456789");
  assert.equal(row.offer_period_end_at, new Date(1_800_000_000_000).toISOString());
});

test("an offer missing the upsert key, the name or the link is skipped", () => {
  assert.equal(mapOfferNode({ productName: "x", offerLink: "https://s.shopee.vn/a" }), null);
  assert.equal(mapOfferNode({ itemId: 1, offerLink: "https://s.shopee.vn/a" }), null);
  assert.equal(mapOfferNode({ itemId: 1, productName: "x" }), null);
  assert.equal(mapOfferNode(null), null);
});

test("CANCELLED is the only status that beats pending; validated settles separately", () => {
  assert.equal(conversionStatus("CANCELLED"), "canceled");
  assert.equal(conversionStatus("cancelled"), "canceled");
  assert.equal(conversionStatus("COMPLETED"), "pending");
  assert.equal(conversionStatus("PENDING"), "pending");
  assert.equal(conversionStatus(undefined), "pending");
});

test("one conversion with two orders becomes two rows keyed by orderId", () => {
  const rows = flattenConversionNode({
    utmContent: "T-ABC123",
    purchaseTime: 1_790_000_000,
    totalCommission: "999.00",
    orders: [
      {
        orderId: "order-1",
        orderStatus: "COMPLETED",
        items: [{ itemPrice: "100000.00", qty: 2, itemTotalCommission: "24000.00" }]
      },
      {
        orderId: "order-2",
        orderStatus: "CANCELLED",
        items: [{ itemPrice: "50000.00", qty: 1, itemTotalCommission: "5000.00" }]
      }
    ]
  });

  assert.equal(rows.length, 2);
  const first = rows[0]!;
  const second = rows[1]!;

  assert.deepEqual(rows.map((row) => row.externalOrderId), ["order-1", "order-2"]);
  assert.equal(first.orderAmount, 200_000);
  assert.equal(first.estimatedCommission, 24_000);
  assert.equal(first.status, "pending");
  assert.equal(second.status, "canceled");
  assert.equal(first.convertedAt, new Date(1_790_000_000_000).toISOString());
});

test("per-order commission wins, so a checkout total is never counted per order", () => {
  const rows = flattenConversionNode({
    utmContent: "T-X",
    totalCommission: "50000.00",
    orders: [
      { orderId: "a", items: [{ itemTotalCommission: "10000.00" }] },
      { orderId: "b", items: [{ itemTotalCommission: "15000.00" }] }
    ]
  });

  assert.deepEqual(rows.map((row) => row.estimatedCommission), [10_000, 15_000]);
});

test("an order without items falls back to its amount and the conversion commission", () => {
  const rows = flattenConversionNode({
    utmContent: "T-X",
    totalCommission: "7000.00",
    orders: [{ orderId: "a", actualAmount: "99999.00" }]
  });

  assert.equal(rows[0]?.orderAmount, 99_999);
  assert.equal(rows[0]?.estimatedCommission, 7_000);
});

test("a conversion without utmContent is still stored, with an empty Sub_ID", () => {
  const rows = flattenConversionNode({ orders: [{ orderId: "a" }] });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.subId, "");
});

test("malformed nodes and orders are skipped, the rest of the page survives", () => {
  assert.deepEqual(flattenConversionNode(null), []);
  assert.deepEqual(flattenConversionNode({ orders: "nope" }), []);

  const rows = flattenConversionNodes([
    { orders: [{ orderId: "ok" }, { orderId: "" }, "junk"] },
    "junk",
    { orders: [{ orderId: "also-ok" }] }
  ]);

  assert.deepEqual(rows.map((row) => row.externalOrderId), ["ok", "also-ok"]);
});

test("validated rows are settled and carry the net commission", () => {
  const rows = flattenValidatedNode({
    utmContent: "T-SETTLED",
    purchaseTime: 1_790_000_000,
    netCommission: "18500.00",
    orders: [{ orderId: "done-1", items: [{ itemTotalCommission: "20000.00" }] }]
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.status, "settled");
  assert.equal(rows[0]?.externalOrderId, "done-1");
  assert.equal(rows[0]?.estimatedCommission, 18_500);
});

test("unix seconds become ISO; junk becomes null", () => {
  assert.equal(asIsoFromUnix(0), null);
  assert.equal(asIsoFromUnix("abc"), null);
  assert.equal(asIsoFromUnix("1790000000"), new Date(1_790_000_000_000).toISOString());
});
