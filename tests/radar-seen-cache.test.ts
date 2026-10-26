import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_SEEN_TTL_DAYS, shouldSkipSeen, seenTtlDays } from "@/lib/radar/seen-cache";

const NOW = new Date("2026-10-26T12:00:00.000Z");
const HOUR_MS = 3_600_000;

test("no entry means score it", () => {
  assert.equal(shouldSkipSeen(null, { now: NOW }), false);
});

test("a fresh judgement skips the AI call", () => {
  const seenAt = new Date(NOW.getTime() - 2 * HOUR_MS).toISOString();
  assert.equal(shouldSkipSeen({ seenAt }, { now: NOW }), true);
});

test("an expired judgement is re-scored", () => {
  const stale = new Date(NOW.getTime() - (DEFAULT_SEEN_TTL_DAYS + 1) * 24 * HOUR_MS).toISOString();
  assert.equal(shouldSkipSeen({ seenAt: stale }, { now: NOW }), false);
});

test("ttl 0 disables the cache (useful while tuning the threshold)", () => {
  const seenAt = NOW.toISOString();
  assert.equal(shouldSkipSeen({ seenAt }, { now: NOW, ttlDays: 0 }), false);
});

test("a future seen_at is treated as stale, not trusted", () => {
  const ahead = new Date(NOW.getTime() + HOUR_MS).toISOString();
  assert.equal(shouldSkipSeen({ seenAt: ahead }, { now: NOW }), false);
});

test("an unparsable timestamp is re-scored", () => {
  assert.equal(shouldSkipSeen({ seenAt: "not-a-date" }, { now: NOW }), false);
});

test("the TTL comes from the environment with a sane default", () => {
  assert.equal(seenTtlDays({}), DEFAULT_SEEN_TTL_DAYS);
  assert.equal(seenTtlDays({ RADAR_SEEN_TTL_DAYS: "7" }), 7);
  assert.equal(seenTtlDays({ RADAR_SEEN_TTL_DAYS: "0" }), 0);
  assert.equal(seenTtlDays({ RADAR_SEEN_TTL_DAYS: "-5" }), DEFAULT_SEEN_TTL_DAYS);
  assert.equal(seenTtlDays({ RADAR_SEEN_TTL_DAYS: "abc" }), DEFAULT_SEEN_TTL_DAYS);
});
