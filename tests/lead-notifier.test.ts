import assert from "node:assert/strict";
import test from "node:test";

import {
  TELEGRAM_TEXT_LIMIT,
  buildFollowupDigestMessages,
  buildLeadAlert,
  createLeadNotifier,
  type FollowupLead,
  type LeadAlertInput
} from "@/lib/leads/notifier";

const ALERT: LeadAlertInput = {
  score: 5,
  matched_category: "sheets_excel",
  group_name: "Hội chủ shop Online",
  post_url: "https://www.facebook.com/groups/123/posts/456",
  summary: "Cần file Excel tính lãi lỗ cho shop quần áo.",
  suggested_comment: "Mình hay dùng Google Sheet để tính lãi lỗ theo đơn. Bạn đang bán trên sàn nào?",
  suggested_dm: "Mình gửi bạn file mẫu nhé. Shop bạn bán chủ yếu Shopee hay TikTok?"
};

function lead(overrides: Partial<FollowupLead> = {}): FollowupLead {
  return {
    group_name: "Hội chủ shop Online",
    post_url: "https://www.facebook.com/groups/123/posts/456",
    score: 4,
    matched_category: "automation",
    summary: "Muốn tự động gom đơn về Zalo.",
    status: "replied",
    notes: null,
    next_followup_at: "2026-11-20T02:00:00.000Z",
    ...overrides
  };
}

test("the alert carries every field the operator copies from", () => {
  const text = buildLeadAlert(ALERT);

  assert.match(text, /\[Score 5\/5 \| sheets_excel\]/);
  assert.match(text, /Hội chủ shop Online/);
  assert.match(text, /https:\/\/www\.facebook\.com\/groups\/123\/posts\/456/);
  assert.match(text, /Cần file Excel tính lãi lỗ/);
  assert.match(text, /--- Gợi ý Comment ---/);
  assert.match(text, /--- Gợi ý Inbox ---/);
  assert.match(text, /file mẫu/);
});

test("post content is HTML-escaped so Telegram never rejects the alert", () => {
  const text = buildLeadAlert({ ...ALERT, summary: "Cần <b>gấp</b> & file" });

  assert.match(text, /Cần &lt;b&gt;gấp&lt;\/b&gt; &amp; file/);
  assert.equal(text.includes("<b>gấp</b>"), false);
});

test("a wall of special characters cannot overflow Telegram's limit or split an entity", () => {
  const text = buildLeadAlert({
    ...ALERT,
    group_name: "&".repeat(2000),
    summary: "<".repeat(2000),
    suggested_comment: "&".repeat(5000),
    suggested_dm: ">".repeat(5000)
  });

  assert.ok(text.length <= TELEGRAM_TEXT_LIMIT, `got ${text.length} chars`);
  // Truncation happens between characters, never inside `&amp;` / `&lt;`.
  assert.equal(/&(?:amp|lt|gt)…/.test(text), false);
});

test("scores are clamped to the 1..5 scale Telegram renders", () => {
  assert.match(buildLeadAlert({ ...ALERT, score: 9 }), /Score 5\/5/);
  assert.match(buildLeadAlert({ ...ALERT, score: 0 }), /Score 1\/5/);
});

test("no due leads means no message at all", () => {
  assert.deepEqual(buildFollowupDigestMessages([]), []);
});

test("the digest shows status, due time in Vietnam time, notes and link", () => {
  const [text] = buildFollowupDigestMessages(
    [
      lead({ status: "replied" }),
      lead({ status: "sent_freebie", notes: "Đã hẹn gọi lại <chiều>", next_followup_at: "2026-11-21T03:30:00.000Z" })
    ],
    { now: new Date("2026-11-23T02:00:00.000Z") }
  );

  assert.ok(text);
  assert.match(text, /Follow-up lead 23\/11 — 09:00/);
  assert.match(text, /Đã comment/);
  assert.match(text, /Đã gửi freebie/);
  assert.match(text, /Hẹn:<\/b> 20\/11 09:00/);
  assert.match(text, /Hẹn:<\/b> 21\/11 10:30/);
  assert.match(text, /Đã hẹn gọi lại &lt;chiều&gt;/);
  assert.match(text, /https:\/\/www\.facebook\.com\/groups\/123\/posts\/456/);
});

test("a lead without notes omits the note line instead of printing 'null'", () => {
  const [text] = buildFollowupDigestMessages([lead()]);

  assert.ok(text);
  assert.equal(text.includes("Ghi chú"), false);
});

test("a busy day is split into numbered pages that each fit Telegram", () => {
  const leads = Array.from({ length: 24 }, (_, index) =>
    lead({
      group_name: `Nhóm ${index + 1}`,
      summary: `${index + 1}. `.padEnd(300, "x")
    })
  );

  const messages = buildFollowupDigestMessages(leads, { now: new Date("2026-11-23T02:00:00.000Z") });

  assert.ok(messages.length > 1);
  messages.forEach((message) => {
    assert.ok(message.length <= TELEGRAM_TEXT_LIMIT, `got ${message.length} chars`);
    assert.match(message, /Follow-up lead 23\/11 — 09:00 \(\d+\/\d+\)/);
  });

  assert.match(messages[0] ?? "", /\(1\/\d+\)/);
  assert.match(messages.at(-1) ?? "", new RegExp(`\\(${messages.length}\\/${messages.length}\\)`));

  const joined = messages.join("\n");
  for (let index = 1; index <= leads.length; index += 1) {
    assert.match(joined, new RegExp(`\\n${index}\\. <b>\\[4\\/5 \\| automation\\]</b>`));
  }
});

test("an unsupported owner fails closed instead of pretending an alert was sent", async () => {
  const notifier = createLeadNotifier("another_tenant");

  await assert.rejects(notifier.sendAlert(ALERT), /No lead notifier is configured/);
});
