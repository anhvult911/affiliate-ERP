import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DEAL_POSTS_PER_DAY,
  MAX_DEAL_POSTS_PER_DAY,
  normalizeChannelId,
  readDealPosterConfig
} from "@/lib/deals/config";

test("no channel means not ready, and the reason names the variable", () => {
  const config = readDealPosterConfig({});
  assert.equal(config.channelId, null);
  assert.equal(config.missing, "TELEGRAM_CHANNEL_ID");
  assert.equal(config.invalid, null);
});

test("both Telegram channel forms are accepted", () => {
  assert.equal(normalizeChannelId("@deal_vn"), "@deal_vn");
  assert.equal(normalizeChannelId("-1001234567890"), "-1001234567890");
  assert.equal(normalizeChannelId("  @deal_vn  "), "@deal_vn");
});

test("a value that would post nowhere is rejected with a reason", () => {
  // A bare chat id is the common mistake: it is a user's id, not a channel.
  assert.equal(normalizeChannelId("123456789"), null);
  assert.equal(normalizeChannelId("deal channel"), null);

  const config = readDealPosterConfig({ TELEGRAM_CHANNEL_ID: "123456789" });
  assert.equal(config.channelId, null);
  assert.match(config.invalid ?? "", /TELEGRAM_CHANNEL_ID/);
});

test("preview is the default and auto is opt-in", () => {
  assert.equal(readDealPosterConfig({ TELEGRAM_CHANNEL_ID: "@a_channel" }).mode, "preview");
  assert.equal(
    readDealPosterConfig({ TELEGRAM_CHANNEL_ID: "@a_channel", DEAL_POST_MODE: "AUTO" }).mode,
    "auto"
  );
  assert.equal(
    readDealPosterConfig({ TELEGRAM_CHANNEL_ID: "@a_channel", DEAL_POST_MODE: "publish" }).mode,
    "preview"
  );
});

test("posts per day defaults, clamps and ignores junk", () => {
  assert.equal(readDealPosterConfig({ TELEGRAM_CHANNEL_ID: "@a_channel" }).perDay, DEFAULT_DEAL_POSTS_PER_DAY);
  assert.equal(readDealPosterConfig({ TELEGRAM_CHANNEL_ID: "@a_channel", DEAL_POSTS_PER_DAY: "3" }).perDay, 3);
  assert.equal(
    readDealPosterConfig({ TELEGRAM_CHANNEL_ID: "@a_channel", DEAL_POSTS_PER_DAY: "99" }).perDay,
    MAX_DEAL_POSTS_PER_DAY
  );
  assert.equal(readDealPosterConfig({ TELEGRAM_CHANNEL_ID: "@a_channel", DEAL_POSTS_PER_DAY: "0" }).perDay, 2);
  assert.equal(readDealPosterConfig({ TELEGRAM_CHANNEL_ID: "@a_channel", DEAL_POSTS_PER_DAY: "abc" }).perDay, 2);
});
