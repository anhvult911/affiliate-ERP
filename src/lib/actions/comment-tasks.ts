"use server";

import { revalidatePath } from "next/cache";

import { TASK_STATUS_LABEL, WORKER_LEASE_MINUTES } from "@/lib/constants";
import { resolveDb, type SupabaseDb } from "@/lib/db";
import { platformOf } from "@/lib/products/platform";
import { pickDefaultAccount } from "@/lib/queue/assignment";
import { affiliateDraftOnly } from "@/lib/queue/publication";
import { errorMessage, fail, fromZodError, ok, type ActionResult } from "@/lib/result";
import { ShopeeClient } from "@/lib/shopee/client";
import { isShopeeConfigured, readShopeeConfig } from "@/lib/shopee/config";
import { originUrlFor, requestShortLink } from "@/lib/shopee/short-link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildTrackedAffiliateUrl } from "@/lib/worker/affiliate";
import {
  approveTaskSchema,
  manualPublicationSchema,
  rejectTaskSchema,
  taskIdSchema,
  updateDraftSchema,
  type ApproveTaskInput,
  type ManualPublicationInput,
  type RejectTaskInput
} from "@/lib/validations/comment-task";

/** Statuses an approve action may move to `queued`. `failed` = retry after a worker error. */
const APPROVABLE_STATUSES = ["pending_approval", "failed"];

/** A manual publication is only meaningful before any real automated post exists. */
const MANUAL_RECORDABLE_STATUSES = ["pending_approval", "failed", "dry_run"] as const;

export type TrackedAffiliateLink = {
  link: string;
  subIdCode: string;
  platform: "shopee" | "other";
  /** `shopee_api` = Shopee minted the link with the Sub_ID; never a query-string claim. */
  verification: "shopee_api" | "query_param";
};

function revalidateQueue() {
  revalidatePath("/queue");
}

/** Case/query-preserving enough to catch a pasted duplicate of the source post. */
function normalizedUrl(value: string) {
  try {
    const url = new URL(value.trim());
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim();
  }
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
  if (affiliateDraftOnly()) return fail("Affiliate đang ở chế độ chỉ soạn nháp. Bạn có thể lưu và sao chép bản nháp, nhưng không thể xếp lịch đăng.");

  const { taskId, accountId, secondaryAccountId, executionMode, draft, selectedReviewImage } =
    parsed.data;

  const supabase = await resolveDb(client);

  const { data: task, error: taskError } = await supabase
    .from("comment_tasks")
    .select("id,status,matched_product_id,product:products(id,affiliate_short_link)")
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

  // Atomically mint (or reuse) the attribution code. The RPC locks the task row,
  // so a retry and a manual-link copy cannot produce two codes for one post.
  const { data: subIdCode, error: subIdError } = await supabase.rpc("ensure_task_sub_id", {
    p_task_id: taskId
  });

  if (subIdError) return fail(`Không thể tạo mã Sub_ID: ${subIdError.message}`);
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

/**
 * Returns the exact tracked URL an operator should paste when publishing by hand.
 *
 * This is deliberately independent of approval: it only mints/reuses the Sub_ID, it
 * never queues the task or calls Facebook. For Shopee the link must come from Shopee's
 * `generateShortLink` mutation (docs/SHOPEE_API.md §4.2); the query-string append is
 * not verified for API-produced links, so a missing credential or API failure is an
 * explicit unavailable state instead of a link that merely looks tracked.
 */
export async function getTaskTrackedLink(
  taskId: string
): Promise<ActionResult<TrackedAffiliateLink>> {
  const parsed = taskIdSchema.safeParse({ taskId });
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { data: task, error } = await supabase
    .from("comment_tasks")
    .select("id,matched_product_id,product:products(id,affiliate_short_link,origin_link)")
    .eq("id", parsed.data.taskId)
    .maybeSingle()
    .overrideTypes<
      | {
          id: string;
          matched_product_id: string | null;
          product: {
            id: string;
            affiliate_short_link: string | null;
            origin_link: string | null;
          } | null;
        }
      | null,
      { merge: false }
    >();

  if (error) return fail(error.message);
  if (!task) return fail("Tác vụ này không còn tồn tại trên hệ thống.");
  if (!task.matched_product_id || !task.product?.affiliate_short_link) {
    return fail(
      "Tác vụ chưa được ghép với sản phẩm có link affiliate — không thể tạo link tracking. Vui lòng ghép sản phẩm trước."
    );
  }

  const { data: subIdCode, error: subIdError } = await supabase.rpc("ensure_task_sub_id", {
    p_task_id: parsed.data.taskId
  });
  if (subIdError) return fail(`Không thể tạo mã Sub_ID: ${subIdError.message}`);
  if (!subIdCode) return fail("Không thể tạo mã Sub_ID duy nhất — vui lòng thử lại.");

  const platform = platformOf(task.product.affiliate_short_link);

  // Non-Shopee networks use the documented query parameter, so appending is the
  // supported tracking mechanism (not an unverified fallback).
  if (platform !== "shopee") {
    return ok({
      link: buildTrackedAffiliateUrl(task.product.affiliate_short_link, subIdCode),
      subIdCode,
      platform: "other",
      verification: "query_param"
    });
  }

  if (!isShopeeConfigured()) {
    return fail(
      "Shopee Affiliate API chưa được cấu hình (thiếu SHOPEE_AFFILIATE_APP_ID và/hoặc SHOPEE_AFFILIATE_APP_SECRET). " +
        "Không thể tạo link tracking Shopee đã xác thực. Nhờ quản trị viên cấu hình credential trên máy chủ rồi bấm thử lại — " +
        "không tự nối Sub_ID vào link Shopee vì cách đó chưa được xác nhận."
    );
  }

  const originUrl = originUrlFor(task.product);
  if (!originUrl) {
    return fail(
      "Sản phẩm chưa có link gốc Shopee hợp lệ để tạo link tracking. Cập nhật link gốc cho sản phẩm rồi thử lại."
    );
  }

  try {
    const link = await requestShortLink(new ShopeeClient(readShopeeConfig()), {
      originUrl,
      subId: subIdCode
    });

    return ok({
      link,
      subIdCode,
      platform: "shopee",
      verification: "shopee_api"
    });
  } catch (err) {
    return fail(
      `Shopee chưa xác nhận được link tracking: ${errorMessage(err)}. ` +
        "Không dùng link tự nối Sub_ID cho Shopee — vui lòng thử lại hoặc kiểm tra cấu hình/API access."
    );
  }
}

/**
 * Records that the operator published this comment by hand.
 *
 * This is not an automated execution: it never sets `executed_at` or `completed`, and
 * it never touches Facebook. The task moves to its own `manually_published` state, so
 * the worker cannot claim it later and the approval action cannot requeue it. The
 * permalink and time are exactly what the operator supplied; conversions keep
 * reconciling through the same `sub_id_code`.
 */
export async function recordManualPublication(
  input: ManualPublicationInput
): Promise<ActionResult<{ subIdCode: string; permalink: string; publishedAt: string }>> {
  const parsed = manualPublicationSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const published = new Date(parsed.data.publishedAt);
  if (published.getTime() > Date.now() + 5 * 60_000) {
    return fail("Thời điểm đăng không được ở tương lai.");
  }
  if (published.getTime() < Date.UTC(2000, 0, 1)) {
    return fail("Thời điểm đăng không hợp lệ.");
  }

  const supabase = await createSupabaseServerClient();

  const { data: task, error: taskError } = await supabase
    .from("comment_tasks")
    .select("id,status,post_url,matched_product_id,product:products(id,affiliate_short_link)")
    .eq("id", parsed.data.taskId)
    .maybeSingle()
    .overrideTypes<
      | {
          id: string;
          status: string;
          post_url: string;
          matched_product_id: string | null;
          product: { id: string; affiliate_short_link: string | null } | null;
        }
      | null,
      { merge: false }
    >();

  if (taskError) return fail(taskError.message);
  if (!task) return fail("Tác vụ này không còn tồn tại trên hệ thống.");

  if (task.status === "manually_published") {
    return fail("Bài này đã được ghi nhận đăng thủ công — không tạo thêm bản ghi trùng.");
  }
  if (!MANUAL_RECORDABLE_STATUSES.some(status => status === task.status)) {
    return fail(
      `Chỉ tác vụ đang chờ duyệt, thất bại hoặc chạy thử mới có thể ghi nhận đăng thủ công. Tác vụ này đang ở trạng thái "${
        TASK_STATUS_LABEL[task.status as keyof typeof TASK_STATUS_LABEL] ?? task.status
      }".`
    );
  }
  if (!task.matched_product_id || !task.product?.affiliate_short_link) {
    return fail(
      "Tác vụ chưa được ghép với sản phẩm có link affiliate — bài đăng thủ công sẽ không thể đối soát hoa hồng."
    );
  }
  if (normalizedUrl(parsed.data.permalink) === normalizedUrl(task.post_url)) {
    return fail(
      "Permalink đang trùng link bài gốc, chưa phải link bình luận đã đăng. Hãy mở bình luận của bạn và sao chép permalink riêng của nó."
    );
  }

  // Mint before the state change so the recorded post and the link the operator
  // copied always carry the same code.
  const { data: subIdCode, error: subIdError } = await supabase.rpc("ensure_task_sub_id", {
    p_task_id: parsed.data.taskId
  });
  if (subIdError) return fail(`Không thể tạo mã Sub_ID: ${subIdError.message}`);
  if (!subIdCode) return fail("Không thể tạo mã Sub_ID duy nhất — vui lòng thử lại.");

  const { data: authData } = await supabase.auth.getUser();
  const actor = authData.user?.email ?? authData.user?.id ?? null;

  // Status guard: a stale tab that approved or manually recorded the task first must
  // lose here, so it cannot overwrite a worker claim or a completed post.
  const { data: updated, error: updateError } = await supabase
    .from("comment_tasks")
    .update({
      status: "manually_published",
      manual_post_url: parsed.data.permalink,
      manual_published_at: published.toISOString(),
      manual_published_by: actor,
      // claimed_at/claimed_by/last_error/executed_at are intentionally preserved:
      // a failed attempt remains auditable, and `manually_published` already keeps the
      // worker from claiming or requeueing this row.
    })
    .eq("id", parsed.data.taskId)
    .in("status", MANUAL_RECORDABLE_STATUSES)
    .is("manual_published_at", null)
    .select("id,sub_id_code")
    .maybeSingle();

  if (updateError) return fail(updateError.message);
  if (!updated) {
    return fail(
      "Tác vụ vừa được thiết bị khác xử lý (đã xếp hàng, đang chạy hoặc đã ghi nhận) — vui lòng tải lại trang."
    );
  }

  revalidateQueue();

  return ok({
    subIdCode: updated.sub_id_code ?? subIdCode,
    permalink: parsed.data.permalink,
    publishedAt: published.toISOString()
  });
}
