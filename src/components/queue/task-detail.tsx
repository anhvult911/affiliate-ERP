import Link from "next/link";
import { ArrowLeftIcon, ExternalLinkIcon, TriangleAlertIcon } from "lucide-react";

import { CopyButton } from "@/components/patterns/copy-button";
import { ExecutionModeBadge, TaskStatusBadge } from "@/components/patterns/status-badge";
import { PostImagesViewer } from "@/components/queue/post-images-viewer";
import { TaskReviewPanel } from "@/components/queue/task-review-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { SOURCE_TYPE_LABEL } from "@/lib/constants";
import type { QueueAccount, QueueConversionRow, QueueTask } from "@/lib/data/comment-tasks";
import { formatDateTime, formatHostname, formatMatchScore, formatPercent, formatRelative, formatVnd } from "@/lib/format";
import { asStringArray } from "@/lib/json";
import { buildQueueHref } from "@/lib/queue/url";
import type { TaskStatus } from "@/lib/constants";

function scoreTone(score: number | null) {
  if (score === null) return "muted" as const;
  if (score >= 0.9) return "success" as const;
  if (score >= 0.8) return "warning" as const;
  return "muted" as const;
}

/**
 * Single-task workspace: the captured post, the matched product, the approval
 * panel and the attribution/execution record. On desktop it fills the right pane
 * of the split view; below lg it is the whole screen after tapping a card.
 */
export function TaskDetail({
  task,
  accounts,
  conversions,
  status,
  sourceId,
  limit
}: {
  task: QueueTask;
  accounts: QueueAccount[];
  conversions: QueueConversionRow[];
  status: TaskStatus;
  sourceId: string | null;
  limit: number;
}) {
  const postImages = asStringArray(task.post_images);
  const reviewImages = asStringArray(task.product?.review_images);
  const activeConversions = conversions.filter((row) => row.status !== "canceled");
  const revenue = activeConversions.reduce((total, row) => total + Number(row.order_amount), 0);
  const commission = activeConversions.reduce(
    (total, row) => total + Number(row.estimated_commission),
    0
  );

  return (
    <div className="space-y-4 pb-24 lg:pb-0">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" className="lg:hidden" asChild>
          <Link href={buildQueueHref({ status, sourceId, limit, taskId: null })}>
            <ArrowLeftIcon />
            Quay lại hàng đợi
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <TaskStatusBadge status={task.status} />
          <ExecutionModeBadge mode={task.execution_mode} />
        </div>
      </div>

      {/* Captured post */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            {task.source?.name ?? "Unknown source"}
            {task.source ? (
              <Badge variant="outline">{SOURCE_TYPE_LABEL[task.source.source_type]}</Badge>
            ) : null}
            <Badge variant={scoreTone(task.match_score)}>
              {formatMatchScore(task.match_score)} match
            </Badge>
          </CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span>{formatDateTime(task.created_at)}</span>
            <span aria-hidden>·</span>
            <span>{formatHostname(task.post_url)}</span>
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-3">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {task.post_content ?? "Radar không lưu được văn bản bài viết — mở bài gốc để kiểm tra."}
          </p>

          <PostImagesViewer images={postImages} />

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={task.post_url} target="_blank" rel="noreferrer">
                <ExternalLinkIcon />
                Mở bài viết gốc
              </a>
            </Button>
            {task.sub_id_code ? (
              <span className="flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-xs">
                {task.sub_id_code}
                <CopyButton value={task.sub_id_code} label="Sao chép Sub_ID" />
              </span>
            ) : null}
          </div>

          {task.review_note ? (
            <p className="bg-muted/50 rounded-md border p-3 text-xs">
              <span className="font-medium">Ghi chú của Operator:</span> {task.review_note}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Matched product */}
      {task.product ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{task.product.name}</CardTitle>
            <CardDescription>
              {formatVnd(task.product.price)} · {formatPercent(task.product.commission_rate)}{" "}
              hoa hồng{task.product.niche ? ` · ${task.product.niche}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {task.product.pros_cons_summary ? (
              <p className="text-muted-foreground text-sm">{task.product.pros_cons_summary}</p>
            ) : null}
            <div className="flex items-center gap-2 rounded-md border px-2 py-1">
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                {task.product.affiliate_short_link}
              </span>
              <CopyButton value={task.product.affiliate_short_link} label="Sao chép link affiliate" />
              <Button variant="ghost" size="icon-sm" asChild>
                <a
                  href={task.product.affiliate_short_link}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Mở link affiliate"
                >
                  <ExternalLinkIcon />
                </a>
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Mã Sub_ID sẽ được gắn tự động: <span className="font-mono">{task.sub_id_code ?? "(sinh khi duyệt)"}</span>
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Approval workspace */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bảng phê duyệt</CardTitle>
          <CardDescription>
            Chỉnh sửa bản nháp AI, chọn tài khoản đăng, sau đó bấm duyệt để đưa vào hàng đợi worker.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TaskReviewPanel
            taskId={task.id}
            status={task.status}
            claimedAt={task.claimed_at}
            initialDraft={task.ai_draft_comment ?? ""}
            initialMode={task.execution_mode}
            initialAccountId={task.assigned_account_id}
            initialSecondaryId={task.secondary_account_id}
            initialReviewImage={task.selected_review_image}
            accounts={accounts}
            reviewImages={reviewImages}
          />
        </CardContent>
      </Card>

      {/* Execution record */}
      {task.status !== "pending_approval" && task.status !== "rejected" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nhật ký thực thi</CardTitle>
            <CardDescription>Tiến trình worker tự động xử lý bài viết này.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <dt className="text-muted-foreground text-xs">Đã duyệt</dt>
                <dd className="text-xs">{formatDateTime(task.approved_at)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Nhận việc</dt>
                <dd className="text-xs">{formatDateTime(task.claimed_at)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Đã đăng</dt>
                <dd className="text-xs">{formatDateTime(task.executed_at)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Số lần thử</dt>
                <dd className="text-xs tabular-nums">{task.attempt_count}</dd>
              </div>
            </dl>

            <Separator />

            <div className="space-y-1 text-xs">
              <p>
                <span className="text-muted-foreground">Nick chính:</span>{" "}
                {task.account?.name ?? "chưa gán"}
                {task.account ? ` · ${task.account.persona_type}` : ""}
              </p>
              {task.secondary ? (
                <p>
                  <span className="text-muted-foreground">Nick tầng 2:</span>{" "}
                  {task.secondary.name} · {task.secondary.persona_type}
                </p>
              ) : null}
              {task.claimed_by ? (
                <p>
                  <span className="text-muted-foreground">Worker:</span> {task.claimed_by}
                </p>
              ) : null}
            </div>

            {task.last_error ? (
              <div className="border-destructive/40 bg-destructive/5 text-destructive flex items-start gap-2 rounded-md border p-3 text-xs">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
                <span>{task.last_error}</span>
              </div>
            ) : null}

            {task.execution_note ? (
              <div className="border-warning/40 bg-warning/5 flex items-start gap-2 rounded-md border p-3 text-xs">
                <TriangleAlertIcon className="text-warning mt-0.5 size-4 shrink-0" />
                <span>
                  <span className="font-medium">Ghi chú worker:</span> {task.execution_note}
                </span>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Attribution */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Đối soát đơn hàng &amp; Doanh thu</CardTitle>
          <CardDescription>
            Đơn hàng ghi nhận qua {task.sub_id_code ? <span className="font-mono">{task.sub_id_code}</span> : "mã Sub_ID của bài này"}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {conversions.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Chưa có đơn hàng phát sinh. Khi có chuyển đổi từ mã Sub_ID, hệ thống postback sẽ tự động ghi nhận tại đây.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Đơn hàng</p>
                  <p className="font-semibold tabular-nums">{activeConversions.length}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Doanh thu</p>
                  <p className="font-semibold tabular-nums">{formatVnd(revenue)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Hoa hồng</p>
                  <p className="font-semibold tabular-nums">{formatVnd(commission)}</p>
                </div>
              </div>
              <ul className="divide-y rounded-md border text-sm">
                {conversions.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-xs">
                        {row.external_order_id ?? row.sub_id}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {formatRelative(row.converted_at)}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-xs tabular-nums">{formatVnd(row.order_amount)}</span>
                      <Badge
                        variant={
                          row.status === "settled"
                            ? "success"
                            : row.status === "pending"
                              ? "warning"
                              : "muted"
                        }
                      >
                        {row.status}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
