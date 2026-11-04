import assert from "node:assert/strict";
import test from "node:test";

import { platformOf } from "../src/lib/products/platform.js";

test("platformOf recognises Shopee hosts", () => {
  assert.equal(platformOf("https://shopee.vn/foo"), "shopee");
  assert.equal(platformOf("https://www.shopee.vn/foo"), "shopee");
  assert.equal(platformOf("https://s.shopee.vn/abc"), "shopee");
  assert.equal(platformOf("https://shp.ee/abc"), "shopee");
  assert.equal(platformOf("https://shope.ee/abc"), "shopee");
  assert.equal(platformOf("https://sub.shopee.vn/foo"), "shopee");
});

test("platformOf recognises Lazada hosts", () => {
  assert.equal(platformOf("https://lazada.vn/foo"), "lazada");
  assert.equal(platformOf("https://www.lazada.vn/foo"), "lazada");
  assert.equal(platformOf("https://s.lazada.vn/s.abc"), "lazada");
  assert.equal(platformOf("https://sub.lazada.vn/foo"), "lazada");
});

test("platformOf is case-insensitive and tolerates www", () => {
  assert.equal(platformOf("https://WWW.SHOPEE.VN/foo"), "shopee");
  assert.equal(platformOf("https://WWW.LAZADA.VN/foo"), "lazada");
  assert.equal(platformOf("SHOPEE.VN"), "shopee");
  assert.equal(platformOf("lazada.vn"), "lazada");
});

test("platformOf returns other for unknown or lookalike hosts", () => {
  assert.equal(platformOf("https://example.com"), "other");
  assert.equal(platformOf("https://shopee.vn.evil.com"), "other");
  assert.equal(platformOf("https://lazada.vn.evil.com"), "other");
  assert.equal(platformOf("not-a-url"), "other");
});
