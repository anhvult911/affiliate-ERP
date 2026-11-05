import type { DealPostMode } from "@/lib/deals/config";

/**
 * Product selection for the deal channel (P5-1).
 *
 * The query in the route is deliberately coarse (active + has an affiliate link, ordered
 * by commission rate) and everything that decides "which product today" lives here, so
 * the rules are testable without a database:
 *
 *   - a product posted within `cooldownDays` is skipped, so the channel never repeats;
 *   - preview mode also skips a product previewed within `previewCooldownHours`, because
 *     the cron runs twice a day and the operator must not be asked twice;
 *   - ties break on price and then id, so two runs with the same data pick the same rows.
 */

export type DealCandidateRow = {
  id: string;
  name: string;
  price: number | string | null;
  commission_rate: number | string | null;
  affiliate_short_link: string | null;
  last_dealt_at: string | null;
  deal_previewed_at: string | null;
};

export type DealSelectionOptions = {
  now: Date;
  perDay: number;
  mode: DealPostMode;
  cooldownDays?: number;
  previewCooldownHours?: number;
};

export const DEAL_COOLDOWN_DAYS = 7;
export const DEAL_PREVIEW_COOLDOWN_HOURS = 20;

function toNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Invalid timestamps are treated as "never", so a bad row is still postable. */
function elapsedMs(since: string | null, now: Date): number | null {
  if (!since) return null;
  const at = Date.parse(since);
  if (!Number.isFinite(at)) return null;
  return now.getTime() - at;
}

/**
 * True while a product is still inside its cooldown window.
 *
 * Exported because the Telegram preview buttons are a second, older entry point: a preview
 * sent before the operator switched to `auto` keeps a live "Đăng" button in the chat, and
 * pressing it later would publish a product that is already on the channel.
 */
/**
 * The instant a product becomes postable again. Used as the guard in the atomic claim, so
 * two concurrent runs cannot both decide "this row was never dealt".
 */
export function dealCooldownCutoff(now: Date, cooldownDays: number = DEAL_COOLDOWN_DAYS): string {
  return new Date(now.getTime() - cooldownDays * 24 * 3_600_000).toISOString();
}

export function isDealCoolingDown(
  lastDealtAt: string | null,
  now: Date,
  cooldownDays: number = DEAL_COOLDOWN_DAYS
): boolean {
  const elapsed = elapsedMs(lastDealtAt, now);
  return elapsed !== null && elapsed < cooldownDays * 24 * 3_600_000;
}

export function pickDealCandidates(
  rows: DealCandidateRow[],
  options: DealSelectionOptions
): DealCandidateRow[] {
  const cooldownMs = (options.cooldownDays ?? DEAL_COOLDOWN_DAYS) * 24 * 3_600_000;
  const previewMs = (options.previewCooldownHours ?? DEAL_PREVIEW_COOLDOWN_HOURS) * 3_600_000;

  return rows
    .filter((row) => Boolean(row.affiliate_short_link?.trim()))
    .filter((row) => {
      const dealt = elapsedMs(row.last_dealt_at, options.now);
      return dealt === null || dealt >= cooldownMs;
    })
    .filter((row) => {
      if (options.mode !== "preview") return true;
      const previewed = elapsedMs(row.deal_previewed_at, options.now);
      return previewed === null || previewed >= previewMs;
    })
    .sort((a, b) => {
      const commission = (toNumber(b.commission_rate) ?? -1) - (toNumber(a.commission_rate) ?? -1);
      if (commission !== 0) return commission;

      const price = (toNumber(b.price) ?? -1) - (toNumber(a.price) ?? -1);
      if (price !== 0) return price;

      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, Math.max(0, Math.floor(options.perDay)));
}
