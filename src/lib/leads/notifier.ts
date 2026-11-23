import { LEAD_OWNER_ID } from "@/lib/leads/config";
import { isTelegramConfigured, sendMessage } from "@/lib/telegram/api";

/**
 * Lead alerting + the daily follow-up digest.
 *
 * One narrow interface so Phase 2 can add Zalo OA / webhook / Discord without
 * touching the classifier or the CRM. Phase 1 resolves every owner to the single
 * operator chat (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`); the factory is per-owner
 * so a second tenant only needs a different implementation, not a new call site.
 *
 * Formatting is pure and exported: the alert text is the operator's copy-ready
 * script, so its exact shape is a contract worth testing without a bot token.
 */

export type LeadAlertInput = {
  score: number;
  matched_category: string;
  group_name: string;
  post_url: string;
  summary: string;
  suggested_comment: string;
  suggested_dm: string;
};

export interface Notifier {
  /**
   * Delivers one instant alert. Rejects when nothing was delivered, so the pipeline
   * can set `alert_sent_at` only for a real send. The caller catches: a Telegram
   * outage must never break the radar loop.
   */
  sendAlert(input: LeadAlertInput): Promise<void>;
}

/** Telegram's hard text limit (the Bot API rejects 4097+ characters). */
export const TELEGRAM_TEXT_LIMIT = 4096;

/** Body budget per digest message: header + numbering always fit under the limit. */
const DIGEST_BODY_BUDGET = 3500;

const STATUS_LABEL: Record<string, string> = {
  replied: "Đã comment",
  sent_freebie: "Đã gửi freebie"
};

export type FollowupLead = {
  id?: string;
  group_name: string;
  post_url: string;
  /** Null only for a raw pending_review row; such rows never reach this job. */
  score: number | null;
  matched_category: string | null;
  summary: string | null;
  status: string;
  notes: string | null;
  next_followup_at: string | null;
};

/**
 * HTML-escapes and caps a value in one pass.
 *
 * The cap applies to the *escaped* output, which is what Telegram counts, and the
 * loop can only stop between characters — so a value made of `&` cannot produce a
 * half-written `&amp` that makes Telegram reject the whole message.
 */
function escapeAndClamp(value: string | null | undefined, max: number): string {
  const clean = (value ?? "").replace(/\s+/g, " ").trim();
  if (clean.length === 0 || max <= 0) return "";

  let out = "";
  for (const char of clean) {
    const escaped = char === "&" ? "&amp;" : char === "<" ? "&lt;" : char === ">" ? "&gt;" : char;
    if (out.length + escaped.length > max - 1) return `${out}…`;
    out += escaped;
  }
  return out;
}

function normalizeScore(score: number): number {
  if (!Number.isFinite(score)) return 1;
  return Math.min(5, Math.max(1, Math.round(score)));
}

/** Vietnam is UTC+7 year round, so both formatters shift the epoch instead of using a tz database. */
function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatVnDateTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const vn = new Date(date.getTime() + 7 * 3_600_000);
  return `${pad2(vn.getUTCDate())}/${pad2(vn.getUTCMonth() + 1)} ${pad2(vn.getUTCHours())}:${pad2(vn.getUTCMinutes())}`;
}

function formatVnDate(date: Date): string {
  const vn = new Date(date.getTime() + 7 * 3_600_000);
  return `${pad2(vn.getUTCDate())}/${pad2(vn.getUTCMonth() + 1)}`;
}

/**
 * The alert body from the spec. Kept clean enough to copy the comment/DM parts
 * straight into Facebook: no bot links, no tracking, no model preamble.
 */
export function buildLeadAlert(input: LeadAlertInput): string {
  const score = normalizeScore(input.score);
  const category = escapeAndClamp(input.matched_category, 80);
  const group = escapeAndClamp(input.group_name, 220);
  const url = escapeAndClamp(input.post_url, 600);
  const summary = escapeAndClamp(input.summary, 600);
  const comment = escapeAndClamp(input.suggested_comment, 1300);
  const dm = escapeAndClamp(input.suggested_dm, 900);

  return [
    `🔥 <b>Lead mới — [Score ${score}/5 | ${category}]</b>`,
    `<b>Nhóm:</b> ${group}`,
    `<b>Link:</b> ${url}`,
    "",
    `<b>Nhu cầu:</b> ${summary}`,
    "",
    "<b>--- Gợi ý Comment ---</b>",
    comment,
    "",
    "<b>--- Gợi ý Inbox ---</b>",
    dm
  ].join("\n");
}

function buildDigestEntry(lead: FollowupLead, index: number): string {
  const score = lead.score === null ? "?" : String(normalizeScore(lead.score));
  const category = escapeAndClamp(lead.matched_category, 60);
  const group = escapeAndClamp(lead.group_name, 200);
  const summary = escapeAndClamp(lead.summary, 400);
  const url = escapeAndClamp(lead.post_url, 500);
  const notes = escapeAndClamp(lead.notes, 250);
  const status = escapeAndClamp(STATUS_LABEL[lead.status] ?? lead.status, 40);
  const due = formatVnDateTime(lead.next_followup_at);

  return [
    `${index}. <b>[${score}/5 | ${category}]</b> ${status}`,
    `<b>Nhóm:</b> ${group}`,
    `<b>Nhu cầu:</b> ${summary}`,
    `<b>Link:</b> ${url}`,
    ...(notes ? [`<b>Ghi chú:</b> ${notes}`] : []),
    ...(due ? [`<b>Hẹn:</b> ${due}`] : []),
    ""
  ].join("\n");
}

/**
 * One digest per day, split into as many Telegram messages as it needs.
 *
 * A busy day can easily exceed 4096 characters, and Telegram rejects the *whole*
 * message rather than truncating — so entries are packed into chunks and every
 * chunk repeats the header with its page number.
 */
export function buildFollowupDigestMessages(leads: FollowupLead[], options: { now?: Date } = {}): string[] {
  if (leads.length === 0) return [];

  const entries = leads.map((lead, index) => buildDigestEntry(lead, index + 1));
  const chunks: string[][] = [];
  let current: string[] = [];
  let length = 0;

  for (const entry of entries) {
    if (current.length > 0 && length + entry.length > DIGEST_BODY_BUDGET) {
      chunks.push(current);
      current = [];
      length = 0;
    }
    current.push(entry);
    length += entry.length;
  }
  if (current.length > 0) chunks.push(current);

  const date = formatVnDate(options.now ?? new Date());

  return chunks.map((chunk, index) => {
    const page = chunks.length > 1 ? ` (${index + 1}/${chunks.length})` : "";
    return [
      `📋 <b>Follow-up lead ${date} — 09:00${page}</b>`,
      `${leads.length} lead cần theo dõi hôm nay`,
      "",
      ...chunk
    ].join("\n");
  });
}

export type FollowupDigestResult = {
  leads: number;
  messages: number;
  sent: number;
  failed: number;
  skipped: "TELEGRAM_NOT_CONFIGURED" | null;
};

/**
 * Sends the digest without throwing: the cron endpoint reports partial failure in
 * its JSON body, and a Telegram outage must not fail the scheduler with a stack
 * trace. No lead row is mutated here — the digest is a reminder, not a contact.
 */
export async function sendFollowupDigest(
  leads: FollowupLead[],
  options: { now?: Date } = {}
): Promise<FollowupDigestResult> {
  const messages = buildFollowupDigestMessages(leads, options);
  const result: FollowupDigestResult = {
    leads: leads.length,
    messages: messages.length,
    sent: 0,
    failed: 0,
    skipped: null
  };

  if (messages.length === 0) return result;

  if (!isTelegramConfigured()) {
    result.skipped = "TELEGRAM_NOT_CONFIGURED";
    return result;
  }

  for (const text of messages) {
    const response = await sendMessage(text);
    if (response?.ok) {
      result.sent += 1;
    } else {
      result.failed += 1;
      console.error("[telegram] follow-up digest message not delivered");
    }
  }

  return result;
}

/**
 * Phase 1 factory: the default owner uses the operator's Telegram chat. Any other
 * owner fails closed — a silent no-op would look like a delivery and let the
 * pipeline stamp `alert_sent_at` for an alert nobody received. Phase 2 replaces
 * this branch with real per-tenant channel config.
 */
export function createLeadNotifier(ownerId: string = LEAD_OWNER_ID): Notifier {
  if (ownerId !== LEAD_OWNER_ID) {
    return {
      async sendAlert(): Promise<void> {
        throw new Error(`No lead notifier is configured for owner "${ownerId}".`);
      }
    };
  }

  return {
    async sendAlert(input: LeadAlertInput): Promise<void> {
      if (!isTelegramConfigured()) {
        throw new Error("Telegram is not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID).");
      }

      const response = await sendMessage(buildLeadAlert(input));
      if (!response?.ok) {
        throw new Error("Telegram alert delivery failed.");
      }
    }
  };
}
