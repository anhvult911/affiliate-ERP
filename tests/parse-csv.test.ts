import assert from "node:assert/strict";
import test from "node:test";

import { parseProductCsv, splitCsvLine } from "@/lib/products/parse-csv";

test("reads a Vietnamese semicolon export with thousand separators and percentages", () => {
  const { products, issues } = parseProductCsv(
    [
      "Tên sản phẩm;Link tiếp thị;Giá;Tỷ lệ hoa hồng;Ngành hàng",
      "Máy hút sữa điện đôi;https://s.shopee.vn/abc123;890.000đ;12,5;me_bim",
      "Kệ nhựa 4 tầng;https://s.shopee.vn/def456;249000;8%;decor"
    ].join("\n")
  );

  assert.equal(issues.length, 0);
  assert.deepEqual(
    products.map((product) => ({
      name: product.name,
      price: product.price,
      rate: product.commissionRate,
      niche: product.niche
    })),
    [
      { name: "Máy hút sữa điện đôi", price: 890_000, rate: 12.5, niche: "me_bim" },
      { name: "Kệ nhựa 4 tầng", price: 249_000, rate: 8, niche: "decor" }
    ]
  );
});

test("money keeps Vietnamese thousands, decimals only when 1-2 digits follow", () => {
  const { products } = parseProductCsv(
    ["name,link,price", "A,https://s.shopee.vn/a,1.250.000", "B,https://s.shopee.vn/b,99.99"].join("\n")
  );

  assert.deepEqual(
    products.map((product) => product.price),
    [1_250_000, 99.99]
  );
});

test("a quoted name containing a comma survives", () => {
  assert.deepEqual(splitCsvLine('"Kệ nhựa, 4 tầng",https://x,249000', ","), [
    "Kệ nhựa, 4 tầng",
    "https://x",
    "249000"
  ]);

  const { products } = parseProductCsv(
    ["Product Name,Affiliate Link,Price", '"Kệ nhựa, 4 tầng",https://s.shopee.vn/x1,249000'].join("\n")
  );
  assert.equal(products[0]?.name, "Kệ nhựa, 4 tầng");
});

test("tab-separated exports work and the item id is lifted from the link", () => {
  const { products } = parseProductCsv(
    ["name\tlink", "Máy hút sữa\thttps://shopee.vn/product/12345/67890"].join("\n")
  );

  assert.equal(products.length, 1);
  assert.equal(products[0]?.shopeeItemId, "67890");
});

test("one bad row is reported and the good rows still import", () => {
  const { products, issues } = parseProductCsv(
    [
      "name,link,price",
      "Good,https://s.shopee.vn/ok,100000",
      "Bad url,not-a-url,200000",
      "Duplicate,https://s.shopee.vn/ok,300000"
    ].join("\n")
  );

  assert.deepEqual(products.map((product) => product.name), ["Good"]);
  assert.deepEqual(issues.map((issue) => issue.line), [3, 4]);
  assert.match(issues[1]?.error ?? "", /trùng/i);
});

test("missing required columns fails with an actionable message", () => {
  const { products, issues } = parseProductCsv(["foo,bar", "1,2"].join("\n"));

  assert.equal(products.length, 0);
  assert.match(issues[0]?.error ?? "", /Tên sản phẩm/);
});

test("a header-only file is rejected instead of inserting nothing silently", () => {
  const { issues } = parseProductCsv("name,link");
  assert.match(issues[0]?.error ?? "", /ít nhất một dòng dữ liệu/);
});
