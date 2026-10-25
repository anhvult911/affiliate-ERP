import assert from "node:assert/strict";
import test from "node:test";

import { dueSlots, localMoment, zonedToUtc } from "@/lib/warming/schedule";

const TIMEZONE = "Asia/Ho_Chi_Minh";

/** 2026-10-24 09:35 in Ho Chi Minh (UTC+7). */
const at = (iso: string) => new Date(iso);

test("a slot is due inside its grace window", () => {
  const slots = dueSlots([{ at: "09:30", kind: "lifestyle_post" }], {
    now: at("2026-10-24T02:35:00Z"),
    timezone: TIMEZONE,
    graceMinutes: 90,
    runs: []
  });

  assert.deepEqual(slots.map((slot) => slot.kind), ["lifestyle_post"]);
});

test("a slot is not due before its time or after the grace window", () => {
  const schedule = [{ at: "09:30", kind: "lifestyle_post" }];

  assert.equal(
    dueSlots(schedule, {
      now: at("2026-10-24T02:20:00Z"), // 09:20 local
      timezone: TIMEZONE,
      graceMinutes: 90,
      runs: []
    }).length,
    0
  );

  assert.equal(
    dueSlots(schedule, {
      now: at("2026-10-24T04:00:01Z"), // 11:00:01 local, grace ends 11:00
      timezone: TIMEZONE,
      graceMinutes: 90,
      runs: []
    }).length,
    0
  );
});

test("a slot already run today is not repeated", () => {
  const slots = dueSlots([{ at: "09:30", kind: "lifestyle_post" }], {
    now: at("2026-10-24T02:40:00Z"),
    timezone: TIMEZONE,
    graceMinutes: 90,
    runs: [{ kind: "lifestyle_post", executedAt: "2026-10-24T02:31:00Z" }]
  });

  assert.equal(slots.length, 0);
});

test("a run from yesterday does not block today's slot", () => {
  const slots = dueSlots([{ at: "09:30", kind: "lifestyle_post" }], {
    now: at("2026-10-24T02:40:00Z"),
    timezone: TIMEZONE,
    graceMinutes: 90,
    runs: [{ kind: "lifestyle_post", executedAt: "2026-10-23T02:31:00Z" }]
  });

  assert.equal(slots.length, 1);
});

test("a different kind running today does not block this one", () => {
  const slots = dueSlots(
    [
      { at: "09:30", kind: "lifestyle_post" },
      { at: "09:30", kind: "cross_warm" }
    ],
    {
      now: at("2026-10-24T02:40:00Z"),
      timezone: TIMEZONE,
      graceMinutes: 90,
      runs: [{ kind: "cross_warm", executedAt: "2026-10-24T02:31:00Z" }]
    }
  );

  assert.deepEqual(slots.map((slot) => slot.kind), ["lifestyle_post"]);
});

test("unknown kinds and malformed times are skipped, not scheduled", () => {
  const slots = dueSlots(
    [
      { at: "09:30", kind: "not_a_kind" },
      { at: "25:99", kind: "lifestyle_post" },
      { at: "09:30", kind: "profile_setup" }
    ],
    { now: at("2026-10-24T02:35:00Z"), timezone: TIMEZONE, graceMinutes: 90, runs: [] }
  );

  assert.equal(slots.length, 0);
});

test("local time conversion is correct in a UTC+7 zone", () => {
  assert.deepEqual(localMoment(at("2026-10-24T02:35:00Z"), TIMEZONE), {
    date: "2026-10-24",
    minutes: 9 * 60 + 35
  });

  assert.equal(zonedToUtc("2026-10-24", 9 * 60 + 30, TIMEZONE).toISOString(), "2026-10-24T02:30:00.000Z");
});

test("midnight local does not slip to the previous day", () => {
  assert.equal(zonedToUtc("2026-10-24", 0, TIMEZONE).toISOString(), "2026-10-23T17:00:00.000Z");
});
