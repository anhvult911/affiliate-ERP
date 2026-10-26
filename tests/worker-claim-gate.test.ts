import assert from "node:assert/strict";
import test from "node:test";

import { shouldClaimTasks } from "../workers/src/config";

const BASE = {
  dryRun: false,
  executor: "facebook" as const,
  warmingOnly: false,
  dryRunClaims: false
};

test("a normal run claims", () => {
  assert.equal(shouldClaimTasks(BASE), true);
});

test("a fixture dry-run does NOT claim real tasks", () => {
  assert.equal(shouldClaimTasks({ ...BASE, dryRun: true, executor: "fixture" }), false);
});

test("DRY_RUN_CLAIMS=true re-opens the fixture dry-run", () => {
  assert.equal(
    shouldClaimTasks({ ...BASE, dryRun: true, executor: "fixture", dryRunClaims: true }),
    true
  );
});

test("a dry-run against the real executor still claims — that is the documented workflow", () => {
  assert.equal(shouldClaimTasks({ ...BASE, dryRun: true, executor: "facebook" }), true);
});

test("a real fixture run claims (it exercises the whole path on a local page)", () => {
  assert.equal(shouldClaimTasks({ ...BASE, executor: "fixture" }), true);
});

test("warming-only never claims", () => {
  assert.equal(shouldClaimTasks({ ...BASE, warmingOnly: true }), false);
  assert.equal(shouldClaimTasks({ ...BASE, warmingOnly: true, dryRunClaims: true }), false);
});
