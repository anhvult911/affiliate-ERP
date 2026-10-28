import assert from "node:assert/strict";
import test from "node:test";

import {
  checkWebhookEnv,
  maskWebhookUrl,
  resolveWebhookUrl,
  summarizeWebhookInfo,
  WEBHOOK_PATH
} from "../scripts/lib/telegram-webhook";

test("a bare https origin gets the webhook path", () => {
  const result = resolveWebhookUrl({ siteUrl: "https://erp.example.com" });
  assert.deepEqual(result, { ok: true, url: `https://erp.example.com${WEBHOOK_PATH}` });
});

test("a trailing slash does not double the separator", () => {
  const result = resolveWebhookUrl({ siteUrl: "https://erp.example.com/" });
  assert.equal(result.ok && result.url, `https://erp.example.com${WEBHOOK_PATH}`);
});

test("a URL that already ends in the webhook path is not suffixed twice", () => {
  const url = `https://erp.example.com${WEBHOOK_PATH}`;
  const result = resolveWebhookUrl({ siteUrl: url });
  assert.equal(result.ok && result.url, url);
});

test("a tunnel URL keeps its random subdomain", () => {
  const result = resolveWebhookUrl({ siteUrl: "https://calm-river-1234.trycloudflare.com" });
  assert.equal(
    result.ok && result.url,
    `https://calm-river-1234.trycloudflare.com${WEBHOOK_PATH}`
  );
});

test("http is only allowed on localhost, because Telegram rejects the rest", () => {
  assert.equal(resolveWebhookUrl({ siteUrl: "http://localhost:3000" }).ok, true);
  assert.equal(resolveWebhookUrl({ siteUrl: "http://127.0.0.1:3000" }).ok, true);

  const publicHttp = resolveWebhookUrl({ siteUrl: "http://erp.example.com" });
  assert.equal(publicHttp.ok, false);
  assert.match(publicHttp.ok ? "" : publicHttp.error, /https/);
});

test("missing and malformed values name the variable instead of guessing", () => {
  const missing = resolveWebhookUrl({ siteUrl: "" });
  assert.equal(missing.ok, false);
  assert.match(missing.ok ? "" : missing.error, /NEXT_PUBLIC_SITE_URL/);

  const malformed = resolveWebhookUrl({ siteUrl: "not a url" });
  assert.equal(malformed.ok, false);
  assert.match(malformed.ok ? "" : malformed.error, /not a valid URL/);
});

test("the printed URL hides the query string and token-like path segments", () => {
  const masked = maskWebhookUrl(
    "https://tunnel.trycloudflare.com/abcdefghijklmnopqrstuvwxyz/api/telegram/webhook?token=SECRET-VALUE"
  );

  assert.equal(masked.includes("SECRET-VALUE"), false);
  assert.equal(masked.endsWith("?…"), true);
  assert.match(masked, /^https:\/\/tunnel\.trycloudflare\.com\//);
});

test("a missing or broken registered URL is described, not printed", () => {
  assert.equal(maskWebhookUrl(""), "(unset)");
  assert.equal(maskWebhookUrl("not a url"), "(invalid url)");
});

test("env checking names every missing variable", () => {
  const empty = checkWebhookEnv({});
  assert.equal(empty.ok, false);
  assert.deepEqual(empty.ok ? [] : empty.missing, [
    "NEXT_PUBLIC_SITE_URL",
    "TELEGRAM_WEBHOOK_SECRET",
    "TELEGRAM_BOT_TOKEN"
  ]);

  const partial = checkWebhookEnv({ NEXT_PUBLIC_SITE_URL: "https://x.test" });
  assert.deepEqual(partial.ok ? [] : partial.missing, [
    "TELEGRAM_WEBHOOK_SECRET",
    "TELEGRAM_BOT_TOKEN"
  ]);
});

test("a complete environment is accepted", () => {
  const env = checkWebhookEnv({
    NEXT_PUBLIC_SITE_URL: "https://x.test",
    TELEGRAM_WEBHOOK_SECRET: "s",
    TELEGRAM_BOT_TOKEN: "t"
  });

  assert.equal(env.ok, true);
});

test("getWebhookInfo is summarised without leaking the secret or the query", () => {
  const summary = summarizeWebhookInfo({
    ok: true,
    result: {
      url: "https://x.test/api/telegram/webhook?secret=LEAK",
      pending_update_count: 3,
      allowed_updates: ["message", "callback_query"],
      last_error_message: "Wrong response from the webhook: 401 Unauthorized"
    }
  });

  assert.equal(JSON.stringify(summary).includes("LEAK"), false);
  assert.equal(summary.pendingUpdates, 3);
  assert.deepEqual(summary.allowedUpdates, ["message", "callback_query"]);
  assert.match(summary.lastError ?? "", /401/);
});

test("an empty getWebhookInfo result still prints something usable", () => {
  const summary = summarizeWebhookInfo({ ok: true, result: {} });

  assert.equal(summary.url, "(unset)");
  assert.equal(summary.pendingUpdates, 0);
  assert.equal(summary.lastError, null);
  assert.deepEqual(summary.allowedUpdates, []);
});
