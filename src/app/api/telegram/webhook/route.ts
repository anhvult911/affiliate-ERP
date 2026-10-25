import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { approveTaskWithDefaults, rejectTask } from "@/lib/actions/comment-tasks";
import { adminDb } from "@/lib/db";
import {
  answerCallbackQuery,
  editMessageText,
  sendMessage,
  webhookSecret
} from "@/lib/telegram/api";
import { buildQueueMessage, buildStatusMessage } from "@/lib/telegram/messages";
import { loadPendingCaptures, loadStatusView } from "@/lib/telegram/queries";

export const dynamic = "force-dynamic";

/**
 * Telegram webhook.
 *
 * This route is the phone half of the approval workflow: a capture arrives as a
 * message with inline buttons, and approving it here runs the *same* server
 * action the dashboard uses (via the service-role client, since a webhook has no
 * session).
 *
 * Security: Telegram signs every request with the secret we set when registering
 * the webhook. Without it configured the route refuses to run at all — an open
 * webhook would let anyone approve posts on the operator's accounts.
 */

type TelegramUpdate = {
  update_id?: number;
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
};

const QUEUE_DIGEST_SIZE = 5;

export async function GET() {
  const configured = Boolean(webhookSecret());
  return NextResponse.json({
    ok: true,
    configured,
    hint: configured
      ? "POST Telegram updates here. Register with: setWebhook(secret_token=TELEGRAM_WEBHOOK_SECRET)."
      : "Set TELEGRAM_WEBHOOK_SECRET before registering this webhook."
  });
}

export async function POST(request: Request) {
  const secret = webhookSecret();
  if (!secret) {
    return NextResponse.json({ ok: false, error: "TELEGRAM_WEBHOOK_SECRET is not configured." }, { status: 503 });
  }

  const provided = request.headers.get("x-telegram-bot-api-secret-token");
  if (!provided || !secretsMatch(provided, secret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const update = (await request.json().catch(() => null)) as TelegramUpdate | null;
  if (!update) return NextResponse.json({ ok: false, error: "Invalid update body." }, { status: 400 });

  try {
    if (update.callback_query) {
      await handleCallback(update.callback_query);
    } else if (update.message?.text) {
      await handleCommand(update.message.chat.id, update.message.text);
    }
  } catch (error) {
    // Telegram retries on non-2xx, which would double-apply an approval. Log and
    // acknowledge instead: every action is idempotent at the DB level anyway.
    console.error("[telegram] update handling failed", error instanceof Error ? error.message : error);
  }

  return NextResponse.json({ ok: true });
}

async function handleCommand(chatId: number, rawText: string): Promise<void> {
  const command = rawText.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const db = adminDb();

  if (command === "/queue" || command === "/pending") {
    const [captures, status] = await Promise.all([loadPendingCaptures(db, QUEUE_DIGEST_SIZE), loadStatusView(db)]);
    const { text, keyboard } = buildQueueMessage(captures, status.counts);
    await sendMessage(text, keyboard);
    return;
  }

  if (command === "/status") {
    const status = await loadStatusView(db);
    const { text, keyboard } = buildStatusMessage(status);
    await sendMessage(text, keyboard);
    return;
  }

  await sendMessage(
    [
      "🤖 <b>Affiliate ERP</b>",
      "",
      "/queue — bài đang chờ duyệt (kèm nút duyệt)",
      "/status — hàng chờ, tài khoản, hoạt động worker",
      "",
      "Khi radar bắt được bài mới, bot sẽ tự nhắn kèm nút ✅ Duyệt & chạy."
    ].join("\n"),
    { inline_keyboard: [[{ text: "📋 Hàng chờ", callback_data: "queue:refresh" }]] }
  );
  void chatId;
}

async function handleCallback(query: NonNullable<TelegramUpdate["callback_query"]>): Promise<void> {
  const data = query.data ?? "";
  const [action, taskId] = data.split(":");
  const db = adminDb();

  if (action === "queue" && taskId === "refresh") {
    const [captures, status] = await Promise.all([loadPendingCaptures(db, QUEUE_DIGEST_SIZE), loadStatusView(db)]);
    const { text, keyboard } = buildQueueMessage(captures, status.counts);
    await sendMessage(text, keyboard);
    await answerCallbackQuery(query.id, "Đã làm mới");
    return;
  }

  if (!taskId) {
    await answerCallbackQuery(query.id, "Nút không hợp lệ");
    return;
  }

  if (action === "approve") {
    const result = await approveTaskWithDefaults(taskId, db);

    if (!result.ok) {
      await answerCallbackQuery(query.id, result.error.slice(0, 180));
      return;
    }

    await answerCallbackQuery(query.id, `Đã xếp hàng · Sub_ID ${result.data.subIdCode}`);
    await settleMessage(query, `✅ <b>Đã duyệt</b> — xếp hàng với ${result.data.accountName}\nSub_ID: <code>${result.data.subIdCode}</code>`);
    return;
  }

  if (action === "reject") {
    const result = await rejectTask({ taskId, reason: "Rejected from Telegram" }, db);

    if (!result.ok) {
      await answerCallbackQuery(query.id, result.error.slice(0, 180));
      return;
    }

    await answerCallbackQuery(query.id, "Đã từ chối");
    await settleMessage(query, "🚫 <b>Đã từ chối</b> bài này.");
    return;
  }

  await answerCallbackQuery(query.id, "Hành động không rõ");
}

/** Constant-time compare: a byte-by-byte early exit leaks the secret's prefix. */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Replaces the message body and drops the action buttons in a single edit.
 *
 * Telegram clears an inline keyboard when the text is edited without one, so a
 * follow-up `editMessageReplyMarkup` would just 400 with "message is not
 * modified".
 */
async function settleMessage(query: NonNullable<TelegramUpdate["callback_query"]>, text: string): Promise<void> {
  const message = query.message;
  if (!message) return;

  await editMessageText(message.chat.id, message.message_id, text);
}
