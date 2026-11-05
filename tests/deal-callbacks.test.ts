import assert from "node:assert/strict";
import test from "node:test";

import { isDealCoolingDown } from "@/lib/deals/selection";
import {
  dealCallbackData,
  dealPreviewKeyboard,
  isDealCallback,
  parseDealCallback
} from "@/lib/deals/callbacks";

const PRODUCT_ID = "3c0f5a52-6c8e-4b1f-9f3a-1b2c3d4e5f60";

test("the preview keyboard round-trips through the parser", () => {
  const keyboard = dealPreviewKeyboard(PRODUCT_ID);
  const row = keyboard.inline_keyboard[0];
  assert.ok(row, "the keyboard has one row");

  assert.equal(row.length, 2);

  const parsed = row.map((button) => parseDealCallback(button.callback_data ?? ""));

  assert.deepEqual(parsed, [
    { verb: "post", productId: PRODUCT_ID },
    { verb: "skip", productId: PRODUCT_ID }
  ]);
});

test("Telegram's 64-byte callback_data limit is respected", () => {
  for (const verb of ["post", "skip"] as const) {
    assert.ok(dealCallbackData(verb, PRODUCT_ID).length <= 64);
  }
});

test("a stale preview button cannot republish a product inside its cooldown", () => {
  const now = new Date("2026-11-05T04:00:00Z");

  // Dealt two hours ago: the button in an old chat message must be refused.
  assert.equal(isDealCoolingDown("2026-11-05T02:00:00Z", now), true);
  // Dealt eight days ago: reposting is fine.
  assert.equal(isDealCoolingDown("2026-10-28T04:00:00Z", now), false);
  // Never dealt, or an unparsable timestamp: treat as postable.
  assert.equal(isDealCoolingDown(null, now), false);
  assert.equal(isDealCoolingDown("not-a-date", now), false);
});

test("approval buttons and queue buttons cannot be confused", () => {
  assert.equal(isDealCallback("approve:3c0f5a52"), false);
  assert.equal(parseDealCallback("approve:3c0f5a52"), null);
  assert.equal(parseDealCallback("deal:refresh:1"), null, "only post/skip are deal verbs");
  assert.equal(parseDealCallback("deal:post:"), null, "a verb without a product is invalid");
  assert.equal(parseDealCallback("deal:"), null);
});
