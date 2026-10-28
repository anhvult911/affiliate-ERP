/**
 * Deal-channel posting configuration (P5-1).
 *
 * The poster has three switches, all read at request time so a VPS can flip preview →
 * auto by editing the env file and restarting, without a deploy:
 *
 *   TELEGRAM_CHANNEL_ID   @username or -100… (the bot MUST be an admin of that channel,
 *                         otherwise Telegram answers 400 "chat not found"/"not enough
 *                         rights" and nothing is posted)
 *   DEAL_POST_MODE        preview (default) | auto
 *   DEAL_POSTS_PER_DAY    how many products one run may post (default 2)
 *
 * Preview is the default on purpose: a channel is public, and one broken post costs
 * credibility that a single operator cannot buy back.
 */

export type DealPostMode = "preview" | "auto";

export type DealEnvironment = Record<string, string | undefined>;

export type DealPosterConfig = {
  /** Normalised channel id, or null when unset/invalid. */
  channelId: string | null;
  mode: DealPostMode;
  perDay: number;
  /** What blocks posting, named as the environment variable to fix. */
  missing: string | null;
  /** Why a value was rejected, when it was set but unusable. */
  invalid: string | null;
};

export const DEFAULT_DEAL_POSTS_PER_DAY = 2;
export const MAX_DEAL_POSTS_PER_DAY = 10;

const NUMERIC_CHANNEL = /^-\d{5,}$/;
const USERNAME_CHANNEL = /^@[A-Za-z][A-Za-z0-9_]{3,}$/;

/**
 * `@deals_vn` and `-1001234567890` are the two forms the Bot API accepts. A positive
 * number is a *user* id, not a channel — accepting it would DM a stranger instead of
 * publishing, so it is rejected with a reason.
 */
export function normalizeChannelId(raw: string | null | undefined): string | null {
  const value = raw?.trim() ?? "";
  if (!value) return null;
  if (USERNAME_CHANNEL.test(value)) return value;
  if (NUMERIC_CHANNEL.test(value)) return value;
  return null;
}

export function readDealPosterConfig(env: DealEnvironment = process.env): DealPosterConfig {
  const rawChannel = env.TELEGRAM_CHANNEL_ID?.trim() ?? "";
  const channelId = normalizeChannelId(rawChannel);

  const mode: DealPostMode = (env.DEAL_POST_MODE?.trim().toLowerCase() === "auto" ? "auto" : "preview");

  const rawPerDay = Number.parseInt(env.DEAL_POSTS_PER_DAY?.trim() ?? "", 10);
  const perDay =
    Number.isFinite(rawPerDay) && rawPerDay > 0
      ? Math.min(Math.floor(rawPerDay), MAX_DEAL_POSTS_PER_DAY)
      : DEFAULT_DEAL_POSTS_PER_DAY;

  return {
    channelId,
    mode,
    perDay,
    missing: channelId ? null : "TELEGRAM_CHANNEL_ID",
    invalid:
      !channelId && rawChannel
        ? `TELEGRAM_CHANNEL_ID must be @channelusername or -100…, got "${rawChannel.slice(0, 24)}"`
        : null
  };
}
