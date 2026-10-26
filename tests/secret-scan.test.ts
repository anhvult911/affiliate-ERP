import assert from "node:assert/strict";
import test from "node:test";

import { scanText, shouldScan } from "@/lib/security/secret-scan";

/**
 * Sample secrets are assembled at runtime so this file does not itself trip the
 * pre-commit scan it is testing.
 */
const base32 = "JBSW" + "Y3DP" + "EHPK" + "3PXP" + "MFRG" + "GZDF" + "MZTW" + "Q2LK";
const jwt = ["eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", "eyJyb2xlIjoic2VydmljZV9yb2xlIn0", "c2lnbmF0dXJlLXZhbHVl"].join(".");
const telegram = ["123456789", "AAH" + "q1w2e3r4t5y6u7i8o9p0asdfghjklzxcvb"].join(":");
const google = "AIza" + "SyD9kQ2mN4pR6sT8uV0wX2yZ4aB6cD8eF0g";
const proxyA = ["10.0.0.1:8080", "user", "secret"].join(":");
const proxyB = ["41.9.18.22:3128", "operator", "hunter2"].join(":");

test("flags an operator account export line", () => {
  const findings = scanText("uid|pass|2FA|proxy\n123456789012|somepassword|" + base32 + "|" + proxyA);
  assert.ok(findings.some((finding) => finding.kind === "account-export-line"));
});

test("flags a standalone base32 secret", () => {
  const findings = scanText(`const secret = "${base32}";`);
  assert.equal(findings[0]?.kind, "base32-secret");
});

test("flags proxy credentials, tokens and keys", () => {
  assert.ok(scanText(`proxy=${proxyB}`).some((f) => f.kind === "proxy-credentials"));
  assert.ok(scanText(`token ${telegram}`).some((f) => f.kind === "telegram-bot-token"));
  assert.ok(scanText(`key ${google}`).some((f) => f.kind === "google-api-key"));
  assert.ok(scanText(`apikey=${jwt}`).some((f) => f.kind === "supabase-jwt"));
});

test("accepts the fixtures the review prescribed", () => {
  const fixture =
    "00000000000000|matkhau|AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA|127.0.0.1:8080";
  // 127.0.0.1:8080 has no credentials, and AAAA… / matkhau are documentation.
  assert.deepEqual(scanText(fixture), []);
});

test("accepts ordinary code and placeholders", () => {
  const code = [
    "const limit = 8;",
    "const url = 'https://example.com/profile';",
    "GEMINI_API_KEY=\"your-gemini-api-key\"",
    "TELEGRAM_BOT_TOKEN=\"123456:replace-me\""
  ].join("\n");
  assert.deepEqual(scanText(code), []);
});

test("the allow marker documents a pattern without tripping the hook", () => {
  const line = `example secret ${base32}  // secret-scan:allow`;
  assert.deepEqual(scanText(line), []);
});

test("findings never reproduce the secret", () => {
  const findings = scanText(`k=${google}`);
  assert.equal(findings.length, 1);
  assert.ok(!findings[0]?.preview.includes(google.slice(8)));
});

test("only text files under the project are scanned", () => {
  assert.equal(shouldScan("src/lib/accounts/credential-format.ts"), true);
  assert.equal(shouldScan("workers/assets/me_bim/avatar.png"), false);
  assert.equal(shouldScan("workers/.profiles/x/Default/History"), false);
  assert.equal(shouldScan(".env.local"), false);
  assert.equal(shouldScan("node_modules/next/index.js"), false);
});
