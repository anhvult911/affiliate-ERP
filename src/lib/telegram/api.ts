/**
 * Minimal Telegram Bot API client.
 *
 * Deliberately hand-rolled: four calls, no SDK, and `TELEGRAM_API_BASE` can be
 * pointed at a local stub — which is how the outbound path is verified without a
 * real bot token.
 */

const DEFAULT_API_BASE = "https://api.telegram.org";
const REQUEST_TIMEOUT_MS = 15_000;

export type InlineButton = { text: string; callback_data?: string; url?: string };

export type InlineKeyboard = { inline_keyboard: InlineButton[][] };

export type SendMessageResult = { ok: boolean; description?: string };

export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim() && process.env.TELEGRAM_CHAT_ID?.trim());
}

export function telegramChatId(): string | null {
  return process.env.TELEGRAM_CHAT_ID?.trim() || null;
}

function apiBase(): string {
  return (process.env.TELEGRAM_API_BASE?.trim() || DEFAULT_API_BASE).replace(/\/$/, "");
}

export function webhookSecret(): string | null {
  return process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || null;
}

async function call<T>(method: string, payload: Record<string, unknown>): Promise<T | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    console.warn(`[telegram] ${method} skipped: TELEGRAM_BOT_TOKEN is not set.`);
    return null;
  }

  try {
    const response = await fetch(`${apiBase()}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      console.error(`[telegram] ${method} failed with HTTP ${response.status}`, describe(body));
      return null;
    }

    return body as T;
  } catch (error) {
    // Telegram being unreachable must never break the radar or the worker report.
    console.error(`[telegram] ${method} threw`, error instanceof Error ? error.message : error);
    return null;
  }
}

function describe(body: unknown): string {
  if (body && typeof body === "object" && "description" in body) return String(body.description);
  return JSON.stringify(body)?.slice(0, 200) ?? "";
}

export function sendMessage(text: string, keyboard?: InlineKeyboard): Promise<SendMessageResult | null> {
  const chatId = telegramChatId();
  if (!chatId) return Promise.resolve(null);

  return call<SendMessageResult>("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: keyboard } : {})
  });
}

export function answerCallbackQuery(callbackQueryId: string, text: string): Promise<unknown | null> {
  return call("answerCallbackQuery", { callback_query_id: callbackQueryId, text, show_alert: false });
}

export function editMessageText(chatId: number, messageId: number, text: string): Promise<unknown | null> {
  return call("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  });
}
