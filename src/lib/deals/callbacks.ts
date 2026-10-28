import type { InlineKeyboard } from "@/lib/telegram/api";

/**
 * The preview buttons are a contract between two places: the cron route renders them and
 * the webhook parses them. Kept together so a change to one cannot silently orphan the
 * other. Telegram caps `callback_data` at 64 bytes — a uuid plus the verb fits with room
 * to spare.
 */

export type DealCallbackVerb = "post" | "skip";

export type DealCallback = { verb: DealCallbackVerb; productId: string };

export const DEAL_CALLBACK_PREFIX = "deal:";

export function dealCallbackData(verb: DealCallbackVerb, productId: string): string {
  return `${DEAL_CALLBACK_PREFIX}${verb}:${productId}`;
}

export function dealPreviewKeyboard(productId: string): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: "✅ Đăng", callback_data: dealCallbackData("post", productId) },
        { text: "🚫 Bỏ qua", callback_data: dealCallbackData("skip", productId) }
      ]
    ]
  };
}

export function isDealCallback(data: string): boolean {
  return data.startsWith(DEAL_CALLBACK_PREFIX);
}

export function parseDealCallback(data: string): DealCallback | null {
  if (!isDealCallback(data)) return null;

  const [verb, productId] = data.slice(DEAL_CALLBACK_PREFIX.length).split(":");
  if ((verb !== "post" && verb !== "skip") || !productId) return null;

  return { verb, productId };
}
