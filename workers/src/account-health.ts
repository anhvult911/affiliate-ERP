import type { Page } from "playwright";

/**
 * Account health as observed on the page after an attempt.
 *
 * `checkpoint` is terminal until a human clears it (the app enforces that: the
 * report API accepts cooldown/checkpoint but never `active`). `cooldown` is a
 * temporary self-imposed rest, which the worker sets when the platform pushes
 * back with a rate limit instead of a ban.
 */
export type AccountHealthSignal = {
  status: "cooldown" | "checkpoint";
  reason: string;
  cooldownMinutes?: number;
};

const CHECKPOINT_URL_PATTERNS = [
  /\/checkpoint/i,
  /\/login/i,
  /\/recover/i,
  /\/suspended/i,
  /two_factor|two-factor/i
];

const CHECKPOINT_TEXT_PATTERNS = [
  // English
  /unusual activity/i,
  /confirm your identity/i,
  /we.?ve detected/i,
  /temporarily locked/i,
  /your account has been (disabled|locked|suspended)/i,
  /verify your identity/i,
  // Vietnamese — the seeded accounts run a Vietnamese interface, and an
  // English-only list let a real checkpoint wall through.
  /hoạt động bất thường/i,
  /xác minh danh tính/i,
  /xác nhận danh tính/i,
  /chúng tôi đã phát hiện/i,
  /tài khoản (của bạn )?(đã bị )?(tạm khóa|tạm khoá|khóa|khoá|vô hiệu hóa|vô hiệu hoá)/i
];

const RATE_LIMIT_TEXT_PATTERNS = [
  // English
  /you.?re temporarily blocked/i,
  /temporarily blocked from commenting/i,
  /try again later/i,
  /too many (comments|posts|actions)/i,
  /slow down/i,
  // Vietnamese
  /tạm thời bị chặn/i,
  /bạn đang bị chặn/i,
  /thử lại sau/i,
  /quá nhiều (bình luận|bài viết|hành động)/i,
  /chậm lại/i
];

/**
 * Inspects the page (and the browser's own signals) for a checkpoint or a rate
 * limit. Returns null when the account looks healthy.
 */
export async function detectAccountHealth(page: Page): Promise<AccountHealthSignal | null> {
  const url = page.url();
  const checkpointUrl = CHECKPOINT_URL_PATTERNS.find((pattern) => pattern.test(url));
  if (checkpointUrl) {
    return { status: "checkpoint", reason: `Redirected to ${new URL(url).pathname} — the account needs a human.` };
  }

  const bodyText = await page
    .evaluate(() => document.body?.innerText?.slice(0, 6000) ?? "")
    .catch(() => "");

  const checkpointText = CHECKPOINT_TEXT_PATTERNS.find((pattern) => pattern.test(bodyText));
  if (checkpointText) {
    return {
      status: "checkpoint",
      reason: `Page shows a verification challenge (${checkpointText.source}).`
    };
  }

  const rateLimited = RATE_LIMIT_TEXT_PATTERNS.find((pattern) => pattern.test(bodyText));
  if (rateLimited) {
    return {
      status: "cooldown",
      reason: `Platform pushed back (${rateLimited.source}); resting the account.`,
      cooldownMinutes: 120
    };
  }

  return null;
}
