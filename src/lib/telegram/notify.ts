import type { SupabaseDb } from "@/lib/db";
import { isTelegramConfigured, sendMessage } from "@/lib/telegram/api";
import { buildCaptureMessage, buildFailureMessage, buildWorkerSilentMessage } from "@/lib/telegram/messages";
import { loadCaptureView, loadFailureContext } from "@/lib/telegram/queries";

/**
 * Push notifications. These are the reason the operator does not have to keep a
 * dashboard tab open: the radar says "there is work", the worker says "something
 * broke".
 *
 * Every function is best-effort — Telegram being down or unconfigured must never
 * affect the radar or a worker report.
 */

export async function notifyNewCapture(db: SupabaseDb, taskId: string): Promise<void> {
  if (!isTelegramConfigured()) return;

  try {
    const capture = await loadCaptureView(db, taskId);
    if (!capture) return;

    const { text, keyboard } = buildCaptureMessage(capture);
    await sendMessage(text, keyboard);
  } catch (error) {
    console.error("[telegram] new-capture notification failed", error instanceof Error ? error.message : error);
  }
}

export async function notifyTaskFailure(db: SupabaseDb, taskId: string): Promise<void> {
  if (!isTelegramConfigured()) return;

  try {
    const context = await loadFailureContext(db, taskId);
    if (!context) return;

    const { text, keyboard } = buildFailureMessage(context);
    await sendMessage(text, keyboard);
  } catch (error) {
    console.error("[telegram] failure notification failed", error instanceof Error ? error.message : error);
  }
}

/**
 * Alerts the operator that a worker stopped checking in while tasks are waiting.
 * Called by /api/cron/health, which owns the stale/throttle logic.
 */
export async function notifyWorkerSilent(input: {
  workers: { name: string; lastSeenAt: string }[];
  backlog: { pendingApproval: number; queued: number; running: number };
}): Promise<void> {
  if (!isTelegramConfigured()) return;

  try {
    const { text, keyboard } = buildWorkerSilentMessage(input);
    await sendMessage(text, keyboard);
  } catch (error) {
    console.error("[telegram] worker-silent notification failed", error instanceof Error ? error.message : error);
  }
}
