import assert from "node:assert/strict";
import test from "node:test";

import {
  TELEGRAM_TEXT_LIMIT,
  buildDealCaption,
  buildDealPreview,
  escapeHtml,
  formatVnd,
  resolveDealCaption,
  trimForTelegram
} from "@/lib/deals/copy";

const PRODUCT = {
  name: "Máy hút sữa điện đôi",
  price: 750_000,
  affiliate_short_link: "https://s.shopee.vn/abc123"
};

test("prices are grouped the Vietnamese way and junk is dropped", () => {
  assert.equal(formatVnd(750000), "750.000 ₫");
  assert.equal(formatVnd("199000.5"), "199.001 ₫"); // rounds, never truncates
  assert.equal(formatVnd(null), null);
  assert.equal(formatVnd(0), null);
  assert.equal(formatVnd("abc"), null);
});

test("the template carries name, price and the affiliate link", () => {
  const caption = buildDealCaption(PRODUCT);

  assert.match(caption, /Máy hút sữa điện đôi/);
  assert.match(caption, /750\.000 ₫/);
  assert.match(caption, /https:\/\/s\.shopee\.vn\/abc123/);
  assert.match(caption, /#deal/);
});

test("a product without a price still produces a postable caption", () => {
  const caption = buildDealCaption({ ...PRODUCT, price: null });

  assert.match(caption, /Máy hút sữa điện đôi/);
  assert.equal(caption.includes("Giá:"), false);
});

test("HTML in product data is escaped, so Telegram cannot reject the message", () => {
  const caption = buildDealCaption({ ...PRODUCT, name: "Tai nghe <2 củ> & phụ kiện" });

  assert.match(caption, /&lt;2 củ&gt;/);
  assert.match(caption, /&amp; phụ kiện/);
  assert.equal(caption.includes("<2 củ>"), false);
  assert.equal(escapeHtml("a<b>&c"), "a&lt;b&gt;&amp;c");
});

test("a model that writes too much is cut to Telegram's limit", () => {
  const long = "x".repeat(TELEGRAM_TEXT_LIMIT + 500);
  const trimmed = trimForTelegram(long);

  assert.equal(trimmed.length, TELEGRAM_TEXT_LIMIT);
  assert.ok(trimmed.endsWith("…"));
});

test("the approved draft wins over the template", () => {
  const draft = "🔥 Deal hôm nay\n\n👉 link: https://s.shopee.vn/abc123";

  assert.equal(resolveDealCaption(PRODUCT, draft), draft);
  assert.equal(resolveDealCaption(PRODUCT, "   "), buildDealCaption(PRODUCT));
  assert.equal(resolveDealCaption(PRODUCT, null), buildDealCaption(PRODUCT));
});

test("the preview shows the caption plus a note, and nothing else is added", () => {
  const caption = buildDealCaption(PRODUCT);
  const preview = buildDealPreview(caption);

  assert.ok(preview.startsWith(caption));
  assert.match(preview, /Bản nháp/);
});
