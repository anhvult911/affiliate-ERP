import assert from "node:assert/strict";
import test from "node:test";

import { parseProductCsv } from "../src/lib/products/parse-csv.js";
import {
  describeShopeeLink,
  isAllowedAffiliateHost,
  parsePrice,
  parseProductLinks
} from "../src/lib/products/parse-links.js";

const SLUG_URL = "https://shopee.vn/May-loc-khong-khi-Xiaomi-Elite-i.123456789.987654321?sp_atk=abc";

test("derives the name and the ITEM id (last group) from a Shopee slug URL", () => {
  const derived = describeShopeeLink(SLUG_URL);
  assert.equal(derived.name, "May loc khong khi Xiaomi Elite");
  // Shopee orders these shopId.itemId — storing the shop id would collide across products.
  assert.equal(derived.itemId, "987654321");
});

test("the paste parser and the CSV parser agree on the item id", () => {
  const fromPaste = parseProductLinks(`${SLUG_URL} | Tên từ paste`).products[0]?.shopeeItemId;
  const fromCsv = parseProductCsv(
    ["Tên sản phẩm,Link tiếp thị", `Tên từ CSV,${SLUG_URL}`].join("\n")
  ).products[0]?.shopeeItemId;

  assert.equal(fromPaste, "987654321");
  assert.equal(fromPaste, fromCsv);
});

test("two products from the same shop are not duplicates of each other", () => {
  const { products, issues } = parseProductLinks(
    [
      "https://shopee.vn/May-loc-Xiaomi-i.111222.900001",
      "https://shopee.vn/Noi-chien-Philips-i.111222.900002"
    ].join("\n")
  );

  assert.equal(issues.length, 0);
  assert.deepEqual(
    products.map((product) => product.shopeeItemId),
    ["900001", "900002"]
  );
});

test("reads the ITEM id from a numeric /product/<shopId>/<itemId> path, with query or slash", () => {
  assert.equal(describeShopeeLink("https://shopee.vn/product/123456789/987654321").itemId, "987654321");
  assert.equal(
    describeShopeeLink("https://shopee.vn/product/123456789/987654321/?smtt=0.1").itemId,
    "987654321"
  );
});

test("a short link yields nothing usable", () => {
  assert.deepEqual(describeShopeeLink("https://s.shopee.vn/abc123"), { name: null, itemId: null });
});

test("only Shopee/Lazada hosts are accepted (the link is opened in a logged-in profile)", () => {
  assert.equal(isAllowedAffiliateHost("shopee.vn"), true);
  assert.equal(isAllowedAffiliateHost("www.shopee.vn"), true);
  assert.equal(isAllowedAffiliateHost("s.shopee.vn"), true);
  assert.equal(isAllowedAffiliateHost("www.lazada.vn"), true);
  assert.equal(isAllowedAffiliateHost("evil.example.com"), false);
  assert.equal(isAllowedAffiliateHost("shopee.vn.evil.example.com"), false);

  const { products, issues } = parseProductLinks(
    "https://evil.example.com/Free-iphone-i.11.22"
  );
  assert.equal(products.length, 0);
  assert.match(issues[0]?.error ?? "", /không thuộc Shopee\/Lazada/);
});

test("a malformed percent-escape is a per-line issue, never a thrown URIError", () => {
  const { products, issues } = parseProductLinks("https://shopee.vn/%E0%A4%A-i.1.2");

  assert.equal(products.length, 0);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.line, 1);
  assert.match(issues[0]?.error ?? "", /mã hoá/);

  // With an explicit name the row is still usable — the id is simply unknown.
  const withName = parseProductLinks("https://shopee.vn/%E0%A4%A-i.1.2 | Tên hợp lệ");
  assert.equal(withName.products.length, 1);
  assert.equal(withName.products[0]?.shopeeItemId, null);
});

test("parses VN price forms", () => {
  assert.equal(parsePrice("150000"), 150000);
  assert.equal(parsePrice("150.000"), 150000);
  assert.equal(parsePrice("150,000đ"), 150000);
  assert.equal(parsePrice("150k"), 150000);
  assert.equal(parsePrice("1.290.000"), 1290000);
  assert.equal(parsePrice("0"), 0);
  assert.equal(parsePrice("abc"), null);
  assert.equal(parsePrice(""), null);
  // VND has no minor unit, and an overflowing value must not reach numeric(14,2).
  assert.equal(parsePrice("12.5"), null);
  assert.equal(parsePrice("99999999999999999"), null);
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
  assert.equal(products[0]?.shopeeItemId, "222");
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

test("an unreadable price is an issue, not a silent null", () => {
  const { products, issues } = parseProductLinks(
    "https://shopee.vn/May-loc-i.1.2 | Máy lọc | giá-sai"
  );
  assert.equal(products.length, 0);
  assert.match(issues[0]?.error ?? "", /Giá/);
});

test("caps: 200 lines accepted, the 201st is reported", () => {
  const line = (index: number) => `https://shopee.vn/San-pham-${index}-i.1.${1000 + index}`;

  const withinCap = parseProductLinks(Array.from({ length: 200 }, (_, i) => line(i)).join("\n"));
  assert.equal(withinCap.products.length, 200);
  assert.equal(withinCap.issues.length, 0);

  const overCap = parseProductLinks(Array.from({ length: 201 }, (_, i) => line(i)).join("\n"));
  assert.equal(overCap.products.length, 200);
  assert.match(overCap.issues.at(-1)?.error ?? "", /tối đa 200/);
});

test("non-URL lines, blank lines and comments are handled", () => {
  const { products, issues } = parseProductLinks(
    ["", "# ghi chú", "không phải link", "https://shopee.vn/May-loc-i.9.9"].join("\n")
  );

  assert.equal(products.length, 1);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.line, 3);
});
