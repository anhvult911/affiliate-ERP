import assert from "node:assert/strict";
import test from "node:test";

import { describeEnv, hostOf, maskSecret } from "../scripts/lib/redact";

test("only the last four characters survive", () => {
  assert.equal(maskSecret("sk_live_ABCDEF1234"), "••••1234");
  assert.ok(!maskSecret("sk_live_ABCDEF1234").includes("ABCDEF"));
});

test("short and empty values are masked completely", () => {
  assert.equal(maskSecret("abc"), "••••");
  assert.equal(maskSecret("12345678"), "••••");
  assert.equal(maskSecret(""), "(empty)");
  assert.equal(maskSecret(null), "(unset)");
  assert.equal(maskSecret(undefined), "(unset)");
});

test("surrounding whitespace does not leak length", () => {
  assert.equal(maskSecret("   supersecretvalue   "), "••••alue");
});

test("env lines never contain the value", () => {
  const line = describeEnv("GEMINI_API_KEY", "AQ.abcdefghijklmnop");
  assert.equal(line, "GEMINI_API_KEY=••••mnop");
  assert.ok(!line.includes("abcdefghij"));
});

test("URL hosts are shown without paths or query strings", () => {
  assert.equal(hostOf("https://example.supabase.co/rest/v1/products?apikey=secret"), "example.supabase.co");
  assert.equal(hostOf("not a url"), "(invalid url)");
  assert.equal(hostOf(null), "(unset)");
});
