import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuthorizationHeader,
  ShopeeAccessError,
  ShopeeAuthError,
  ShopeeClient,
  ShopeeRateLimitError,
  ShopeeRequestError,
  ShopeeTransientError,
  signShopeeRequest,
  type ShopeeTransport,
  type ShopeeTransportRequest
} from "@/lib/shopee/client";
import type { ShopeeConfig } from "@/lib/shopee/config";

const CONFIG: ShopeeConfig = {
  appId: "1234567890",
  secret: "test-secret-value",
  endpoint: "https://open-api.affiliate.shopee.vn/graphql",
  timeoutMs: 1_000,
  maxRequestsPerRun: 5
};

/** Fixed instant so the signature is reproducible: 1700000000 (unix seconds). */
const NOW = 1_700_000_000_000;

function transportReturning(response: { status: number; text: string } | Error): {
  transport: ShopeeTransport;
  seen: ShopeeTransportRequest[];
} {
  const seen: ShopeeTransportRequest[] = [];
  const transport: ShopeeTransport = async (request) => {
    seen.push(request);
    if (response instanceof Error) throw response;
    return response;
  };
  return { transport, seen };
}

function client(response: { status: number; text: string } | Error) {
  const { transport, seen } = transportReturning(response);
  return { shopee: new ShopeeClient(CONFIG, { transport, now: () => NOW }), seen };
}

test("the signature matches a fixed vector", () => {
  // Computed independently: hex(SHA256(appId + timestamp + body + secret)).
  const body = JSON.stringify({ query: "{__typename}" });
  assert.equal(
    signShopeeRequest({ appId: CONFIG.appId, timestampSeconds: 1_700_000_000, body, secret: CONFIG.secret }),
    "181c023dd787c50f97759e8dc76d67ebc4142107b625f73b2c74143a3aabbc73"
  );
});

test("the authorization header has the documented shape", () => {
  assert.equal(
    buildAuthorizationHeader({ appId: "123", timestampSeconds: 42, signature: "abc" }),
    "SHA256 Credential=123, Timestamp=42, Signature=abc"
  );
});

test("the body that is signed is byte-identical to the body that is sent", async () => {
  const { shopee, seen } = client({ status: 200, text: JSON.stringify({ data: { ok: true } }) });
  await shopee.query("{__typename}");

  const request = seen[0];
  assert.ok(request);

  const expectedSignature = signShopeeRequest({
    appId: CONFIG.appId,
    timestampSeconds: 1_700_000_000,
    body: request.body,
    secret: CONFIG.secret
  });

  assert.match(request.headers.authorization ?? "", new RegExp(`Signature=${expectedSignature}$`));
  assert.equal(JSON.parse(request.body).query, "{__typename}");
});

test("variables are part of the signed body", async () => {
  const { shopee, seen } = client({ status: 200, text: JSON.stringify({ data: { ok: true } }) });
  await shopee.query("query A($limit: Int) { x(limit: $limit) { id } }", { limit: 1 });

  const body = seen[0]?.body ?? "";
  assert.match(body, /"variables":\{"limit":1\}/);
});

test("10020, 10030 and 10035 map to distinct error types", async () => {
  const graphError = (code: number) =>
    JSON.stringify({ errors: [{ message: "boom", extensions: { code } }] });

  await assert.rejects(
    client({ status: 200, text: graphError(10020) }).shopee.query("{__typename}"),
    (error: unknown) => error instanceof ShopeeAuthError
  );
  await assert.rejects(
    client({ status: 200, text: graphError(10030) }).shopee.query("{__typename}"),
    (error: unknown) => error instanceof ShopeeRateLimitError
  );
  await assert.rejects(
    client({ status: 200, text: graphError(10035) }).shopee.query("{__typename}"),
    (error: unknown) => error instanceof ShopeeAccessError
  );
});

test("10000 is transient, 10010 and business codes are not retryable", async () => {
  const graphError = (code: number) =>
    JSON.stringify({ errors: [{ message: "boom", extensions: { code } }] });

  await assert.rejects(
    client({ status: 200, text: graphError(10000) }).shopee.query("{__typename}"),
    (error: unknown) => error instanceof ShopeeTransientError
  );
  await assert.rejects(
    client({ status: 200, text: graphError(10010) }).shopee.query("{__typename}"),
    (error: unknown) => error instanceof ShopeeRequestError
  );
  await assert.rejects(
    client({ status: 200, text: graphError(11001) }).shopee.query("{__typename}"),
    (error: unknown) => error instanceof ShopeeRequestError
  );
});

test("HTTP statuses map without parsing a body", async () => {
  await assert.rejects(
    client({ status: 429, text: "" }).shopee.query("{__typename}"),
    (error: unknown) => error instanceof ShopeeRateLimitError
  );
  await assert.rejects(
    client({ status: 503, text: "" }).shopee.query("{__typename}"),
    (error: unknown) => error instanceof ShopeeTransientError
  );
  await assert.rejects(
    client({ status: 403, text: "" }).shopee.query("{__typename}"),
    (error: unknown) => error instanceof ShopeeAuthError
  );
});

test("a non-JSON body and a payload with neither data nor errors are request errors", async () => {
  await assert.rejects(
    client({ status: 200, text: "<html>maintenance</html>" }).shopee.query("{__typename}"),
    (error: unknown) => error instanceof ShopeeRequestError
  );
  await assert.rejects(
    client({ status: 200, text: "{}" }).shopee.query("{__typename}"),
    (error: unknown) => error instanceof ShopeeRequestError
  );
});

test("data and errors together are treated as a failure, not a partial success", async () => {
  const text = JSON.stringify({
    data: { productOfferV2: { nodes: [] } },
    errors: [{ message: "partial", extensions: { code: 10030 } }]
  });

  await assert.rejects(
    client({ status: 200, text }).shopee.query("{__typename}"),
    (error: unknown) => error instanceof ShopeeRateLimitError
  );
});

test("the secret never appears in an error message", async () => {
  const error = await client({ status: 200, text: JSON.stringify({ errors: [{ message: "nope", extensions: { code: 10020 } }] }) })
    .shopee.query("{__typename}")
    .catch((caught: unknown) => caught);

  assert.ok(error instanceof Error);
  assert.ok(!error.message.includes(CONFIG.secret));
});
