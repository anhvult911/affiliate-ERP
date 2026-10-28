import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { GET, POST } from "@/app/api/cron/deal-poster/route";

/**
 * The route answers before it touches the database in every path tested here, so this
 * runs without Supabase — which is exactly the state of a deployment whose channel has
 * not been created yet.
 */

const SECRET = "deal-route-test-secret";

function request(token?: string): NextRequest {
  return new NextRequest("http://localhost:3000/api/cron/deal-poster", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });
}

function withEnv(overrides: Record<string, string | undefined>, run: () => Promise<void>) {
  return async () => {
    const saved = {
      CRON_SECRET: process.env.CRON_SECRET,
      WORKER_API_TOKEN: process.env.WORKER_API_TOKEN,
      TELEGRAM_CHANNEL_ID: process.env.TELEGRAM_CHANNEL_ID,
      TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
      TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID
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

test(
  "a wrong token is rejected before anything else",
  withEnv({ CRON_SECRET: SECRET, WORKER_API_TOKEN: undefined }, async () => {
    const response = await GET(request("wrong"));
    assert.equal(response.status, 401);
  })
);

test(
  "no TELEGRAM_CHANNEL_ID is a 200 skip with a hint, not an error",
  withEnv(
    { CRON_SECRET: SECRET, WORKER_API_TOKEN: undefined, TELEGRAM_CHANNEL_ID: undefined },
    async () => {
      const response = await POST(request(SECRET));
      const body = (await response.json()) as { ok: boolean; skipped: string; hint: string };

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.skipped, "TELEGRAM_CHANNEL_ID_PENDING");
      assert.match(body.hint, /@channelusername/);
    }
  )
);

test(
  "a channel without a bot token is also a skip",
  withEnv(
    {
      CRON_SECRET: SECRET,
      WORKER_API_TOKEN: undefined,
      TELEGRAM_CHANNEL_ID: "@deals_test",
      TELEGRAM_BOT_TOKEN: undefined,
      TELEGRAM_CHAT_ID: undefined
    },
    async () => {
      const response = await GET(request(SECRET));
      const body = (await response.json()) as { ok: boolean; skipped: string };

      assert.equal(response.status, 200);
      assert.equal(body.skipped, "TELEGRAM_NOT_CONFIGURED");
    }
  )
);
