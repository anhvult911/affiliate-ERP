import assert from "node:assert/strict";
import test from "node:test";

import { readPostbackBody } from "@/lib/worker/postback-body";

function jsonRequest(body: string): Request {
  return new Request("http://localhost/api/postback/shopee", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body
  });
}

test("a JSON body is parsed", async () => {
  const result = await readPostbackBody(jsonRequest(JSON.stringify({ sub_id: "S1", order_id: "O1" })));
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.body, { sub_id: "S1", order_id: "O1" });
});

test("an empty JSON body is left to the schema to reject", async () => {
  const result = await readPostbackBody(jsonRequest(""));
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.body, {});
});

test("malformed JSON is a 400, not a crash", async () => {
  const result = await readPostbackBody(jsonRequest("{not json"));
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.status, 400);
  assert.match(!result.ok ? result.error : "", /Invalid JSON/);
});

test("a JSON array is rejected (the schema expects an object)", async () => {
  const result = await readPostbackBody(jsonRequest("[1,2]"));
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : "", /must be an object/);
});

test("a form-encoded body is accepted", async () => {
  const request = new Request("http://localhost/api/postback/shopee", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "sub_id=S1&order_id=O1&status=settled"
  });

  const result = await readPostbackBody(request);
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.body, { sub_id: "S1", order_id: "O1", status: "settled" });
});

test("the content type is matched case-insensitively and with parameters", async () => {
  const request = new Request("http://localhost/api/postback/shopee", {
    method: "POST",
    headers: { "content-type": "Application/JSON; charset=utf-8" },
    body: JSON.stringify({ order_id: "O1" })
  });

  const result = await readPostbackBody(request);
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.body, { order_id: "O1" });
});
