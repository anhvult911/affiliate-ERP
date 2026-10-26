import { NextResponse } from "next/server";

import { authorizeCron } from "@/lib/cron/auth";
import { adminDb, type SupabaseDb } from "@/lib/db";
import { notifyStuckTasks, notifyWorkerSilent } from "@/lib/telegram/notify";

export const dynamic = "force-dynamic";

/**
 * GET|POST /api/cron/health
 *
 * The only component that notices a worker which stopped running. Everything else
 * waits for the worker to speak first, so a dead worker used to look exactly like
 * a quiet one.
 *
 * Schedule it every 10–15 minutes (Vercel Cron, cron-job.org, a systemd timer).
 * It alerts once per hour per stale worker — `worker_heartbeats.alerted_at` is the
 * throttle, and a returning heartbeat clears it.
 *
 * Auth: `CRON_SECRET` when set (recommended for a public deploy), otherwise the
 * worker token, so a private VPS needs no extra configuration.
 */

const ALERT_THROTTLE_MS = 60 * 60_000;

type Heartbeat = { worker: string; last_seen_at: string; alerted_at: string | null; mode: string | null };

type StuckTask = {
  task_id: string;
  account_id: string | null;
  attempt_count: number;
  post_url: string | null;
};

async function countByStatus(db: SupabaseDb, status: "pending_approval" | "queued" | "running") {
  const { count } = await db
    .from("comment_tasks")
    .select("id", { count: "exact", head: true })
    .eq("status", status);

  return count ?? 0;
}

async function handle(request: Request) {
  const auth = authorizeCron(request);
  if (!auth.ok) return auth.response;

  const staleMinutes = Number(process.env.WORKER_STALE_MINUTES?.trim() || 10);
  const now = Date.now();
  const db = adminDb();

  // Stuck tasks are swept on every run, before the summary: a row whose lease
  // expired and whose retries are spent can never be claimed again, so leaving it in
  // `running` both hides real backlog and keeps the dashboard lying.
  const sweep = await db
    .rpc("sweep_stuck_tasks", { p_lease_minutes: Number(process.env.WORKER_LEASE_MINUTES?.trim() || 15) })
    .overrideTypes<StuckTask[], { merge: false }>();

  if (sweep.error) {
    return NextResponse.json({ ok: false, error: sweep.error.message }, { status: 500 });
  }

  const stuck = sweep.data ?? [];

  const [{ data: heartbeats, error }, pending, queued, running] = await Promise.all([
    db
      .from("worker_heartbeats")
      .select("worker,last_seen_at,alerted_at,mode")
      .order("last_seen_at", { ascending: false })
      .overrideTypes<Heartbeat[], { merge: false }>(),
    countByStatus(db, "pending_approval"),
    countByStatus(db, "queued"),
    countByStatus(db, "running")
  ]);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const workers = heartbeats ?? [];
  const backlog = { pendingApproval: pending, queued, running };
  const backlogSize = pending + queued + running;

  // Alerts after the counts, so "remaining running" reflects what the sweep left.
  if (stuck.length > 0) {
    await notifyStuckTasks({
      swept: stuck.map((task) => ({
        taskId: task.task_id,
        accountId: task.account_id,
        attemptCount: task.attempt_count,
        postUrl: task.post_url
      })),
      remainingRunning: running
    });
  }

  if (workers.length === 0) {
    // Nothing has ever checked in. That is a setup problem, not a silent failure,
    // and the dashboard already shows tasks sitting in the queue.
    return NextResponse.json({
      ok: true,
      status: "no-worker-registered",
      swept: stuck.length,
      backlog,
      hint: "No worker has ever sent a heartbeat. Start the worker and it will register itself."
    });
  }

  const stale = workers.filter((worker) => now - new Date(worker.last_seen_at).getTime() > staleMinutes * 60_000);

  if (stale.length === 0) {
    return NextResponse.json({
      ok: true,
      status: "healthy",
      swept: stuck.length,
      staleMinutes,
      workers: workers.map((worker) => ({ worker: worker.worker, lastSeenAt: worker.last_seen_at })),
      backlog
    });
  }

  if (backlogSize === 0) {
    // A silent worker with an empty queue costs nothing right now — say so instead
    // of crying wolf, but keep the status visible.
    return NextResponse.json({
      ok: true,
      status: "silent-idle",
      swept: stuck.length,
      staleMinutes,
      staleWorkers: stale.map((worker) => ({ worker: worker.worker, lastSeenAt: worker.last_seen_at })),
      backlog,
      hint: "Worker is stale but nothing is waiting, so no alert was sent."
    });
  }

  const due = stale.filter(
    (worker) => !worker.alerted_at || now - new Date(worker.alerted_at).getTime() > ALERT_THROTTLE_MS
  );

  if (due.length === 0) {
    return NextResponse.json({
      ok: true,
      status: "stale",
      swept: stuck.length,
      alerted: false,
      throttled: true,
      staleWorkers: stale.map((worker) => ({ worker: worker.worker, lastSeenAt: worker.last_seen_at })),
      backlog
    });
  }

  await notifyWorkerSilent({
    workers: due.map((worker) => ({ name: worker.worker, lastSeenAt: worker.last_seen_at })),
    backlog
  });

  const { error: updateError } = await db
    .from("worker_heartbeats")
    .update({ alerted_at: new Date().toISOString() })
    .in(
      "worker",
      due.map((worker) => worker.worker)
    );

  if (updateError) {
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    status: "stale",
    alerted: true,
    staleWorkers: due.map((worker) => ({ worker: worker.worker, lastSeenAt: worker.last_seen_at })),
    backlog
  });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
