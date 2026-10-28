import {
  checkWebhookEnv,
  resolveWebhookUrl,
  summarizeWebhookInfo
} from "./lib/telegram-webhook";
import { loadScriptEnv, LOCAL_ENV_FILES } from "./lib/env";
import { maskSecret } from "./lib/redact";

/**
 * Registers the Telegram webhook against the current public origin (P5-3).
 *
 *   pnpm telegram:webhook            setWebhook + getWebhookInfo
 *   pnpm telegram:webhook --clear    deleteWebhook + getWebhookInfo (lúc dev)
 *
 * The secret is sent as `secret_token` and never printed. Telegram echoes it nowhere, so
 * a leaked terminal is limited to the URL — which is public by construction.
 */

const DEFAULT_API_BASE = "https://api.telegram.org";
const ALLOWED_UPDATES = ["message", "callback_query"];

function apiBase(): string {
  return (process.env.TELEGRAM_API_BASE?.trim() || DEFAULT_API_BASE).replace(/\/$/, "");
}

async function callTelegram(
  botToken: string,
  method: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; description?: string; result?: unknown }> {
  try {
    const response = await fetch(`${apiBase()}/bot${botToken}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000)
    });

    const body = (await response.json().catch(() => null)) as
      | { ok?: boolean; description?: string; result?: unknown }
      | null;

    if (!body) return { ok: false, description: `HTTP ${response.status} with a non-JSON body` };
    if (!response.ok || body.ok !== true) {
      return { ok: false, description: body.description ?? `HTTP ${response.status}` };
    }

    return { ok: true, result: body.result };
  } catch (error) {
    return { ok: false, description: error instanceof Error ? error.message : String(error) };
  }
}

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  loadScriptEnv(LOCAL_ENV_FILES);

  const clear = process.argv.includes("--clear");

  const env = checkWebhookEnv(process.env);
  if (!env.ok) {
    fail(
      [
        "Missing environment:",
        ...env.missing.map((name) => `  - ${name}`),
        "",
        env.missing.includes("NEXT_PUBLIC_SITE_URL")
          ? "NEXT_PUBLIC_SITE_URL must be the public https origin (a tunnel URL works while testing)."
          : "",
        env.missing.includes("TELEGRAM_WEBHOOK_SECRET")
          ? "Generate one with: openssl rand -hex 32 (the webhook route refuses updates without it)."
          : ""
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  console.log(`telegram webhook — bot ${maskSecret(env.botToken)} · secret ${maskSecret(env.secret)}`);

  if (clear) {
    const removed = await callTelegram(env.botToken, "deleteWebhook", { drop_pending_updates: false });
    if (!removed.ok) fail(`deleteWebhook failed: ${removed.description}`);
    console.log("✓ webhook removed");
  } else {
    const resolved = resolveWebhookUrl({ siteUrl: env.siteUrl });
    if (!resolved.ok) fail(resolved.error);

    const registered = await callTelegram(env.botToken, "setWebhook", {
      url: resolved.url,
      secret_token: env.secret,
      allowed_updates: ALLOWED_UPDATES,
      drop_pending_updates: false
    });

    if (!registered.ok) {
      fail(
        `setWebhook failed: ${registered.description}\n` +
          "  Common causes: the URL is not https, the host does not answer, or the tunnel is down."
      );
    }

    console.log(`✓ webhook registered: ${resolved.url}`);
  }

  const info = await callTelegram(env.botToken, "getWebhookInfo", {});
  if (!info.ok) fail(`getWebhookInfo failed: ${info.description}`);

  const summary = summarizeWebhookInfo(info);

  console.log("");
  console.log("webhook info");
  console.log(`  url            ${summary.url}`);
  console.log(`  pending        ${summary.pendingUpdates}`);
  console.log(`  allowed        ${summary.allowedUpdates.join(", ") || "(default)"}`);
  if (summary.lastError) {
    console.log(`  last error     ${summary.lastError} (${summary.lastErrorAt ?? "unknown time"})`);
  }
  console.log("");
  console.log("Share with the bot, then send /status to confirm the round-trip.");
}

main().catch((error: unknown) => {
  console.error("\n✗ Unexpected failure:", error instanceof Error ? error.message : error);
  process.exit(1);
});
