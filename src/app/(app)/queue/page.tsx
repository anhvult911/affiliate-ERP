import type { Metadata } from "next";
import { InboxIcon, LoaderIcon, CheckCheckIcon, ClockIcon } from "lucide-react";

import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { QueueFilters } from "@/components/queue/queue-filters";
import { QueueList } from "@/components/queue/queue-list";
import { RealtimeBadge } from "@/components/queue/realtime-badge";
import { TaskDetail } from "@/components/queue/task-detail";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TASK_STATUSES, type TaskStatus } from "@/lib/constants";
import {
  getQueueCounts,
  getQueueTask,
  getTaskConversions,
  listAssignableAccounts,
  listQueueSourceOptions,
  listQueueTasks
} from "@/lib/data/comment-tasks";
import { parseQueueLimit } from "@/lib/queue/url";

export const metadata: Metadata = { title: "Hàng đợi duyệt bài" };

function parseStatus(raw: string | undefined): TaskStatus {
  return TASK_STATUSES.find((status) => status === raw) ?? "pending_approval";
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The primary workspace (Phân hệ 5–6).
 *
 * Desktop (lg+): split view — list on the left, selected task on the right.
 * Mobile/tablet: one column; tapping a card switches to the task workspace and
 * the list is hidden behind the back button, so no side-scrolling is needed.
 */
export default async function QueuePage({
  searchParams
}: {
  searchParams: Promise<{ status?: string; task?: string; source?: string; limit?: string }>;
}) {
  const params = await searchParams;
  const status = parseStatus(params.status);
  const limit = parseQueueLimit(params.limit);
  // A truncated or hand-edited id must fall back to the unfiltered view instead
  // of throwing a uuid cast error out of PostgREST.
  const sourceId = params.source && UUID_PATTERN.test(params.source) ? params.source : null;
  const requestedTaskId = params.task && UUID_PATTERN.test(params.task) ? params.task : null;

  const [tasks, counts, sources, accounts, loadedTask] = await Promise.all([
    listQueueTasks({ status, sourceId, limit }),
    getQueueCounts(),
    listQueueSourceOptions(),
    listAssignableAccounts(),
    // Independent of the list: the task id comes from the URL, so waiting for the
    // other four before starting this one only added a round trip.
    requestedTaskId ? getQueueTask(requestedTaskId) : Promise.resolve(null)
  ]);
  // The detail pane must belong to the tab that is open, otherwise the pane and
  // the list disagree (and on mobile the list is hidden entirely).
  const selected =
    loadedTask && loadedTask.status === status && (!sourceId || loadedTask.source_id === sourceId)
      ? loadedTask
      : null;

  const conversions = selected
    ? await getTaskConversions({ taskId: selected.id, subIdCode: selected.sub_id_code })
    : [];

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Hàng đợi duyệt"
        description="Các bài viết được radar phát hiện vượt ngưỡng liên quan. Kiểm tra bản nháp AI và bấm duyệt để worker tự động đi bình luận."
        actions={<RealtimeBadge />}
      />

      <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Chờ duyệt" value={counts.pending_approval} tone="warning" icon={ClockIcon} />
        <StatCard label="Đã xếp hàng" value={counts.queued} tone="info" icon={InboxIcon} />
        <StatCard label="Đang chạy" value={counts.running} tone="info" icon={LoaderIcon} />
        <StatCard label="Hoàn thành" value={counts.completed} tone="success" icon={CheckCheckIcon} />
      </div>

      <QueueFilters
        status={status}
        counts={counts}
        sources={sources}
        sourceId={sourceId}
        limit={limit}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(350px,400px)_minmax(0,1fr)] xl:grid-cols-[420px_minmax(0,1fr)] lg:items-start">
        <div
          className={
            // Mobile keeps one pane at a time; lg+ shows both.
            selected ? "hidden space-y-4 lg:block" : "space-y-4"
          }
        >
            <QueueList
              tasks={tasks}
              status={status}
              sourceId={sourceId}
              limit={limit}
              selectedId={selected?.id ?? null}
            />
        </div>

        <div className={selected ? "min-w-0" : "hidden min-w-0 lg:block"}>
          {selected ? (
            <TaskDetail
              task={selected}
              accounts={accounts}
              conversions={conversions}
              status={status}
              sourceId={sourceId}
              limit={limit}
            />
          ) : (
            <Card className="py-4">
              <CardHeader>
                <CardTitle className="text-base">Chọn một bài viết để duyệt</CardTitle>
                <CardDescription>
                  {tasks.length > 0
                    ? "Nhấp vào một bài ở danh sách bên trái để mở bản nháp, sản phẩm và công cụ duyệt."
                    : "Chưa có bài viết nào ở trạng thái này."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <EmptyState
                  icon={InboxIcon}
                  title="Chưa chọn bài viết"
                  description="Bảng chi tiết sẽ hiển thị bài đăng Facebook, bản nháp AI, sản phẩm gợi ý và tài khoản thực thi."
                />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
