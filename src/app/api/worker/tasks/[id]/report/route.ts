import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notifyTaskFailure } from "@/lib/telegram/notify";
import { authorizeWorker, workerJson } from "@/lib/worker/auth";

export const dynamic = "force-dynamic";

const reportSchema = z.object({
  /** Identifies the worker that claimed the task — a report without a matching claim is refused. */
  worker: z.string().trim().min(1, "Identify the worker.").max(64),
  status: z.enum(["completed", "failed"]),
  error: z.string().trim().max(2000).nullish(),
  executedAt: z.string().datetime().optional(),
  /** Non-fatal observations (e.g. the link reply failed) — stored, never hidden. */
  note: z.string().trim().max(500).nullish(),
  /**
   * Account health at the end of the run. `active` is deliberately not accepted:
   * clearing a checkpoint is a human decision (Accounts → Personas), and a worker
   * must not be able to lift its own ban gate.
   */
  accountStatus: z.enum(["cooldown", "checkpoint"]).optional(),
  cooldownMinutes: z.number().int().min(1).max(10080).optional()
});

/**
 * POST /api/worker/tasks/{id}/report
 *
 * Terminal callback for a claimed task. Only a `running` task claimed by the
 * reporting worker is accepted, so a stale or forged report cannot mark work as
 * done, and only one report can ever land.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = authorizeWorker(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return workerJson({ ok: false, error: "Task id must be a uuid." }, 400);
  }

  const parsed = reportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return workerJson({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid body." }, 400);
  }

  const { worker, status, accountStatus } = parsed.data;
  const supabase = createSupabaseAdminClient();

  const { data: task, error: taskError } = await supabase
    .from("comment_tasks")
    .select("id,status,claimed_by,assigned_account_id,secondary_account_id,execution_mode,attempt_count")
    .eq("id", id)
    .maybeSingle();

  if (taskError) return workerJson({ ok: false, error: taskError.message }, 500);
  if (!task) return workerJson({ ok: false, error: "Unknown task." }, 404);
  if (task.status !== "running") {
    return workerJson(
      { ok: false, error: `Task is ${task.status}; only a claimed, running task accepts a report.` },
      409
    );
  }
  if (task.claimed_by !== worker) {
    return workerJson(
      { ok: false, error: `Task is claimed by ${task.claimed_by ?? "nobody"}, not ${worker}.` },
      409
    );
  }

  const { data: updated, error: updateError } = await supabase
    .from("comment_tasks")
    .update({
      status,
      executed_at: parsed.data.executedAt ?? new Date().toISOString(),
      last_error: status === "failed" ? (parsed.data.error ?? "Worker reported failure") : null,
      execution_note: parsed.data.note ?? null
    })
    .eq("id", id)
    .eq("status", "running")
    .eq("claimed_by", worker)
    .select("id");

  if (updateError) return workerJson({ ok: false, error: updateError.message }, 500);
  if (!updated || updated.length === 0) {
    return workerJson({ ok: false, error: "Another report already closed this task." }, 409);
  }

  if (task.assigned_account_id) {
    const accountPatch: {
      last_action_at: string;
      status?: "cooldown" | "checkpoint";
      cooldown_until?: string | null;
    } = { last_action_at: new Date().toISOString() };

    if (accountStatus) {
      accountPatch.status = accountStatus;
      accountPatch.cooldown_until =
        accountStatus === "cooldown" && parsed.data.cooldownMinutes
          ? new Date(Date.now() + parsed.data.cooldownMinutes * 60_000).toISOString()
          : null;
    }

    const { error: accountError } = await supabase
      .from("social_accounts")
      .update(accountPatch)
      .eq("id", task.assigned_account_id);

    if (accountError) return workerJson({ ok: false, error: accountError.message }, 500);

    // A successful run earns trust — unless the same report flagged the account for
    // checkpoint, in which case trust is reset by the operator, not the worker. The
    // increment is one statement (P2-6): read-modify-write lost increments when two
    // reports landed together.
    if (status === "completed" && accountStatus !== "checkpoint") {
      const { error: bumpError } = await supabase
        .rpc("bump_trust_score", { p_account_id: task.assigned_account_id, p_delta: 1 });

      if (bumpError) return workerJson({ ok: false, error: bumpError.message }, 500);
    }

    /*
     * In 2-tier mode the tier-2 account also published (the link reply), so it
     * earns the same trust nudge and its `last_action_at` moves. Reporting only
     * the primary account left the tier-2 persona's trust frozen despite working.
     */
    if (
      status === "completed" &&
      task.execution_mode === "seeding_2_accounts" &&
      task.secondary_account_id &&
      !accountStatus
    ) {
      const { error: secondaryError } = await supabase
        .from("social_accounts")
        .update({ last_action_at: new Date().toISOString() })
        .eq("id", task.secondary_account_id);

      if (secondaryError) return workerJson({ ok: false, error: secondaryError.message }, 500);

      const { error: secondaryBumpError } = await supabase
        .rpc("bump_trust_score", { p_account_id: task.secondary_account_id, p_delta: 1 });

      if (secondaryBumpError) {
        return workerJson({ ok: false, error: secondaryBumpError.message }, 500);
      }
    }
  }

  // Failures and account-health events are exactly what a solo operator cannot
  // afford to discover by accident.
  if (status === "failed" || accountStatus) {
    await notifyTaskFailure(supabase, id);
  }

  return workerJson({ ok: true });
}
