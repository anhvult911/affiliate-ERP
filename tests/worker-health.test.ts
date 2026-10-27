import assert from "node:assert/strict";
import { request } from "node:http";
import test from "node:test";

import { handleHealthRequest, startHealthServer } from "../workers/src/health";
import { createLogger } from "../workers/src/logger";

const NOW = 1_700_000_000_000;

test("GET /health reports ok, version and uptime", () => {
  const result = handleHealthRequest({
    method: "GET",
    url: "/health",
    version: "0.1.0",
    startedAt: NOW - 5_000,
    now: NOW
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, version: "0.1.0", uptimeSeconds: 5 });
});

test("a query string does not confuse the route", () => {
  const result = handleHealthRequest({
    method: "GET",
    url: "/health?probe=1",
    version: "1",
    startedAt: NOW,
    now: NOW
  });

  assert.equal(result.status, 200);
});

test("unknown paths are 404 and other methods are 405", () => {
  assert.equal(
    handleHealthRequest({ method: "GET", url: "/metrics", version: "1", startedAt: NOW, now: NOW }).status,
    404
  );
  assert.equal(
    handleHealthRequest({ method: "POST", url: "/health", version: "1", startedAt: NOW, now: NOW }).status,
    405
  );
});

test("HEAD is allowed (Docker healthchecks use it)", () => {
  assert.equal(
    handleHealthRequest({ method: "HEAD", url: "/health", version: "1", startedAt: NOW, now: NOW }).status,
    200
  );
});

test("the endpoint answers over a real socket", async () => {
  const server = await startHealthServer({
    port: 0,
    version: "9.9.9",
    logger: createLogger({ worker: "health-test" })
  });

  assert.ok(server);

  const body = await new Promise<string>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: server.port, path: "/health", method: "GET" }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        data += chunk;
      });
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.end();
  });

  const parsed = JSON.parse(body) as { ok: boolean; version: string };
  assert.equal(parsed.ok, true);
  assert.equal(parsed.version, "9.9.9");

  await server.close();
});

test("a negative port disables the server; 0 asks the OS", async () => {
  const server = await startHealthServer({
    port: 0,
    version: "1",
    logger: createLogger({ worker: "health-test" })
  }).catch(() => null);

  // startHealthServer treats 0 as "ask the OS"; disabling is done with a negative port.
  assert.ok(server);
  await server?.close();

  const disabled = await startHealthServer({
    port: -1,
    version: "1",
    logger: createLogger({ worker: "health-test" })
  });
  assert.equal(disabled, null);
});
