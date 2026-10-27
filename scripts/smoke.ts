/**
 * Smoke test for every external integration (docs/TASKS.md P3-2).
 *
 *   npm run smoke            # or: pnpm smoke
 *
 * Answers one question per line: can this deployment talk to Supabase, Gemini, Shopee
 * and Telegram right now? It reads credentials from the environment (falling back to
 * .env.production/.env.local), prints only the last four characters of each secret, and
 * exits 1 if anything fails.
 *
 * Deliberately not a unit test: it hits the real services. The unit tests cover the
 * pieces of logic it borrows (probe classification, model chain, redaction).
 */
import { existsSync } from "node:fs";

import { ShopeeClient, ShopeeError } from "../src/lib/shopee/client";
import { describeShopeeConfig, isShopeeConfigured, readShopeeConfig } from "../src/lib/shopee/config";
import { runProductOfferProbe } from "../src/lib/shopee/probe";
import { describeEnv, hostOf, maskSecret } from "./lib/redact";

type Check = { name: string; ok: boolean; detail: string };

const TIMEOUT_MS = 20_000;
/** Gemini's flash tier answers 503 under load; one retry round separates that from a
 *  real configuration problem. Each attempt is bounded so the whole check stays short. */
const GEMINI_ATTEMPT_TIMEOUT_MS = 12_000;
const GEMINI_ROUNDS = 2;

function loadEnvironment(): void {
  for (const file of [".env.production", ".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    try {
      process.loadEnvFile(file);
    } catch {
      // A malformed file is reported by the checks that need it, not here.
    }
  }
}

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

async function withTimeout<T>(
  label: string,
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`${label} timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/* --------------------------------------------------------------- checks */

async function checkSupabase(): Promise<Check> {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    return { name: "supabase", ok: false, detail: `missing ${!url ? "NEXT_PUBLIC_SUPABASE_URL" : ""} ${!key ? "SUPABASE_SERVICE_ROLE_KEY" : ""}`.trim() };
  }

  return withTimeout("supabase", async (signal) => {
    const response = await fetch(`${url}/rest/v1/social_accounts?select=id&limit=1`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
      signal
    });

    if (!response.ok) {
      return { name: "supabase", ok: false, detail: `${hostOf(url)} → HTTP ${response.status}` };
    }

    const rows = (await response.json()) as unknown[];
    return { name: "supabase", ok: true, detail: `${hostOf(url)} reachable (${rows.length} account row)` };
  });
}

/** Mirrors the app's chain: the same model list, stopping at the first that answers. */
async function checkGemini(): Promise<Check> {
  const key = env("GEMINI_API_KEY");
  if (!key) return { name: "gemini", ok: false, detail: "missing GEMINI_API_KEY" };

  const models = [env("GEMINI_MODEL") || "gemini-3.1-flash-lite", "gemini-3.8-flash", "gemini-flash-lite-latest"];
  const attempts: string[] = [];

  for (let round = 1; round <= GEMINI_ROUNDS; round += 1) {
    for (const model of models) {
      try {
        const response = await withTimeout(
          "gemini",
          (signal) =>
            fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
              method: "POST",
              headers: { "content-type": "application/json", "x-goog-api-key": key },
              body: JSON.stringify({ contents: [{ parts: [{ text: "Reply with the single word: ok" }] }] }),
              signal
            }),
          GEMINI_ATTEMPT_TIMEOUT_MS
        );

        if (response.ok) {
          const note = round > 1 ? ` (round ${round})` : "";
          return { name: "gemini", ok: true, detail: `${model} answered${note} (key ${maskSecret(key)})` };
        }

        attempts.push(`${model} → HTTP ${response.status}`);
      } catch (error) {
        attempts.push(`${model} → ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (round < GEMINI_ROUNDS) await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  return { name: "gemini", ok: false, detail: attempts.join("; ") };
}

async function checkShopee(): Promise<Check> {
  if (!isShopeeConfigured()) {
    return { name: "shopee", ok: false, detail: "missing SHOPEE_AFFILIATE_APP_ID / SHOPEE_AFFILIATE_APP_SECRET" };
  }

  const config = readShopeeConfig();
  const client = new ShopeeClient(config);

  const outcome = await runProductOfferProbe(client);

  if (outcome.ok) {
    return {
      name: "shopee",
      ok: true,
      detail: `${describeShopeeConfig(config).endpoint} · appId ${maskSecret(config.appId)}`
    };
  }

  return {
    name: "shopee",
    ok: false,
    detail: `code ${outcome.code ?? "n/a"} — ${outcome.guidance}`
  };
}

async function checkTelegram(): Promise<Check> {
  const token = env("TELEGRAM_BOT_TOKEN");
  const chatId = env("TELEGRAM_CHAT_ID");
  if (!token) return { name: "telegram", ok: false, detail: "missing TELEGRAM_BOT_TOKEN" };
  if (!chatId) return { name: "telegram", ok: false, detail: "missing TELEGRAM_CHAT_ID" };

  const base = (env("TELEGRAM_API_BASE") || "https://api.telegram.org").replace(/\/$/, "");

  return withTimeout("telegram", async (signal) => {
    const me = await fetch(`${base}/bot${token}/getMe`, { signal });
    const meBody = (await me.json().catch(() => ({}))) as { ok?: boolean; result?: { username?: string } };

    if (!me.ok || !meBody.ok) {
      return { name: "telegram", ok: false, detail: `getMe → HTTP ${me.status}` };
    }

    // The chat must be reachable by this bot; a stale id is the usual misconfiguration.
    const chat = await fetch(`${base}/bot${token}/getChat?chat_id=${encodeURIComponent(chatId)}`, { signal });
    const chatBody = (await chat.json().catch(() => ({}))) as { ok?: boolean; description?: string };

    if (!chat.ok || !chatBody.ok) {
      return {
        name: "telegram",
        ok: false,
        detail: `@${meBody.result?.username ?? "?"} ok, but chat ${maskSecret(chatId)} unreachable: ${chatBody.description ?? `HTTP ${chat.status}`}`
      };
    }

    return {
      name: "telegram",
      ok: true,
      detail: `@${meBody.result?.username ?? "?"} · chat ${maskSecret(chatId)}`
    };
  });
}

/* ------------------------------------------------------------------ run */

async function main(): Promise<number> {
  loadEnvironment();

  console.log("smoke test — external integrations\n");

  const checks = [checkSupabase, checkGemini, checkShopee, checkTelegram];
  const results: Check[] = [];

  for (const check of checks) {
    try {
      results.push(await check());
    } catch (error) {
      results.push({
        name: check.name.replace("check", "").toLowerCase(),
        ok: false,
        detail: error instanceof ShopeeError || error instanceof Error ? error.message : String(error)
      });
    }
  }

  for (const result of results) {
    console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.name.padEnd(9)} ${result.detail}`);
  }

  const failed = results.filter((result) => !result.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);

  if (failed > 0) {
    console.log(
      "\nHints: missing keys come from .env.production (see .env.example); " +
        "shopee 10035 means access was never granted; telegram getChat fails when the bot was never messaged."
    );
  }

  // Surface the secrets that are configured, masked — helps spot a wrong .env quickly.
  console.log(
    "\n" +
      [
        describeEnv("GEMINI_API_KEY", env("GEMINI_API_KEY")),
        describeEnv("SUPABASE_SERVICE_ROLE_KEY", env("SUPABASE_SERVICE_ROLE_KEY")),
        describeEnv("TELEGRAM_BOT_TOKEN", env("TELEGRAM_BOT_TOKEN")),
        describeEnv("SHOPEE_AFFILIATE_APP_SECRET", env("SHOPEE_AFFILIATE_APP_SECRET"))
      ].join("  ")
  );

  return failed === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
