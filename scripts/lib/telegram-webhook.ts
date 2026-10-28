import { maskSecret } from "./redact";

/**
 * Webhook registration helpers (P5-3).
 *
 * The script that uses these prints to a terminal that ends up in shell history, CI logs
 * and screenshots. The webhook secret therefore never appears: it is reported with
 * `maskSecret`, and the registered URL is shown without its query string or any long
 * path segment that could be a token (tunnels often put one in the path).
 */

export const WEBHOOK_PATH = "/api/telegram/webhook";

export type WebhookUrlInput = { siteUrl: string | null | undefined };

export type WebhookUrlResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * `https://` is mandatory except on localhost, which is exactly what Telegram enforces for
 * setWebhook. An already-suffixed URL is accepted so a copy-paste does not register
 * `/api/telegram/webhook/api/telegram/webhook`.
 */
export function resolveWebhookUrl(input: WebhookUrlInput): WebhookUrlResult {
  const raw = input.siteUrl?.trim() ?? "";
  if (!raw) {
    return { ok: false, error: "NEXT_PUBLIC_SITE_URL is not set — it must be the public https origin." };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: `NEXT_PUBLIC_SITE_URL is not a valid URL: ${raw}` };
  }

  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";

  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocal)) {
    return {
      ok: false,
      error: `NEXT_PUBLIC_SITE_URL must be https (Telegram rejects ${parsed.protocol}//). Tunnel URLs are fine once they are https.`
    };
  }

  const pathname = parsed.pathname.replace(/\/+$/, "");
  const url = pathname.endsWith(WEBHOOK_PATH)
    ? `${parsed.origin}${pathname}`
    : `${parsed.origin}${pathname}${WEBHOOK_PATH}`;

  return { ok: true, url };
}

/**
 * Shows what was registered without leaking it: query strings are dropped and long
 * segments (tokens) are masked. A webhook URL is not a secret by itself, but a tunnel URL
 * with a token in the path is a capability.
 */
export function maskWebhookUrl(value: string | null | undefined): string {
  if (!value) return "(unset)";

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "(invalid url)";
  }

  const segments = parsed.pathname
    .split("/")
    .map((segment) => (segment.length >= 20 ? maskSecret(segment) : segment))
    .join("/");

  return `${parsed.origin}${segments}${parsed.search ? "?…" : ""}`;
}

export type WebhookEnvCheck =
  | { ok: true; siteUrl: string; secret: string; botToken: string }
  | { ok: false; missing: string[] };

/** Names the missing variables, in the order the operator should fill them. */
export function checkWebhookEnv(env: Record<string, string | undefined>): WebhookEnvCheck {
  const siteUrl = env.NEXT_PUBLIC_SITE_URL?.trim() ?? "";
  const secret = env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? "";
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim() ?? "";

  const missing: string[] = [];
  if (!siteUrl) missing.push("NEXT_PUBLIC_SITE_URL");
  if (!secret) missing.push("TELEGRAM_WEBHOOK_SECRET");
  if (!botToken) missing.push("TELEGRAM_BOT_TOKEN");

  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, siteUrl, secret, botToken };
}

export type WebhookInfoSummary = {
  url: string;
  pendingUpdates: number;
  lastError: string | null;
  lastErrorAt: string | null;
  ipAddress: string | null;
  allowedUpdates: string[];
};

/** Shapes `getWebhookInfo` for a terminal: no token, no secret. */
export function summarizeWebhookInfo(result: unknown): WebhookInfoSummary {
  const info =
    result && typeof result === "object" && "result" in result
      ? ((result as { result?: Record<string, unknown> }).result ?? {})
      : {};

  const pending = info.pending_update_count;
  const allowed = info.allowed_updates;

  return {
    url: maskWebhookUrl(typeof info.url === "string" ? info.url : ""),
    pendingUpdates: typeof pending === "number" ? pending : 0,
    lastError: typeof info.last_error_message === "string" ? info.last_error_message : null,
    lastErrorAt:
      typeof info.last_error_date === "number"
        ? new Date(info.last_error_date * 1_000).toISOString()
        : null,
    ipAddress: typeof info.ip_address === "string" ? info.ip_address : null,
    allowedUpdates: Array.isArray(allowed) ? allowed.map(String) : []
  };
}
