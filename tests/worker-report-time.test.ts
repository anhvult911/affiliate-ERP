import assert from "node:assert/strict";
import test from "node:test";

import {
  EXECUTION_TIME_TOLERANCE_MS,
  resolveExecutedAt,
  wasExecutedAtOverridden
} from "@/lib/worker/report-time";

const NOW = new Date("2026-10-26T12:00:00.000Z");

test("a missing timestamp becomes the server's now", () => {
  assert.equal(resolveExecutedAt(undefined, NOW), NOW.toISOString());
  assert.equal(resolveExecutedAt(null, NOW), NOW.toISOString());
  assert.equal(resolveExecutedAt("", NOW), NOW.toISOString());
});

test("a client timestamp inside the tolerance is kept", () => {
  const justFinished = new Date(NOW.getTime() - 30_000).toISOString();
  assert.equal(resolveExecutedAt(justFinished, NOW), justFinished);

  const atTheEdge = new Date(NOW.getTime() - EXECUTION_TIME_TOLERANCE_MS).toISOString();
  assert.equal(resolveExecutedAt(atTheEdge, NOW), atTheEdge);
});

test("a stale client timestamp is replaced by the server's now", () => {
  const backdated = new Date(NOW.getTime() - 6 * 3_600_000).toISOString();
  assert.equal(resolveExecutedAt(backdated, NOW), NOW.toISOString());
  assert.equal(wasExecutedAtOverridden(backdated, resolveExecutedAt(backdated, NOW)), true);
});

test("a future client timestamp beyond the tolerance is replaced too", () => {
  const ahead = new Date(NOW.getTime() + 10 * 60_000).toISOString();
  assert.equal(resolveExecutedAt(ahead, NOW), NOW.toISOString());
});

test("an unparsable value falls back to now", () => {
  assert.equal(resolveExecutedAt("not-a-date", NOW), NOW.toISOString());
  assert.equal(wasExecutedAtOverridden("not-a-date", NOW.toISOString()), true);
});

test("reporting the same instant in another offset is not an override", () => {
  // 19:00+07:00 is 12:00Z — the worker's timezone must not matter.
  assert.equal(resolveExecutedAt("2026-10-26T19:00:00+07:00", NOW), NOW.toISOString());
  assert.equal(wasExecutedAtOverridden("2026-10-26T19:00:00+07:00", NOW.toISOString()), false);
});
