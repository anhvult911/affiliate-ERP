/**
 * Caption rendering for the deal channel (P5-1).
 *
 * Two things matter here:
 *
 *   1. The channel is public and the text is HTML-parsed by Telegram, so every value
 *      that comes from the database (product name, price, link) is escaped. A product
 *      named "Tai nghe <2 củ>" would otherwise break the whole message.
 *   2. The caption is what the operator approves in preview mode and what gets posted,
 *      so it is produced once and kept verbatim (products.deal_caption).
 */

/** Telegram rejects text bodies over this length. */
export const TELEGRAM_TEXT_LIMIT = 4096;

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** `199000` → `199.000 ₫`. Returns null when there is no usable price. */
export function formatVnd(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  const rounded = Math.round(parsed);
  const grouped = rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  return `${grouped} ₫`;
}

export type DealProduct = {
  name: string;
  price: number | string | null;
  affiliate_short_link: string | null;
};

/**
 * Static fallback, used when Gemini is unconfigured or failing. It only states what is in
 * the row — no invented discount, no invented specs.
 */
export function buildDealCaption(product: DealProduct): string {
  const price = formatVnd(product.price);
  const link = product.affiliate_short_link?.trim() ?? "";

  return [
    `🔥 <b>${escapeHtml(product.name.trim())}</b>`,
    "",
    ...(price ? [`💰 Giá: <b>${price}</b>`] : []),
    "👉 Đặt hàng qua link này để ủng hộ kênh:",
    escapeHtml(link),
    "",
    "#deal #shopee"
  ].join("\n");
}

/** Preview wrapper shown in the operator chat; the buttons decide what happens next. */
export function buildDealPreview(caption: string): string {
  return `${caption}\n\n<i>Bản nháp — bấm Đăng để gửi lên kênh.</i>`;
}

/** Hard cap so a chatty model cannot make Telegram reject the message. */
export function trimForTelegram(text: string, limit = TELEGRAM_TEXT_LIMIT): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  // Leave room for the ellipsis without splitting a surrogate pair.
  return `${trimmed.slice(0, limit - 1)}…`;
}

/** The approved draft wins; it is what the operator saw. */
export function resolveDealCaption(product: DealProduct, generated: string | null): string {
  const draft = generated?.trim() ?? "";
  return draft.length > 0 ? trimForTelegram(draft) : buildDealCaption(product);
}
