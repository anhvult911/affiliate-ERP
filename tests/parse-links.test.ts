import assert from "node:assert/strict";
import test from "node:test";

import { describeShopeeLink, parsePrice, parseProductLinks } from "../src/lib/products/parse-links.js";

test("derives name and item id from a Shopee product URL", () => {
  const derived = describeShopeeLink(
    "https://shopee.vn/May-loc-khong-khi-Xiaomi-Elite-i.123456789.987654321?sp_atk=abc"
  );
  assert.equal(derived.name, "May loc khong khi Xiaomi Elite");
  assert.equal(derived.itemId, "123456789");
});

test("reads the id from a numeric /product/ path", () => {
  const derived = describeShopeeLink("https://shopee.vn/product/123456789/987654321");
  assert.equal(derived.itemId, "123456789");
  assert.equal(derived.name, null);
});

test("a short link yields nothing usable", () => {
  assert.deepEqual(describeShopeeLink("https://s.shopee.vn/abc123"), { name: null, itemId: null });
});

test("parses VN price forms", () => {
  assert.equal(parsePrice("150000"), 150000);
  assert.equal(parsePrice("150.000"), 150000);
  assert.equal(parsePrice("150,000đ"), 150000);
  assert.equal(parsePrice("150k"), 150000);
  assert.equal(parsePrice("1.290.000"), 1290000);
  assert.equal(parsePrice("abc"), null);
  assert.equal(parsePrice(""), null);
});

test("full links need only the link itself", () => {
  const { products, issues } = parseProductLinks(
    [
      "https://shopee.vn/May-loc-khong-khi-Xiaomi-Elite-i.111.222",
      "https://shopee.vn/Noi-chien-khong-dau-Philips-i.333.444"
    ].join("\n")
  );

  assert.equal(issues.length, 0);
  assert.equal(products.length, 2);
  assert.equal(products[0]?.name, "May loc khong khi Xiaomi Elite");
  assert.equal(products[0]?.shopeeItemId, "111");
  assert.equal(products[0]?.price, null);
});

test("pipes fill what the link cannot: name, price, niche", () => {
  const { products, issues } = parseProductLinks(
    "https://s.shopee.vn/abc123 | Kệ nhựa 4 tầng | 249000 | decor"
  );

  assert.equal(issues.length, 0);
  assert.deepEqual(products[0], {
    line: 1,
    name: "Kệ nhựa 4 tầng",
    affiliateLink: "https://s.shopee.vn/abc123",
    price: 249000,
    commissionRate: null,
    niche: "decor",
    shopeeItemId: null
  });
});

test("short link without a name is reported, not silently dropped", () => {
  const { products, issues } = parseProductLinks("https://s.shopee.vn/abc123");
  assert.equal(products.length, 0);
  assert.match(issues[0]?.error ?? "", /rút gọn/);
});

test("duplicates inside the paste are skipped with a line number", () => {
  const link = "https://shopee.vn/May-loc-i.111.222";
  const { products, issues } = parseProductLinks([link, link].join("\n"));

  assert.equal(products.length, 1);
  assert.equal(issues[0]?.line, 2);
  assert.match(issues[0]?.error ?? "", /lặp/);
});

test("non-URL lines, blank lines and comments are handled", () => {
  const { products, issues } = parseProductLinks(
    ["", "# ghi chú", "không phải link", "https://shopee.vn/May-loc-i.9.9"].join("\n")
  );

  assert.equal(products.length, 1);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.line, 3);
});
