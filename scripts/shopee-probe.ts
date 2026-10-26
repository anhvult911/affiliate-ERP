/**
 * Shopee Affiliate smoke probe (docs/TASKS.md T-SHOPEE-03).
 *
 *   pnpm shopee:probe
 *
 * Calls `productOfferV2(limit: 1)` against the real endpoint and prints the HTTP
 * status plus the first node (or the GraphQL error). Exit codes:
 *
 *   0  the API answered with data
 *   1  unexpected failure
 *   2  not configured — set SHOPEE_AFFILIATE_APP_ID / _APP_SECRET first
 *   3  signature or access problem (10020 / 10035)
 *   4  rate limited (10030 / HTTP 429)
 *
 * Paste the output into docs/SHOPEE_API.md §2 before enabling the sync tasks: until a
 * real response is on record, the schema is unverified for this region.
 */
import { ShopeeClient, ShopeeError, type ShopeeTransport } from "@/lib/shopee/client";
import { describeShopeeConfig, isShopeeConfigured, readShopeeConfig } from "@/lib/shopee/config";
import { captureTransport, probeExitCode, runProductOfferProbe } from "@/lib/shopee/probe";

async function main(): Promise<number> {
  if (!isShopeeConfigured()) {
    console.error(
      "Shopee API is not configured.\n" +
        "Set SHOPEE_AFFILIATE_APP_ID and SHOPEE_AFFILIATE_APP_SECRET (affiliate dashboard → Open API).\n" +
        "Access must be granted first — see docs/SHOPEE_API.md §2."
    );
    return probeExitCode({ configured: false });
  }

  const config = readShopeeConfig();
  console.log("shopee probe", JSON.stringify(describeShopeeConfig(config)));

  const response: ShopeeTransport = async (request) => {
    const started = Date.now();
    const result = await fetch(request.endpoint, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      signal: AbortSignal.timeout(request.timeoutMs)
    });
    console.log(`POST ${request.endpoint} → HTTP ${result.status} (${Date.now() - started}ms)`);
    return { status: result.status, text: await result.text() };
  };

  const captured = captureTransport(response);
  const client = new ShopeeClient(config, { transport: captured.transport });
  const outcome = await runProductOfferProbe(client);

  if (outcome.ok) {
    console.log("OK — productOfferV2 responded");
    console.log(JSON.stringify(outcome.sample, null, 2));
    return probeExitCode(outcome);
  }

  console.error(`FAILED (HTTP ${captured.lastStatus() ?? "n/a"}, code ${outcome.code ?? "n/a"})`);
  console.error(outcome.message);
  console.error(`\n${outcome.guidance}`);

  if (outcome.code === null) {
    console.error("If this was a network error, check connectivity to the endpoint.");
  }

  return probeExitCode(outcome);
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof ShopeeError ? error.message : String(error));
    process.exit(1);
  });
