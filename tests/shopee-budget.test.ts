import assert from "node:assert/strict";
import test from "node:test";

import { createRequestBudget, RequestBudgetExceededError, SHOPEE_JOBS, shopeeJob } from "@/lib/shopee/budget";

test("the budget allows exactly the configured number of requests", () => {
  const budget = createRequestBudget(3);

  budget.spend();
  budget.spend();
  budget.spend();

  assert.equal(budget.used, 3);
  assert.equal(budget.remaining, 0);
  assert.throws(() => budget.spend(), (error: unknown) => error instanceof RequestBudgetExceededError);
  assert.equal(budget.used, 3, "a rejected spend must not count");
});

test("an invalid ceiling is rejected at construction", () => {
  assert.throws(() => createRequestBudget(0), /positive integer/);
  assert.throws(() => createRequestBudget(-1), /positive integer/);
  assert.throws(() => createRequestBudget(1.5), /positive integer/);
});

test("every documented job has a path, a cadence and a reason", () => {
  for (const job of SHOPEE_JOBS) {
    assert.match(job.path, /^\/api\/cron\//);
    assert.ok(job.everyMinutes >= 1);
    assert.ok(job.maxRequestsPerRun >= 1);
    assert.ok(job.reason.length > 20, `${job.job} needs a reason`);
  }
});

test("cadence ordering matches the spec: conversions most often, validated daily", () => {
  assert.ok(shopeeJob("conversions").everyMinutes < shopeeJob("products").everyMinutes);
  assert.ok(shopeeJob("products").everyMinutes < shopeeJob("validated").everyMinutes);
  assert.equal(shopeeJob("validated").everyMinutes, 1_440);
});

test("an unknown job name fails loudly", () => {
  // @ts-expect-error deliberately invalid
  assert.throws(() => shopeeJob("nope"), /Unknown Shopee job/);
});
