import { TASK_STATUSES, type AccountStatus, type TaskStatus } from "@/lib/constants";
import type { SupabaseDb } from "@/lib/db";
import type { CaptureView, StatusView } from "@/lib/telegram/messages";

/**
 * Reads the Telegram surfaces need. These take a client because the webhook runs
 * without a session (service role), while the notifiers are called from
 * worker-facing routes that already hold one.
 */

const CAPTURE_SELECT = `
  id,
  match_score,
  ai_draft_comment,
  post_url,
  created_at,
  source:target_sources(name),
  product:products(name, price)
`;

type CaptureRow = {
  id: string;
  match_score: number | null;
  ai_draft_comment: string | null;
  post_url: string;
  created_at: string;
  source: { name: string } | null;
  product: { name: string; price: number | null } | null;
};

function toCaptureView(row: CaptureRow): CaptureView {
  return {
    taskId: row.id,
    sourceName: row.source?.name ?? null,
    productName: row.product?.name ?? null,
    productPrice: row.product?.price ?? null,
    matchScore: row.match_score,
    draft: row.ai_draft_comment,
    postUrl: row.post_url,
    createdAt: row.created_at
  };
}

export async function loadCaptureView(db: SupabaseDb, taskId: string): Promise<CaptureView | null> {
  const { data, error } = await db
    .from("comment_tasks")
    .select(CAPTURE_SELECT)
    .eq("id", taskId)
    .maybeSingle()
    .overrideTypes<CaptureRow | null, { merge: false }>();

  if (error) throw new Error(`Could not load the capture: ${error.message}`);
  return data ? toCaptureView(data) : null;
}

/** Oldest first: the queue is worked front to back, and fresh posts go stale. */
export async function loadPendingCaptures(db: SupabaseDb, limit: number): Promise<CaptureView[]> {
  const { data, error } = await db
    .from("comment_tasks")
    .select(CAPTURE_SELECT)
    .eq("status", "pending_approval")
    .order("created_at", { ascending: true })
    .limit(limit)
    .overrideTypes<CaptureRow[], { merge: false }>();

  if (error) throw new Error(`Could not load the pending queue: ${error.message}`);
  return (data ?? []).map(toCaptureView);
}

export async function loadStatusView(db: SupabaseDb): Promise<StatusView> {
  const [countRows, accountRows, running] = await Promise.all([
    Promise.all(
      TASK_STATUSES.map((status) =>
        db
          .from("comment_tasks")
          .select("id", { count: "exact", head: true })
          .eq("status", status)
          .then(({ count }) => [status, count ?? 0] as const)
      )
    ),
    db.from("social_accounts").select("status, last_action_at"),
    db.from("comment_tasks").select("id", { count: "exact", head: true }).eq("status", "running")
  ]);

  const counts = Object.fromEntries(countRows) as Record<TaskStatus, number>;
  const total = TASK_STATUSES.reduce((sum, status) => sum + counts[status], 0);

  const accounts: Record<AccountStatus, number> = { active: 0, cooldown: 0, checkpoint: 0 };
  let lastActionAt: string | null = null;

  for (const account of accountRows.data ?? []) {
    accounts[account.status] += 1;
    if (account.last_action_at && (!lastActionAt || account.last_action_at > lastActionAt)) {
      lastActionAt = account.last_action_at;
    }
  }

  return { counts: { ...counts, total }, accounts, lastActionAt, runningTasks: running.count ?? 0 };
}

export type FailureContext = {
  taskId: string;
  status: TaskStatus;
  sourceName: string | null;
  error: string | null;
  accountStatus: AccountStatus | null;
  accountName: string | null;
};

export async function loadFailureContext(db: SupabaseDb, taskId: string): Promise<FailureContext | null> {
  const { data, error } = await db
    .from("comment_tasks")
    .select("id, status, last_error, source:target_sources(name), account:social_accounts!comment_tasks_assigned_account_id_fkey(name, status)")
    .eq("id", taskId)
    .maybeSingle()
    .overrideTypes<
      | {
          id: string;
          status: TaskStatus;
          last_error: string | null;
          source: { name: string } | null;
          account: { name: string; status: AccountStatus } | null;
        }
      | null,
      { merge: false }
    >();

  if (error) throw new Error(`Could not load the failure context: ${error.message}`);
  if (!data) return null;

  return {
    taskId: data.id,
    status: data.status,
    sourceName: data.source?.name ?? null,
    error: data.last_error,
    accountStatus: data.account?.status === "active" ? null : (data.account?.status ?? null),
    accountName: data.account?.name ?? null
  };
}
