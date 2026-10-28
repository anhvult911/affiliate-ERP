import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { GET as conversionsGet } from "@/app/api/cron/shopee/conversions/route";
import { GET as productsGet } from "@/app/api/cron/shopee/products/route";
import { GET as validatedGet } from "@/app/api/cron/shopee/validated/route";
import { syncResponse, syncStatusFor } from "@/lib/shopee/cron";
import type { PacedJobResult } from "@/lib/shopee/run";

/**
 * Every case here returns before a database or network call, which is exactly the state
 * of a deployment whose Shopee credential has not been granted yet.
 */

const SECRET = "shopee-cron-test-secret";

function request(token?: string): NextRequest {
  return new NextRequest("http://localhost:3000/api/cron/shopee/products", {
    method: "GET",
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });
}

function withEnv(overrides: Record<string, string | undefined>, run: () => Promise<void>) {
  return async () => {
    const saved = {
      CRON_SECRET: process.env.CRON_SECRET,
      WORKER_API_TOKEN: process.env.WORKER_API_TOKEN,
      SHOPEE_AFFILIATE_APP_ID: process.env.SHOPEE_AFFILIATE_APP_ID,
      SHOPEE_AFFILIATE_APP_SECRET: process.env.SHOPEE_AFFILIATE_APP_SECRET,
      SHOPEE_VALIDATION_ID: process.env.SHOPEE_VALIDATION_ID
    };

    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }

    try {
      await run();
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  };
}

const unconfigured = {
  CRON_SECRET: SECRET,
  WORKER_API_TOKEN: undefined,
  SHOPEE_AFFILIATE_APP_ID: undefined,
  SHOPEE_AFFILIATE_APP_SECRET: undefined,
  SHOPEE_VALIDATION_ID: undefined
};

test(
  "all three Shopee routes reject a wrong token",
  withEnv(unconfigured, async () => {
    for (const route of [productsGet, conversionsGet, validatedGet]) {
      assert.equal((await route(request("wrong"))).status, 401);
    }
  })
);

test(
  "without credentials the crons are a 200 skip, never an error",
  withEnv(unconfigured, async () => {
    for (const route of [productsGet, conversionsGet, validatedGet]) {
      const response = await route(request(SECRET));
      const body = (await response.json()) as { ok: boolean; skipped: string };

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.skipped, "SHOPEE_CRED_PENDING");
    }
  })
);

test(
  "configured but without a validation id, the validated cron still skips",
  withEnv(
    {
      ...unconfigured,
      SHOPEE_AFFILIATE_APP_ID: "12345",
      SHOPEE_AFFILIATE_APP_SECRET: "secret",
      SHOPEE_VALIDATION_ID: undefined
    },
    async () => {
      const response = await validatedGet(request(SECRET));
      const body = (await response.json()) as { ok: boolean; skipped: string };

      assert.equal(response.status, 200);
      assert.equal(body.skipped, "SHOPEE_VALIDATION_PENDING");
    }
  )
);

/* ------------------------------------------------ result → HTTP mapping */

const base: PacedJobResult = { status: "ok", pages: 2, requests: 3, items: 40 };

test("a clean run is 200", () => {
  assert.equal(syncStatusFor(base), 200);
});

test("stop (rate limit / access) is 200 with the reason, not 5xx", () => {
  const stopped: PacedJobResult = {
    ...base,
    status: "stopped",
    action: "stop",
    error: "Shopee rate limit reached (10030)."
  };

  assert.equal(syncStatusFor(stopped), 200);
});

test("fail (bad query) is 500 — it needs a human", () => {
  const failed: PacedJobResult = {
    ...base,
    status: "failed",
    action: "fail",
    error: "Shopee could not parse the query (10010)."
  };

  assert.equal(syncStatusFor(failed), 500);
});

test("the body names the classification so a monitor can tell them apart", async () => {
  const stopped = await (
    await syncResponse("conversion", { ...base, status: "stopped", action: "stop", error: "10030" })
  ).json() as Record<string, unknown>;

  const failed = await (
    await syncResponse("conversion", { ...base, status: "failed", action: "fail", error: "10010" })
  ).json() as Record<string, unknown>;

  assert.equal(stopped.ok, true);
  assert.equal(stopped.action, "stop");
  assert.equal(failed.ok, false);
  assert.equal(failed.action, "fail");
});
