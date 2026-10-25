import type { InlineButton, InlineKeyboard } from "@/lib/telegram/api";
import { formatMatchScore, formatRelative, formatVnd } from "@/lib/format";
import { TASK_STATUS_LABEL, type AccountStatus, type TaskStatus } from "@/lib/constants";

/**
 * Message builders. Pure functions so the exact text and buttons can be asserted
 * without a bot token — the webhook and the notifiers only ship them.
 */

export type CaptureView = {
  taskId: string;
  sourceName: string | null;
  productName: string | null;
  productPrice: number | null;
  matchScore: number | null;
  draft: string | null;
  postUrl: string;
  createdAt: string;
};

export type StatusView = {
  counts: Record<TaskStatus, number> & { total: number };
  accounts: Record<AccountStatus, number>;
  lastActionAt: string | null;
  runningTasks: number;
};

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/**
 * Absolute dashboard URL for an inline button, or null when it would be rejected.
 *
 * Telegram refuses `http://` and non-public hosts in inline-keyboard URLs, and one
 * bad button fails the entire `sendMessage` — so a localhost install must degrade
 * to callback-only buttons instead of sending nothing at all. Set
 * `NEXT_PUBLIC_SITE_URL` to the deployed https URL to get the link buttons back.
 */
function appUrl(path: string): string | null {
  const base = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "").replace(/\/$/, "");
  if (!base) return null;

  try {
    const url = new URL(base);
    if (url.protocol !== "https:") return null;
    if (PRIVATE_HOSTS.some((pattern) => pattern.test(url.hostname))) return null;
    return `${base}${path}`;
  } catch {
    return null;
  }
}

const PRIVATE_HOSTS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /\.local$/i
];

/** A URL button only when the URL is usable; otherwise nothing (never a broken send). */
function urlButton(text: string, path: string): InlineButton[] {
  const url = appUrl(path);
  return url ? [{ text, url }] : [];
}

/** One capture: draft inline, so approving is a single tap from the lock screen. */
export function buildCaptureMessage(capture: CaptureView): { text: string; keyboard: InlineKeyboard } {
  const lines = [
    "🎯 <b>Bài viết mới đủ điều kiện</b>",
    "",
    `<b>Nguồn:</b> ${escapeHtml(capture.sourceName ?? "không rõ")}`,
    `<b>Sản phẩm:</b> ${escapeHtml(capture.productName ?? "chưa match")}${
      capture.productPrice ? ` · ${escapeHtml(formatVnd(capture.productPrice))}` : ""
    }`,
    `<b>Độ khớp:</b> ${escapeHtml(formatMatchScore(capture.matchScore))} · ${escapeHtml(formatRelative(capture.createdAt))}`,
    ""
  ];

  if (capture.draft) {
    lines.push("<b>Nháp AI:</b>", escapeHtml(truncate(capture.draft, 600)), "");
  } else {
    lines.push("<i>Chưa có nháp — mở app để viết hoặc tạo bằng Gemini.</i>", "");
  }

  lines.push(`<a href="${escapeHtml(capture.postUrl)}">Bài gốc</a>`);

  /*
   * A capture without a draft cannot be approved — the action would answer
   * "there is no AI draft yet". Offering the button anyway is a dead end, so the
   * primary action becomes "open it and write one" instead.
   */
  const primaryRow: InlineButton[] = capture.draft
    ? [{ text: "✅ Duyệt & chạy", callback_data: `approve:${capture.taskId}` }]
    : urlButton("✍️ Viết nháp trong app", `/queue?task=${capture.taskId}`);

  return {
    text: lines.join("\n"),
    keyboard: {
      inline_keyboard: [
        [...primaryRow, { text: "🚫 Từ chối", callback_data: `reject:${capture.taskId}` }],
        urlButton("🔍 Mở trong app", `/queue?task=${capture.taskId}`)
      ].filter((row) => row.length > 0)
    }
  };
}

/** Queue digest for `/queue`: the five oldest pending captures, each with actions. */
export function buildQueueMessage(captures: CaptureView[], counts: Record<TaskStatus, number>): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const header = [
    "📋 <b>Hàng chờ duyệt</b>",
    "",
    `Chờ duyệt: <b>${counts.pending_approval}</b> · Đã xếp: ${counts.queued} · Đang chạy: ${counts.running}`,
    `Xong: ${counts.completed} · Lỗi: ${counts.failed} · Đã bỏ: ${counts.rejected}`,
    ""
  ];

  if (captures.length === 0) {
    return {
      text: [...header, "Không có bài nào đang chờ. Radar vẫn đang quét."].join("\n"),
      keyboard: { inline_keyboard: [[{ text: "🔄 Làm mới", callback_data: "queue:refresh" }]] }
    };
  }

  const rows = captures.map((capture, index) => {
    const label = `${index + 1}. ${truncate(capture.productName ?? capture.sourceName ?? "bài viết", 28)} · ${formatMatchScore(capture.matchScore)}`;
    return urlButton(label, `/queue?task=${capture.taskId}`);
  });

  const actions = captures.flatMap((capture, index) => [
    [
      { text: `✅ Duyệt #${index + 1}`, callback_data: `approve:${capture.taskId}` },
      { text: `🚫 Bỏ #${index + 1}`, callback_data: `reject:${capture.taskId}` }
    ]
  ]);

  return {
    text: [...header, ...captures.map((capture, index) => `${index + 1}. ${escapeHtml(truncate(capture.draft ?? capture.postUrl, 70))}`)].join("\n"),
    keyboard: {
      inline_keyboard: [...rows, ...actions].filter((row) => row.length > 0)
    }
  };
}

/** `/status`: is the machine actually working? One tap answers it. */
export function buildStatusMessage(status: StatusView): { text: string; keyboard: InlineKeyboard } {
  const workerActivity =
    status.runningTasks > 0
      ? `⏳ ${status.runningTasks} task đang chạy`
      : status.lastActionAt
        ? `🕒 Hoạt động gần nhất: ${formatRelative(status.lastActionAt)}`
        : "⚠️ Chưa có hoạt động nào — worker có thể chưa chạy";

  const text = [
    "⚙️ <b>Tình trạng hệ thống</b>",
    "",
    `Chờ duyệt: <b>${status.counts.pending_approval}</b>`,
    `Đã xếp: ${status.counts.queued} · Đang chạy: ${status.counts.running}`,
    `Xong: ${status.counts.completed} · Lỗi: ${status.counts.failed} · Đã bỏ: ${status.counts.rejected}`,
    "",
    `Tài khoản — active: <b>${status.accounts.active}</b> · cooldown: ${status.accounts.cooldown} · checkpoint: <b>${status.accounts.checkpoint}</b>`,
    "",
    workerActivity
  ].join("\n");

  return {
    text,
    keyboard: {
      inline_keyboard: [
        [
          { text: "📋 Hàng chờ", callback_data: "queue:refresh" },
          ...urlButton("🖥 Mở dashboard", "/queue")
        ]
      ]
    }
  };
}

/** The alert that fires when the worker stopped running while work is waiting. */
export function buildWorkerSilentMessage(input: {
  workers: { name: string; lastSeenAt: string }[];
  backlog: { pendingApproval: number; queued: number; running: number };
}): { text: string; keyboard: InlineKeyboard } {
  const lines = [
    "🚨 <b>Worker im lặng</b>",
    "",
    ...input.workers.map(
      (worker) => `• <b>${escapeHtml(worker.name)}</b> — lần cuối ${escapeHtml(formatRelative(worker.lastSeenAt))}`
    ),
    "",
    `Đang chờ: <b>${input.backlog.pendingApproval}</b> bài duyệt · <b>${input.backlog.queued}</b> trong hàng đợi · ${input.backlog.running} đang chạy`,
    "",
    "Không có gì được đăng cho tới khi worker chạy lại. Kiểm tra tiến trình worker trên VPS (log, RAM, hết phiên antidetect)."
  ];

  return {
    text: lines.join("\n"),
    keyboard: {
      inline_keyboard: [
        [
          { text: "🔄 Kiểm tra lại", callback_data: "queue:refresh" },
          ...urlButton("📋 Mở hàng chờ", "/queue")
        ]
      ]
    }
  };
}

/** Failures and account-health events are the alerts that prevent silent losses. */
export function buildFailureMessage(input: {
  taskId: string;
  status: TaskStatus;
  sourceName: string | null;
  error: string | null;
  accountStatus: AccountStatus | null;
  accountName: string | null;
}): { text: string; keyboard: InlineKeyboard } {
  const heading =
    input.accountStatus === "checkpoint"
      ? "🚨 <b>Tài khoản cần xử lý thủ công</b>"
      : input.accountStatus === "cooldown"
        ? "😴 <b>Tài khoản tạm nghỉ</b>"
        : "⚠️ <b>Task lỗi</b>";

  const text = [
    heading,
    "",
    `<b>Nguồn:</b> ${escapeHtml(input.sourceName ?? "không rõ")}`,
    input.accountName ? `<b>Tài khoản:</b> ${escapeHtml(input.accountName)}` : null,
    `<b>Trạng thái:</b> ${escapeHtml(TASK_STATUS_LABEL[input.status])}`,
    input.error ? `\n<code>${escapeHtml(truncate(input.error, 500))}</code>` : null
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  return {
    text,
    keyboard: {
      inline_keyboard: [
        [
          ...urlButton("🔍 Mở task", `/queue?task=${input.taskId}`),
          ...urlButton("👤 Xem tài khoản", "/accounts")
        ],
        [{ text: "📋 Hàng chờ", callback_data: "queue:refresh" }]
      ].filter((row) => row.length > 0)
    }
  };
}
