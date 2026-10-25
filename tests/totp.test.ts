import assert from "node:assert/strict";
import test from "node:test";

import { decodeBase32, generateTotp, TOTP_PERIOD_SECONDS } from "@/lib/accounts/totp";

/**
 * RFC 6238 Appendix B vectors. The secret is the ASCII string
 * "12345678901234567890", encoded as base32.
 */
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("matches the RFC 6238 vectors (6-digit truncation)", () => {
  // The document lists 8-digit values; this implementation is 6-digit, so the
  // expected value is the same counter with the leading digits kept.
  assert.equal(generateTotp(RFC_SECRET, 59_000).code, "287082");
  assert.equal(generateTotp(RFC_SECRET, 1_111_111_109_000).code, "081804");
  assert.equal(generateTotp(RFC_SECRET, 1_111_111_111_000).code, "050471");
});

test("the code changes when the 30-second window rolls over", () => {
  const before = generateTotp(RFC_SECRET, 60_000 - 1).code;
  const after = generateTotp(RFC_SECRET, 60_000).code;
  assert.notEqual(before, after);
});

test("reports the seconds left in the current window", () => {
  assert.equal(generateTotp(RFC_SECRET, 0).secondsRemaining, TOTP_PERIOD_SECONDS);
  assert.equal(generateTotp(RFC_SECRET, 29_000).secondsRemaining, 1);
  assert.equal(generateTotp(RFC_SECRET, 30_000).secondsRemaining, 30);
});

test("base32 decoding tolerates spaces, dashes, lowercase and padding", () => {
  const plain = decodeBase32(RFC_SECRET);
  assert.deepEqual(decodeBase32("gezd gnbv-gy3t qojq gezd gnbv gy3t qojq"), plain);
  assert.deepEqual(decodeBase32(`${RFC_SECRET}====`), plain);
});

test("a non-base32 secret is rejected instead of producing a plausible code", () => {
  assert.throws(() => generateTotp("NOT-BASE32-0189"), /base32/i);
  assert.throws(() => generateTotp(""), /empty/i);
});
