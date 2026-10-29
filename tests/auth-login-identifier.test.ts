import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_AUTH_EMAIL_DOMAIN,
  resolveLoginEmail,
  signInSchema
} from "@/lib/validations/auth";

test("a bare username maps to the internal domain", () => {
  assert.equal(resolveLoginEmail("admin"), `admin@${DEFAULT_AUTH_EMAIL_DOMAIN}`);
  assert.equal(resolveLoginEmail("  Admin  "), `admin@${DEFAULT_AUTH_EMAIL_DOMAIN}`);
});

test("a full email is used unchanged (lowercased)", () => {
  assert.equal(resolveLoginEmail("op@local.test"), "op@local.test");
  assert.equal(resolveLoginEmail("Op@Local.Test"), "op@local.test");
});

test("the domain is configurable, with or without a leading @", () => {
  assert.equal(resolveLoginEmail("admin", "example.com"), "admin@example.com");
  assert.equal(resolveLoginEmail("admin", "@example.com"), "admin@example.com");
  assert.equal(resolveLoginEmail("admin", "   "), `admin@${DEFAULT_AUTH_EMAIL_DOMAIN}`);
});

test("empty input stays empty so the schema reports it", () => {
  assert.equal(resolveLoginEmail("   "), "");
});

test("the form schema accepts a username and yields the email Supabase needs", () => {
  const parsed = signInSchema.safeParse({ email: "admin", password: "Rubytony@2026" });

  assert.equal(parsed.success, true);
  assert.equal(parsed.success && parsed.data.email, `admin@${DEFAULT_AUTH_EMAIL_DOMAIN}`);
  assert.equal(parsed.success && parsed.data.password, "Rubytony@2026");
});

test("an email still parses, so existing operator accounts keep working", () => {
  const parsed = signInSchema.safeParse({ email: "op@local.test", password: "localdev123" });

  assert.equal(parsed.success, true);
  assert.equal(parsed.success && parsed.data.email, "op@local.test");
});

test("an unusable identifier is rejected with a readable message", () => {
  const blank = signInSchema.safeParse({ email: "", password: "secret123" });
  assert.equal(blank.success, false);
  assert.match(blank.success ? "" : blank.error.issues[0]!.message, /Nhập tài khoản/);

  const spaced = signInSchema.safeParse({ email: "ad min", password: "secret123" });
  assert.equal(spaced.success, false);
  assert.match(spaced.success ? "" : spaced.error.issues[0]!.message, /không hợp lệ/);

  const short = signInSchema.safeParse({ email: "admin", password: "123" });
  assert.equal(short.success, false);
});
