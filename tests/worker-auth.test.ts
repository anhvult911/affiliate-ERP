import assert from "node:assert/strict";
import test from "node:test";

import { readBearerToken, secureCompare } from "@/lib/security/constant-time";
import { authorizeWorker } from "@/lib/worker/auth";

const TOKEN = "local-dev-worker-token";

function withWorkerToken<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.WORKER_API_TOKEN;

  if (value === undefined) delete process.env.WORKER_API_TOKEN;
  else process.env.WORKER_API_TOKEN = value;

  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.WORKER_API_TOKEN;
    else process.env.WORKER_API_TOKEN = previous;
  }
}

function request(authorization?: string): Request {
  return new Request("http://localhost/api/worker/tasks/claim", {
    method: "POST",
    headers: authorization ? { authorization } : {}
  });
}

test("secureCompare accepts only the exact value", () => {
  assert.equal(secureCompare(TOKEN, TOKEN), true);
  assert.equal(secureCompare(TOKEN, `${TOKEN} `), false);
  assert.equal(secureCompare(`${TOKEN}x`, TOKEN), false);
  assert.equal(secureCompare("", TOKEN), false);
  assert.equal(secureCompare("", ""), true);
});

test("secureCompare is not confused by a shared prefix or a different length", () => {
  assert.equal(secureCompare("local-dev-worker-toke", TOKEN), false);
  assert.equal(secureCompare("local-dev-worker-tokenX", TOKEN), false);
  assert.equal(secureCompare("L".repeat(TOKEN.length), TOKEN), false);
});

test("readBearerToken extracts the token and rejects other schemes", () => {
  assert.equal(readBearerToken(`Bearer ${TOKEN}`), TOKEN);
  assert.equal(readBearerToken(`Bearer   ${TOKEN}  `), TOKEN);
  assert.equal(readBearerToken(`bearer ${TOKEN}`), "");
  assert.equal(readBearerToken(`Basic ${TOKEN}`), "");
  assert.equal(readBearerToken("Bearer"), "");
  assert.equal(readBearerToken(null), "");
});

test("authorizeWorker returns 503 when the server has no token configured", () => {
  withWorkerToken(undefined, () => {
    const result = authorizeWorker(request(`Bearer ${TOKEN}`));
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.response.status, 503);
  });
});

test("authorizeWorker rejects a missing, malformed or wrong token", () => {
  withWorkerToken(TOKEN, () => {
    for (const header of [undefined, "", "Bearer", `Bearer ${TOKEN}x`, `Basic ${TOKEN}`, "Bearer wrong"]) {
      const result = authorizeWorker(request(header));
      assert.equal(result.ok, false, `header ${String(header)} must be rejected`);
      assert.equal(!result.ok && result.response.status, 401);
    }
  });
});

test("authorizeWorker accepts the configured token", () => {
  withWorkerToken(TOKEN, () => {
    const result = authorizeWorker(request(`Bearer ${TOKEN}`));
    assert.equal(result.ok, true);
  });
});

test("the token from the environment is trimmed before comparison", () => {
  withWorkerToken(`  ${TOKEN}  `, () => {
    assert.equal(authorizeWorker(request(`Bearer ${TOKEN}`)).ok, true);
  });
});
