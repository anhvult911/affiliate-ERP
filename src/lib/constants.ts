/**
 * Domain vocabulary shared by the dashboard, the server actions and the worker
 * API. These unions MUST stay in sync with the Postgres enums in
 * supabase/migrations/20261020090000_init_schema.sql.
 */

export const SOCIAL_PLATFORMS = ["facebook", "instagram", "tiktok", "threads"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const ACCOUNT_STATUSES = ["active", "cooldown", "checkpoint"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const SOURCE_TYPES = ["group", "fanpage", "kol", "forum"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const EXECUTION_MODES = ["single", "seeding_2_accounts"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export const TASK_STATUSES = [
  "pending_approval",
  "queued",
  "running",
  "completed",
  "failed",
  "rejected"
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const CONVERSION_STATUSES = ["pending", "settled", "canceled"] as const;
export type ConversionStatus = (typeof CONVERSION_STATUSES)[number];

/** Statuses a worker may claim for execution. */
export const CLAIMABLE_TASK_STATUSES: readonly TaskStatus[] = ["queued"];

/**
 * How long a `running` claim is honoured before the queue may reclaim it.
 * Mirrored by the lease window inside public.claim_comment_tasks() and used to
 * decide when the operator may pull a running task back to approval.
 */
export const WORKER_LEASE_MINUTES = 15;

export const ACCOUNT_STATUS_LABEL: Record<AccountStatus, string> = {
  active: "Hoạt động",
  cooldown: "Nghỉ ngơi",
  checkpoint: "Checkpoint"
};

export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  group: "Nhóm Facebook",
  fanpage: "Fanpage",
  kol: "KOL / KOC",
  forum: "Diễn đàn"
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pending_approval: "Chờ duyệt",
  queued: "Đã xếp hàng",
  running: "Đang chạy",
  completed: "Hoàn thành",
  failed: "Thất bại",
  rejected: "Đã từ chối"
};

export const EXECUTION_MODE_LABEL: Record<ExecutionMode, string> = {
  single: "1 tài khoản",
  seeding_2_accounts: "Seeding 2 tầng"
};

export const CONVERSION_STATUS_LABEL: Record<ConversionStatus, string> = {
  pending: "Chờ duyệt hoa hồng",
  settled: "Đã quyết toán",
  canceled: "Đã hủy"
};

/**
 * Badge variants per status. Kept here (not in the components) so every module
 * renders the same state with the same colour.
 */
export const ACCOUNT_STATUS_TONE: Record<AccountStatus, "success" | "warning" | "destructive"> = {
  active: "success",
  cooldown: "warning",
  checkpoint: "destructive"
};

export const TASK_STATUS_TONE: Record<
  TaskStatus,
  "success" | "warning" | "destructive" | "info" | "muted"
> = {
  pending_approval: "warning",
  queued: "info",
  running: "info",
  completed: "success",
  failed: "destructive",
  rejected: "muted"
};

export const CONVERSION_STATUS_TONE: Record<
  ConversionStatus,
  "success" | "warning" | "destructive"
> = {
  pending: "warning",
  settled: "success",
  canceled: "destructive"
};

/** Default page size for every module list. */
export const PAGE_SIZE = 20;

/** Touch-friendly approval queue pagination (mobile renders one card per screen). */
export const QUEUE_PAGE_SIZE = 25;
