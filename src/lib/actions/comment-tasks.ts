"use server";

import { revalidatePath } from "next/cache";

import { WORKER_LEASE_MINUTES } from "@/lib/constants";
import { resolveDb, type SupabaseDb } from "@/lib/db";
import { pickDefaultAccount } from "@/lib/queue/assignment";
import { fail, fromZodError, ok, type ActionResult } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  approveTaskSchema,
  rejectTaskSchema,
  taskIdSchema,
  updateDraftSchema,
  type ApproveTaskInput,
  type RejectTaskInput
} from "@/lib/validations/comment-task";

/** No look-alike characters: the Sub_ID is read back by the network postback. */
const SUB_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateSubIdCode() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);

  return `T-${Array.from(bytes, (byte) => SUB_ID_ALPHABET.charAt(byte % SUB_ID_ALPHABET.length)).join("")}`;
}

/** Statuses an approve action may move to `queued`. `failed` = retry after a worker error. */
const APPROVABLE_STATUSES = ["pending_approval", "failed"];

function revalidateQueue() {
  revalidatePath("/queue");
}

/**
 * Approve an AI draft: persists the operator's edits and assignment, mints the
 * Sub_ID attribution code and queues the task for the browser worker.
 *
 * `client` exists for the Telegram webhook, which has no session and passes the
 * service-role client; dashboard callers omit it and get RLS as the operator.
 */
export async function approveTask(
  input: ApproveTaskInput,
  client?: SupabaseDb
): Promise<ActionResult<{ subIdCode: string }>> {
  const parsed = approveTaskSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const { taskId, accountId, secondaryAccountId, executionMode, draft, selectedReviewImage } =
    parsed.data;

  const supabase = await resolveDb(client);

  const { data: task, error: taskError } = await supabase
    .from("comment_tasks")
    .select("id,status,sub_id_code,matched_product_id,product:products(id,affiliate_short_link)")
    .eq("id", taskId)
    .maybeSingle();

  if (taskError) return fail(taskError.message);
  if (!task) return fail("Tác vụ này không còn tồn tại trên hệ thống.");
  if (!APPROVABLE_STATUSES.includes(task.status)) {
    return fail(`Tác vụ này hiện đang ở trạng thái "${task.status}" — vui lòng tải lại danh sách.`);
  }

  // Without a product there is no affiliate link, so the comment could earn
  // nothing while still carrying a valid-looking Sub_ID. Products are deleted
  // with ON DELETE SET NULL, so a pending task can lose its match after capture.
  if (!task.matched_product_id || !task.product?.affiliate_short_link) {
    return fail(
      "Tác vụ này chưa được ghép với sản phẩm nào (hoặc sản phẩm bị mất link affiliate). Vui lòng ghép sản phẩm trước khi duyệt."
    );
  }

  const accountIds = [accountId, secondaryAccountId].filter((id): id is string => Boolean(id));
  const { data: accounts, error: accountsError } = await supabase
    .from("social_accounts")
    .select("id,name,status,cooldown_until,browser_profile_id")
    .in("id", accountIds);

  if (accountsError) return fail(accountsError.message);

  for (const id of accountIds) {
    const account = accounts?.find((row) => row.id === id);
    if (!account) return fail("Một trong các tài khoản đã chọn không còn tồn tại.");
    if (account.status !== "active") {
      return fail(
        `Tài khoản "${account.name}" hiện đang ở trạng thái "${account.status}" và không thể đăng bài. Vui lòng kích hoạt lại tài khoản trước.`
      );
    }
    if (account.cooldown_until && new Date(account.cooldown_until) > new Date()) {
      return fail(
        `Tài khoản "${account.name}" đang trong thời gian tạm dừng đến ${new Date(account.cooldown_until).toLocaleString("vi-VN")}.`
      );
    }
    if (!account.browser_profile_id) {
      return fail(
        `Tài khoản "${account.name}" chưa có Browser Profile ID (GPM/AdsPower) để worker điều khiển. Vui lòng cập nhật trong mục Dàn tài khoản.`
      );
    }
  }

  // Reuse an existing code so a retry keeps the same attribution link.
  let subIdCode = task.sub_id_code;

  for (let attempt = 0; !subIdCode && attempt < 3; attempt += 1) {
    const candidate = generateSubIdCode();
    const { data: clash } = await supabase
      .from("comment_tasks")
      .select("id")
      .eq("sub_id_code", candidate)
      .maybeSingle();

    if (!clash) subIdCode = candidate;
  }

  if (!subIdCode) return fail("Không thể tạo mã Sub_ID duy nhất — vui lòng thử lại.");

  // Optimistic guard on status: two devices approving the same card must not
  // both queue it.
  const { data: updated, error: updateError } = await supabase
    .from("comment_tasks")
    .update({
      status: "queued",
      approved_at: new Date().toISOString(),
      assigned_account_id: accountId,
      secondary_account_id: executionMode === "seeding_2_accounts" ? (secondaryAccountId ?? null) : null,
      execution_mode: executionMode,
      ai_draft_comment: draft,
      selected_review_image: selectedReviewImage ?? null,
      sub_id_code: subIdCode,
      last_error: null,
      claimed_at: null,
      claimed_by: null
    })
    .eq("id", taskId)
    .eq("status", task.status)
    .select("sub_id_code")
    .maybeSingle();

  if (updateError) return fail(updateError.message);
  if (!updated) return fail("Tác vụ này vừa được thao tác bởi thiết bị khác — vui lòng làm mới trang.");

  revalidateQueue();

  return ok({ subIdCode: updated.sub_id_code ?? subIdCode });
}

/**
 * One-tap approval for mobile: keeps the AI draft as-is and picks the default
 * account (see pickDefaultAccount) so approving costs a single tap.
 */
export async function approveTaskWithDefaults(
  taskId: string,
  client?: SupabaseDb
): Promise<ActionResult<{ subIdCode: string; accountName: string }>> {
  const parsed = taskIdSchema.safeParse({ taskId });
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await resolveDb(client);

  const { data: task, error: taskError } = await supabase
    .from("comment_tasks")
    .select("id,status,ai_draft_comment,execution_mode,secondary_account_id,product:products(niche)")
    .eq("id", taskId)
    .maybeSingle()
    .overrideTypes<
      | {
          id: string;
          status: string;
          ai_draft_comment: string | null;
          execution_mode: "single" | "seeding_2_accounts";
          secondary_account_id: string | null;
          product: { niche: string | null } | null;
        }
      | null,
      { merge: false }
    >();

  if (taskError) return fail(taskError.message);
  if (!task) return fail("Tác vụ này không còn tồn tại trên hệ thống.");
  if (!task.ai_draft_comment) {
    return fail("Chưa có nội dung bình luận AI để duyệt — vui lòng mở tác vụ và soạn nội dung.");
  }

  const { data: accountRows, error: accountsError } = await supabase
    .from("social_accounts")
    .select("id,name,persona_type,status,trust_score,browser_profile_id,proxy_ip")
    .order("trust_score", { ascending: false });

  if (accountsError) return fail(accountsError.message);

  // Primary and tier-2 must differ: if the best active account is already the
  // tier-2 account, take the next best instead of failing the tap.
  const accounts = (accountRows ?? []).filter(
    (candidate) => candidate.id !== task.secondary_account_id
  );

  const account = pickDefaultAccount(accounts, task.product?.niche ?? null);
  if (!account) {
    return fail(
      task.execution_mode === "seeding_2_accounts"
        ? "Đây là kịch bản seeding 2 tầng nhưng không còn tài khoản hoạt động nào khác — vui lòng mở tác vụ để chọn cả 2 tài khoản."
        : "Không có tài khoản nào đang hoạt động và có Browser Profile hợp lệ. Vui lòng làm ấm/kích hoạt tài khoản trước."
    );
  }

  const result = await approveTask(
    {
      taskId,
      accountId: account.id,
      secondaryAccountId: task.secondary_account_id,
      executionMode: task.execution_mode,
      draft: task.ai_draft_comment,
      selectedReviewImage: null
    },
    client
  );

  if (!result.ok) return result;

  return ok({ subIdCode: result.data.subIdCode, accountName: account.name });
}

export async function rejectTask(input: RejectTaskInput, client?: SupabaseDb): Promise<ActionResult> {
  const parsed = rejectTaskSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await resolveDb(client);
  // Guarded by status: rejecting a queued/running task would kill a comment the
  // worker is already posting, and rejection is terminal.
  const { data: rejected, error } = await supabase
    .from("comment_tasks")
    .update({ status: "rejected", review_note: parsed.data.reason ?? null })
    .eq("id", parsed.data.taskId)
    .in("status", ["pending_approval", "failed"])
    .select("id");

  if (error) return fail(error.message);
  if (!rejected || rejected.length === 0) {
    return fail("Tác vụ này không còn nằm trong hàng đợi duyệt — vui lòng tải lại danh sách.");
  }

  revalidateQueue();

  return ok();
}

/**
 * Pulls a task back into the approval queue. A `running` task is only returned
 * once its claim has gone stale (WORKER_LEASE_MINUTES), otherwise the operator
 * could re-approve a task the worker is still posting and duplicate the comment.
 */
export async function returnTaskToApproval(taskId: string): Promise<ActionResult> {
  const parsed = taskIdSchema.safeParse({ taskId });
  if (!parsed.success) return fromZodError(parsed.error);

  const leaseCutoff = new Date(Date.now() - WORKER_LEASE_MINUTES * 60_000).toISOString();

  const supabase = await createSupabaseServerClient();
  const { data: returned, error } = await supabase
    .from("comment_tasks")
    .update({
      status: "pending_approval",
      claimed_at: null,
      claimed_by: null
    })
    .eq("id", parsed.data.taskId)
    .or(`status.in.(queued,failed),and(status.eq.running,claimed_at.lt.${leaseCutoff})`)
    .select("id");

  if (error) return fail(error.message);
  if (!returned || returned.length === 0) {
    return fail(
      `Không có thay đổi — tác vụ đã ở trong hàng đợi hoặc worker đang chạy tác vụ này trong vòng ${WORKER_LEASE_MINUTES} phút qua.`
    );
  }

  revalidateQueue();

  return ok();
}

/** Saves an edited draft without approving the task. */
export async function updateTaskDraft(taskId: string, draft: string): Promise<ActionResult> {
  const parsed = updateDraftSchema.safeParse({ taskId, draft });
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await createSupabaseServerClient();
  // Only a task awaiting approval may be edited: rewriting the draft of a task
  // the worker already posted would make the record lie about what was published.
  const { data: saved, error } = await supabase
    .from("comment_tasks")
    .update({ ai_draft_comment: parsed.data.draft })
    .eq("id", parsed.data.taskId)
    .eq("status", "pending_approval")
    .select("id");

  if (error) return fail(error.message);
  if (!saved || saved.length === 0) {
    return fail("Chỉ tác vụ đang chờ duyệt mới có thể chỉnh sửa bản nháp bình luận.");
  }

  revalidateQueue();

  return ok();
}
