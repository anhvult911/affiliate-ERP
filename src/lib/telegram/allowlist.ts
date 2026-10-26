/**
 * Which chat may drive the bot (docs/REVIEW.md P2-3).
 *
 * The secret header proves *Telegram* sent the update, not that the operator did:
 * anyone who learns the bot's username can message it, and `/queue` would then push a
 * digest with live approve buttons into the operator's chat — noise at best, a mis-tap
 * that approves a post at worst.
 *
 * Pure functions so the rule is testable without a webhook request.
 */

/** The parts of a Telegram update this rule needs. */
export type ChatBearingUpdate = {
  message?: { chat: { id: number } };
  callback_query?: { message?: { chat: { id: number } } };
};

/** Chat id of a message or callback, or null when the update carries none. */
export function readUpdateChatId(update: ChatBearingUpdate): number | null {
  if (update.callback_query) return update.callback_query.message?.chat.id ?? null;
  if (update.message) return update.message.chat.id;
  return null;
}

/**
 * True only for the configured operator chat.
 *
 * An unknown or unparsable `TELEGRAM_CHAT_ID` means "no" — failing closed is the whole
 * point, and a misconfigured deployment should not fall back to answering everyone.
 */
export function isAllowedChat(chatId: number | null, allowedChatId: string | null | undefined): boolean {
  if (chatId === null) return false;
  if (!allowedChatId) return false;

  const allowed = Number(allowedChatId.trim());
  return Number.isFinite(allowed) && chatId === allowed;
}
