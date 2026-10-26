import assert from "node:assert/strict";
import test from "node:test";

import { ShopeeClient, type ShopeeTransport } from "@/lib/shopee/client";
import type { ShopeeConfig } from "@/lib/shopee/config";
import { probeExitCode, runProductOfferProbe } from "@/lib/shopee/probe";

const CONFIG: ShopeeConfig = {
  appId: "1234567890",
  secret: "test-secret-value",
  endpoint: "https://open-api.affiliate.shopee.vn/graphql",
  timeoutMs: 1_000,
  maxRequestsPerRun: 5
};

function clientWith(response: { status: number; text: string }): ShopeeClient {
  const transport: ShopeeTransport = async () => response;
  return new ShopeeClient(CONFIG, { transport, now: () => 1_700_000_000_000 });
}

test("a successful probe reports the first offer", async () => {
  const outcome = await runProductOfferProbe(
    clientWith({
      status: 200,
      text: JSON.stringify({
        data: {
          productOfferV2: {
            nodes: [{ itemId: "123", productName: "Tai nghe", commissionRate: "0.25", offerLink: "https://shope.ee/x" }],
            pageInfo: { page: 1, limit: 1, hasNextPage: false }
          }
        }
      })
    })
  );

  assert.equal(outcome.ok, true);
  assert.equal(probeExitCode(outcome), 0);
  assert.deepEqual(outcome.ok && outcome.sample, {
    nodeCount: 1,
    first: { itemId: "123", productName: "Tai nghe", commissionRate: "0.25", offerLink: "https://shope.ee/x" }
  });
});

test("10020 exits 3 and points at the clock and the secret", async () => {
  const outcome = await runProductOfferProbe(
    clientWith({
      status: 200,
      text: JSON.stringify({ errors: [{ message: "Invalid Signature", extensions: { code: 10020 } }] })
    })
  );

  assert.equal(outcome.ok, false);
  assert.equal(probeExitCode(outcome), 3);
  assert.match(!outcome.ok ? outcome.guidance : "", /clock/i);
  assert.ok(!JSON.stringify(outcome).includes(CONFIG.secret));
});

test("10035 exits 3 and explains how to request access", async () => {
  const outcome = await runProductOfferProbe(
    clientWith({
      status: 200,
      text: JSON.stringify({ errors: [{ message: "no access", extensions: { code: 10035 } }] })
    })
  );

  assert.equal(probeExitCode(outcome), 3);
  assert.match(!outcome.ok ? outcome.guidance : "", /dashboard|access/i);
});

test("10030 exits 4, and an unknown failure exits 1", async () => {
  const limited = await runProductOfferProbe(
    clientWith({ status: 200, text: JSON.stringify({ errors: [{ message: "slow down", extensions: { code: 10030 } }] }) })
  );
  assert.equal(probeExitCode(limited), 4);

  const unknown = await runProductOfferProbe(clientWith({ status: 500, text: "" }));
  assert.equal(probeExitCode(unknown), 1);
});

test("an unconfigured probe exits 2", () => {
  assert.equal(probeExitCode({ configured: false }), 2);
});
