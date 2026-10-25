import Link from "next/link";
import { ExternalLinkIcon, InboxIcon } from "lucide-react";

import { EmptyState } from "@/components/patterns/empty-state";
import { ExternalImage } from "@/components/patterns/external-image";
import { ExecutionModeBadge, TaskStatusBadge } from "@/components/patterns/status-badge";
import { QueueItemQuickActions } from "@/components/queue/queue-item-quick-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { QueueTask } from "@/lib/data/comment-tasks";
import { formatMatchScore, formatPercent, formatRelative, formatVnd } from "@/lib/format";
import { asStringArray } from "@/lib/json";
import { buildQueueHref, nextQueueLimit, QUEUE_LIMIT_MAX, type QueueLimit } from "@/lib/queue/url";
import { SOURCE_TYPE_LABEL, TASK_STATUS_LABEL, type TaskStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";

function scoreTone(score: number | null) {
  if (score === null) return "muted" as const;
  if (score >= 0.9) return "success" as const;
  if (score >= 0.8) return "warning" as const;
  return "muted" as const;
}

function PostThumb({ images, alt }: { images: string[]; alt: string }) {
  const first = images[0];

  return (
    <div className="bg-muted relative size-14 shrink-0 overflow-hidden rounded-md border">
      <ExternalImage src={first} alt={alt} sizes="56px" />
    </div>
  );
}

/**
 * Responsive master card list for the approval queue.
 *
 * Designed specifically for split-view layout: clean cards on both desktop
 * (380-440px master pane) and mobile (full-width feed), completely avoiding
 * horizontal scrollbars and overlapping columns.
 */
export function QueueList({
  tasks,
  status,
  sourceId,
  limit,
  selectedId
}: {
  tasks: QueueTask[];
  status: TaskStatus;
  sourceId: string | null;
  limit: QueueLimit;
  selectedId: string | null;
}) {
  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={InboxIcon}
        title={`Không có bài viết nào ở trạng thái ${TASK_STATUS_LABEL[status].toLowerCase()}`}
        description="Radar sẽ tự động ghi bài vào đây ngay khi phát hiện bài đăng vượt ngưỡng. Thêm nguồn theo dõi tại Radar để mở rộng phạm vi quét."
        action={
          <Button asChild variant="outline">
            <Link href="/radar">Mở Radar theo dõi</Link>
          </Button>
        }
      />
    );
  }

  const actionable = status === "pending_approval" || status === "failed";

  return (
    <>
      <div className="flex flex-col gap-3">
        {tasks.map((task) => {
          const images = asStringArray(task.post_images);
          const selected = task.id === selectedId;

          return (
            <Card
              key={task.id}
              className={cn(
                "group relative p-3.5 transition-all",
                selected
                  ? "border-primary ring-2 ring-primary/40 bg-accent/30 shadow-xs"
                  : "hover:border-foreground/20 hover:bg-muted/30"
              )}
            >
              <CardContent className="p-0 space-y-2.5">
                {/* Header: Source Name + Match Badge */}
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={buildQueueHref({ status, sourceId, limit, taskId: task.id })}
                    className="flex min-h-11 min-w-0 flex-1 items-center hover:underline"
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="truncate text-sm font-semibold text-foreground">
                        {task.source?.name ?? "Unknown source"}
                      </span>
                      {task.source ? (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                          {SOURCE_TYPE_LABEL[task.source.source_type]}
                        </Badge>
                      ) : null}
                    </div>
                  </Link>
                  <Badge variant={scoreTone(task.match_score)} className="shrink-0 text-xs tabular-nums">
                    {formatMatchScore(task.match_score)} match
                  </Badge>
                </div>

                {/* Body: Thumbnail + Post Snippet */}
                <Link
                  href={buildQueueHref({ status, sourceId, limit, taskId: task.id })}
                  className="flex min-h-11 items-start gap-3"
                >
                  {images.length > 0 ? (
                    <PostThumb images={images} alt="Post image" />
                  ) : null}
                  <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed flex-1">
                    {task.post_content ?? task.post_url}
                  </p>
                </Link>

                {/* Matched Product Snippet */}
                {task.product ? (
                  <div className="bg-muted/40 flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-xs">
                    <span className="truncate font-medium text-foreground max-w-[65%]">
                      {task.product.name}
                    </span>
                    <span className="text-muted-foreground shrink-0 tabular-nums text-[11px]">
                      {formatVnd(task.product.price)} · {formatPercent(task.product.commission_rate)}
                    </span>
                  </div>
                ) : null}

                {/* Footer: Status, Execution Mode, Timestamp, and Actions */}
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/50">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <TaskStatusBadge status={task.status} />
                    {task.execution_mode === "seeding_2_accounts" ? (
                      <ExecutionModeBadge mode={task.execution_mode} />
                    ) : null}
                    <span className="text-muted-foreground text-[11px] whitespace-nowrap">
                      {formatRelative(task.created_at)}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {actionable ? (
                      <QueueItemQuickActions
                        taskId={task.id}
                        keepQuery={`status=${status}&limit=${limit}&`}
                        compact
                      />
                    ) : (
                      <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs" asChild>
                        <Link href={buildQueueHref({ status, sourceId, limit, taskId: task.id })}>
                          Xem
                        </Link>
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 pt-2">
        <p className="text-muted-foreground text-xs">
          Đang hiển thị {tasks.length} bài viết {TASK_STATUS_LABEL[status].toLowerCase()}.
        </p>
        {tasks.length >= limit && limit < QUEUE_LIMIT_MAX ? (
          <Button variant="outline" size="sm" className="min-h-11" asChild>
            <Link
              href={buildQueueHref({
                status,
                sourceId,
                limit: nextQueueLimit(limit),
                taskId: selectedId
              })}
            >
              Xem thêm
            </Link>
          </Button>
        ) : (
          <Button variant="ghost" size="sm" className="min-h-11" asChild>
            <Link href={buildQueueHref({ status, sourceId, limit, taskId: null })}>
              <ExternalLinkIcon />
              Bỏ chọn bài
            </Link>
          </Button>
        )}
      </div>
    </>
  );
}
