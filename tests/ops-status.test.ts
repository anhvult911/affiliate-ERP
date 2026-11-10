import assert from "node:assert/strict";
import test from "node:test";

import {
  CRON_ENTRIES,
  deriveFreshness,
  formatAge,
  formatVietnamTime,
  nextCronRun,
  type CronEntry
} from "../src/lib/ops/status.js";

const NOW = new Date("2026-11-10T03:15:00Z");

test("a stage inside its cadence reads as running", () => {
  const status = deriveFreshness({
    lastActivityAt: "2026-11-10T03:08:00Z",
    now: NOW,
    staleAfterMins: 10,
    emptyLabel: "chưa chạy"
  });
  assert.equal(status.tone, "ok");
  assert.match(status.detail, /7 phút/);
});

test("a stage past its cadence reads as overdue, and says by how much", () => {
  const status = deriveFreshness({
    lastActivityAt: "2026-11-10T01:00:00Z",
    now: NOW,
    staleAfterMins: 90,
    emptyLabel: "chưa chạy"
  });
  assert.equal(status.tone, "warn");
  // 135 minutes past the last run: reported in minutes, because rounding to hours here would
  // overstate the budget the stage actually has.
  assert.match(status.detail, /135 phút/);
});

test("no activity is idle, not a failure — the empty case must be named", () => {
  const status = deriveFreshness({
    lastActivityAt: null,
    now: NOW,
    staleAfterMins: 10,
    emptyLabel: "chưa group nào được quét"
  });
  assert.equal(status.tone, "idle");
  assert.equal(status.detail, "chưa group nào được quét");
});

test("a future timestamp is clock skew, not health", () => {
  const status = deriveFreshness({
    lastActivityAt: "2026-11-10T04:30:00Z",
    now: NOW,
    staleAfterMins: 10,
    emptyLabel: "—"
  });
  assert.equal(status.tone, "warn");
  assert.equal(status.label, "lệch giờ");
});

test("a 90-minute threshold is not rounded into '2 giờ'", () => {
  // Rounding to hours doubles the apparent budget and hides a stage that is 30 minutes late.
  assert.equal(formatAge(90), "90 phút");
  assert.equal(formatAge(179), "179 phút");
  assert.equal(formatAge(180), "3 giờ");
});

test("every-10-minutes cron lands on the next ten-minute boundary", () => {
  const health = CRON_ENTRIES.find((e) => e.name === "health") as CronEntry;
  assert.equal(nextCronRun(health, NOW).toISOString(), "2026-11-10T03:20:00.000Z");
});

test("the deal poster's next run is 04:30 UTC = 11:30 Vietnam", () => {
  const deal = CRON_ENTRIES.find((e) => e.name === "deal-poster") as CronEntry;
  const next = nextCronRun(deal, NOW);
  assert.equal(next.toISOString(), "2026-11-10T04:30:00.000Z");
  assert.equal(formatVietnamTime(next), "11:30");
});

test("after the last daily slot, the cron wraps to tomorrow", () => {
  const deal = CRON_ENTRIES.find((e) => e.name === "deal-poster") as CronEntry;
  const evening = new Date("2026-11-10T14:00:00Z");
  assert.equal(nextCronRun(deal, evening).toISOString(), "2026-11-11T04:30:00.000Z");
});

test("hourly cron rolls to the next hour when the minute has passed", () => {
  const conv = CRON_ENTRIES.find((e) => e.name === "shopee-conversions") as CronEntry;
  assert.equal(nextCronRun(conv, NOW).toISOString(), "2026-11-10T04:00:00.000Z");
});
