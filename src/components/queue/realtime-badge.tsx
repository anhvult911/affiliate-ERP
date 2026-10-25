"use client";

import { RadioIcon } from "lucide-react";

import { useRealtimeStatus, type RealtimeStatus } from "@/components/queue/realtime-status";
import { cn } from "@/lib/utils";

const LABEL: Record<RealtimeStatus, string> = {
  connecting: "Đang kết nối…",
  live: "Trực tiếp",
  offline: "Mất kết nối"
};

const TITLE: Record<RealtimeStatus, string> = {
  connecting: "Đang mở kết nối realtime nhận bài từ radar vào hàng đợi.",
  live: "Realtime hoạt động: bài viết mới sẽ xuất hiện ngay lập tức mà không cần tải lại trang.",
  offline: "Realtime mất kết nối: hàng đợi sẽ không tự cập nhật. Tải lại trang để thử lại."
};

const TONE: Record<RealtimeStatus, string> = {
  connecting: "text-muted-foreground",
  live: "text-success",
  offline: "text-destructive"
};

/** Queue header signal: is the radar actually pushing into this screen? */
export function RealtimeBadge() {
  const status = useRealtimeStatus();

  return (
    <span
      title={TITLE[status]}
      data-realtime-status={status}
      className={cn(
        "border-border bg-background flex min-h-9 items-center gap-2 rounded-md border px-2.5 text-xs font-medium",
        TONE[status]
      )}
    >
      <span className="relative flex size-2">
        <span
          className={cn(
            "absolute inline-flex h-full w-full rounded-full opacity-60",
            // Only the transient "connecting" state animates: a forever-pinging
            // badge keeps the compositor busy on every screen that renders it.
            status === "connecting" ? "bg-current animate-ping" : "bg-current"
          )}
        />
        <span className="bg-current relative inline-flex size-2 rounded-full" />
      </span>
      <RadioIcon className="size-3.5" />
      {LABEL[status]}
    </span>
  );
}
