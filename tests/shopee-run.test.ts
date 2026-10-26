import assert from "node:assert/strict";
import test from "node:test";

import { createRequestBudget } from "@/lib/shopee/budget";
import { ShopeeAccessError, ShopeeRateLimitError, ShopeeRequestError, ShopeeTransientError } from "@/lib/shopee/client";
import { backoffDelayMs, classifyRunError, runPacedJob } from "@/lib/shopee/run";

test("errors are classified into stop, retry and fail", () => {
  assert.equal(classifyRunError(new ShopeeRateLimitError("10030")), "stop");
  assert.equal(classifyRunError(new ShopeeAccessError("10035")), "stop");
  assert.equal(classifyRunError(new ShopeeTransientError("10000")), "retry");
  assert.equal(classifyRunError(new ShopeeRequestError("bad query")), "fail");
  assert.equal(classifyRunError(new Error("fetch failed")), "retry");
  assert.equal(classifyRunError(new Error("ECONNRESET")), "retry");
  assert.equal(classifyRunError(new Error("something else")), "fail");
});

test("backoff doubles and is capped", () => {
  assert.deepEqual([1, 2, 3, 4].map((attempt) => backoffDelayMs(attempt)), [800, 1_600, 3_200, 6_400]);
  assert.equal(backoffDelayMs(20), 30_000);
  assert.equal(backoffDelayMs(0), 800);
});

test("a rate limit mid-run stops cleanly and keeps the pages already committed", async () => {
  const committed: string[] = [];
  const recorded: string[] = [];
  let page = 0;

  const result = await runPacedJob<number>({
    budget: createRequestBudget(10),
    fetchPage: async () => {
      page += 1;
      if (page === 3) throw new ShopeeRateLimitError("10030 rate limit");
      return { items: [page], nextCursor: `cursor-${page}` };
    },
    ingestPage: async (items) => new Date(`2026-10-26T0${items[0]}:00:00Z`),
    commitWatermark: async (at) => {
      committed.push(at.toISOString());
    },
    recordError: async (message) => {
      recorded.push(message);
    },
    sleep: async () => {}
  });

  assert.equal(result.status, "stopped");
  assert.equal(result.pages, 2);
  assert.equal(result.items, 2);
  assert.deepEqual(committed, ["2026-10-26T01:00:00.000Z", "2026-10-26T02:00:00.000Z"]);
  assert.equal(recorded.length, 1);
});

test("a transient error is retried within the run", async () => {
  let calls = 0;
  const slept: number[] = [];

  const result = await runPacedJob<number>({
    budget: createRequestBudget(10),
    fetchPage: async () => {
      calls += 1;
      if (calls === 1) throw new ShopeeTransientError("10000 system error");
      return { items: [1], nextCursor: null };
    },
    ingestPage: async () => new Date("2026-10-26T00:00:00Z"),
    commitWatermark: async () => {},
    recordError: async () => {},
    sleep: async (ms) => {
      slept.push(ms);
    }
  });

  assert.equal(result.status, "ok");
  assert.equal(calls, 2);
  assert.deepEqual(slept, [800]);
});

test("retries are bounded, then the run fails and records the error", async () => {
  const recorded: string[] = [];

  const result = await runPacedJob<number>({
    budget: createRequestBudget(10),
    fetchPage: async () => {
      throw new ShopeeTransientError("still down");
    },
    ingestPage: async () => new Date(),
    commitWatermark: async () => {},
    recordError: async (message) => {
      recorded.push(message);
    },
    sleep: async () => {},
    maxRetries: 2
  });

  assert.equal(result.status, "failed");
  assert.equal(result.requests, 2);
  assert.equal(recorded.length, 1);
});

test("the request budget stops the run before the ceiling is exceeded", async () => {
  const result = await runPacedJob<number>({
    budget: createRequestBudget(1),
    fetchPage: async () => ({ items: [1], nextCursor: "more" }),
    ingestPage: async () => new Date("2026-10-26T00:00:00Z"),
    commitWatermark: async () => {},
    recordError: async () => {},
    sleep: async () => {}
  });

  assert.equal(result.status, "stopped");
  assert.equal(result.requests, 1);
});

test("pages are committed one by one, so a later failure is not lossy", async () => {
  const committed: string[] = [];
  let page = 0;

  const result = await runPacedJob<number>({
    budget: createRequestBudget(10),
    fetchPage: async () => {
      page += 1;
      if (page === 2) throw new ShopeeAccessError("10035");
      return { items: [page], nextCursor: "next" };
    },
    ingestPage: async () => new Date("2026-10-26T05:00:00Z"),
    commitWatermark: async (at) => {
      committed.push(at.toISOString());
    },
    recordError: async () => {},
    sleep: async () => {}
  });

  assert.equal(result.status, "stopped");
  assert.equal(committed.length, 1);
});
