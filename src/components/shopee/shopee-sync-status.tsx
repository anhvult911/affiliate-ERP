import { ClockIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { ShopeeSyncJob, ShopeeSyncJobState, ShopeeSyncStatus } from "@/lib/data/shopee";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATE_LABEL: Record<ShopeeSyncJobState, string> = {
  unconfigured: "Chưa cấu hình",
  never: "Chưa chạy",
  ok: "Trong hạn",
  stale: "Quá hạn",
  error: "Lỗi lần chạy gần nhất"
};

const STATE_TONE: Record<
  ShopeeSyncJobState,
  "success" | "warning" | "destructive" | "muted" | "info"
> = {
  unconfigured: "warning",
  never: "muted",
  ok: "success",
  stale: "warning",
  error: "destructive"
};

function jobDetail(job: ShopeeSyncJob) {
  if (job.state === "unconfigured") return "Cần credential Shopee Affiliate Open API.";
  if (job.state === "never") return "Chưa có lần chạy nào được ghi nhận.";
  if (!job.lastRunAt) return "Không đọc được mốc đồng bộ.";
  return `Lần chạy gần nhất: ${formatRelative(job.lastRunAt)} · ${formatDateTime(job.lastRunAt)}`;
}

/**
 * Read-only readiness block for the Shopee conversion/validated/product pulls.
 *
 * Shown next to attribution and on the analytics page so "no orders" is never confused
 * with "the sync has not run since yesterday". It renders no credentials and no
 * invented numbers — only the last-run bookkeeping the jobs themselves wrote.
 */
export function ShopeeSyncStatusPanel({
  status,
  className
}: {
  status: ShopeeSyncStatus;
  className?: string;
}) {
  if (!status.configured) {
    return (
      <div
        className={cn(
          "border-warning/40 bg-warning/5 flex items-start gap-2 rounded-md border p-3 text-xs",
          className
        )}
      >
        <TriangleAlertIcon className="text-warning mt-0.5 size-4 shrink-0" />
        <div className="space-y-1">
          <p className="font-medium">Shopee Affiliate API chưa được cấu hình.</p>
          <p className="text-muted-foreground">
            Hoa hồng Shopee không tự đồng bộ và không thể tạo link tracking Shopee đã xác
            thực. Nhờ quản trị viên đặt <span className="font-mono">SHOPEE_AFFILIATE_APP_ID</span>{" "}
            và <span className="font-mono">SHOPEE_AFFILIATE_APP_SECRET</span> trên máy chủ, sau
            đó tải lại trang. Postback do sàn gửi tới vẫn được ghi nhận nếu có.
          </p>
        </div>
      </div>
    );
  }

  const hasProblem = status.jobs.some(
    (job) => job.state === "error" || job.state === "stale" || job.state === "never"
  );

  return (
    <div className={cn("space-y-2 rounded-md border p-3 text-xs", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-medium">
          <RefreshCwIcon className="size-3.5" />
          Đồng bộ Shopee
        </span>
        <Badge variant={hasProblem ? "warning" : "success"}>
          {hasProblem ? "Cần kiểm tra" : "Sẵn sàng"}
        </Badge>
      </div>

      <ul className="space-y-2">
        {status.jobs.map((job) => (
          <li key={job.kind} className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-0.5">
              <p className="flex items-center gap-1 font-medium">
                <ClockIcon className="text-muted-foreground size-3" />
                {job.label}
              </p>
              <p className="text-muted-foreground">{jobDetail(job)}</p>
              {job.lastError ? (
                <p className="text-destructive line-clamp-2 break-words">{job.lastError}</p>
              ) : null}
            </div>
            <Badge variant={STATE_TONE[job.state]} className="shrink-0">
              {STATE_LABEL[job.state]}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}
