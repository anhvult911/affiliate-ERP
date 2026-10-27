import assert from "node:assert/strict";
import test from "node:test";

import { cronAuthHeaders, MissingTokenError, workerAuthHeaders } from "../scripts/lib/tokens";

test("worker routes get the worker token", () => {
  const headers = workerAuthHeaders({ WORKER_API_TOKEN: "wt", CRON_SECRET: "cs" });
  assert.equal(headers.authorization, "Bearer wt");
  assert.equal(headers["content-type"], "application/json");
});

test("cron routes prefer CRON_SECRET", () => {
  const headers = cronAuthHeaders({ WORKER_API_TOKEN: "wt", CRON_SECRET: "cs" });
  assert.equal(headers.authorization, "Bearer cs");
});

test("cron routes fall back to the worker token, as authorizeCron does", () => {
  const headers = cronAuthHeaders({ WORKER_API_TOKEN: "wt" });
  assert.equal(headers.authorization, "Bearer wt");
});

test("a blank secret counts as unset", () => {
  assert.equal(cronAuthHeaders({ WORKER_API_TOKEN: "wt", CRON_SECRET: "   " }).authorization, "Bearer wt");
  assert.throws(() => workerAuthHeaders({ WORKER_API_TOKEN: "  " }), MissingTokenError);
});

test("a missing token fails loudly instead of sending an empty header", () => {
  assert.throws(() => workerAuthHeaders({}), MissingTokenError);
  assert.throws(() => cronAuthHeaders({}), MissingTokenError);
});
