import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_LOOKBACK_MINUTES, planSyncWindow } from "@/lib/shopee/sync-state";

const NOW = new Date("2026-10-26T12:00:00.000Z");

test("the first run looks back a whole initial window", () => {
  const { start, end } = planSyncWindow({ now: NOW, watermark: null });

  assert.equal(end.toISOString(), NOW.toISOString());
  assert.equal(start.toISOString(), "2026-10-25T12:00:00.000Z");
});

test("a watermark is re-read with the lookback overlap", () => {
  const watermark = new Date("2026-10-26T10:00:00.000Z");
  const { start } = planSyncWindow({ now: NOW, watermark, lookbackMinutes: 120 });

  assert.equal(start.toISOString(), "2026-10-26T08:00:00.000Z");
});

test("the default lookback is two hours", () => {
  const watermark = new Date("2026-10-26T10:00:00.000Z");
  const { start } = planSyncWindow({ now: NOW, watermark });

  const expected = new Date(watermark.getTime() - DEFAULT_LOOKBACK_MINUTES * 60_000);
  assert.equal(start.toISOString(), expected.toISOString());
});

test("a watermark in the future (clock skew) never produces an empty window", () => {
  const watermark = new Date("2026-10-26T12:30:00.000Z");
  const { start, end } = planSyncWindow({ now: NOW, watermark, lookbackMinutes: 15 });

  assert.ok(start.getTime() < end.getTime());
  assert.equal(end.toISOString(), NOW.toISOString());
});

test("a very old watermark is used as-is (the window is not clamped to the lookback)", () => {
  const watermark = new Date("2026-09-01T00:00:00.000Z");
  const { start } = planSyncWindow({ now: NOW, watermark, lookbackMinutes: 60 });

  assert.equal(start.toISOString(), "2026-08-31T23:00:00.000Z");
});
