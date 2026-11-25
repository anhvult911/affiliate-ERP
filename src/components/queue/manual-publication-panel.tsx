"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarClockIcon,
  CheckCheckIcon,
  ExternalLinkIcon,
  Link2Icon,
  Loader2Icon,
  ShieldCheckIcon,
  TriangleAlertIcon
} from "lucide-react";
import { toast } from "sonner";

import { CopyButton } from "@/components/patterns/copy-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getTaskTrackedLink, recordManualPublication, type TrackedAffiliateLink } from "@/lib/actions/comment-tasks";
import type { TaskStatus } from "@/lib/constants";

/**
 * Fixed zone so the server-rendered recorded state and the hydrated browser state
 * agree (a client component must not format with the process timezone).
 */
const vnDateTime = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

/**
 * Manual affiliate workflow for draft-only mode (and for any operator who chooses to
 * publish by hand).
 *
 * The steps are deliberately separate: first mint/reuse the stable Sub_ID and get the
 * authoritative tracked URL, then record the real permalink/time of the comment the
 * operator posted. Nothing here calls Facebook or a browser; recording only changes the
 * task to `manually_published`, which the worker can never claim.
 */
export function ManualPublicationPanel({
  taskId,
  status,
  subIdCode,
  manualPostUrl,
  manualPublishedAt,
  manualPublishedBy,
  draft
}: {
  taskId: string;
  status: TaskStatus;
  subIdCode: string | null;
  manualPostUrl: string | null;
  manualPublishedAt: string | null;
  manualPublishedBy: string | null;
  draft: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [link, setLink] = useState<TrackedAffiliateLink | null>(null);
  const [linkPending, setLinkPending] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const [permalink, setPermalink] = useState("");
  const [publishedAt, setPublishedAt] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const recorded = Boolean(manualPostUrl && manualPublishedAt);
  const canRecord = status === "pending_approval" || status === "failed" || status === "dry_run";
  const displaySubId = link?.subIdCode ?? subIdCode;

  // Set the clock after mount so SSR and hydration agree on "now". A
  // `datetime-local` value is local wall time, not the UTC `toISOString()` form.
  useEffect(() => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
    setPublishedAt(local.toISOString().slice(0, 16));
  }, []);

  async function fetchTrackedLink() {
    setLinkPending(true);
    setLinkError(null);
    try {
      const result = await getTaskTrackedLink(taskId);
      if (!result.ok) {
        setLink(null);
        setLinkError(result.error);
        return;
      }
      setLink(result.data);
      toast.success("Đã tạo link tracking", {
        description:
          result.data.verification === "shopee_api"
            ? "Shopee đã xác nhận link rút gọn có gắn Sub_ID."
            : "Link affiliate đã được gắn Sub_ID theo tham số tracking đang cấu hình."
      });
    } catch {
      setLink(null);
      setLinkError("Không gọi được máy chủ để tạo link tracking — vui lòng thử lại.");
    } finally {
      setLinkPending(false);
    }
  }

  function record() {
    const parsed = new Date(publishedAt);
    if (Number.isNaN(parsed.getTime())) {
      toast.error("Thời điểm đăng không hợp lệ.");
      return;
    }

    startTransition(async () => {
      const result = await recordManualPublication({
        taskId,
        permalink,
        publishedAt: parsed.toISOString()
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setConfirmOpen(false);
      toast.success("Đã ghi nhận bài đăng thủ công", {
        description: `Sub_ID ${result.data.subIdCode} vẫn là mã đối soát hoa hồng của bài này.`
      });
      router.refresh();
    });
  }

  if (recorded && manualPostUrl && manualPublishedAt) {
    return (
      <div className="space-y-3" id="manual-publication">
        <div className="border-success/40 bg-success/5 rounded-md border p-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <CheckCheckIcon className="text-success size-4" />
            Đã đăng thủ công — không chạy worker tự động
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            Hệ thống chỉ ghi lại permalink và thời điểm do operator cung cấp. Không có bài
            đăng tự động nào được tạo.
          </p>
        </div>

        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="min-w-0 space-y-1">
            <dt className="text-muted-foreground text-xs">Permalink đã đăng</dt>
            <dd className="flex items-center gap-1">
              <a
                href={manualPostUrl}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate font-mono text-xs underline"
              >
                {manualPostUrl}
              </a>
              <CopyButton value={manualPostUrl} label="Sao chép permalink" />
              <Button variant="ghost" size="icon-sm" asChild>
                <a href={manualPostUrl} target="_blank" rel="noreferrer" aria-label="Mở bài đã đăng">
                  <ExternalLinkIcon />
                </a>
              </Button>
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-muted-foreground text-xs">Thời điểm operator ghi nhận</dt>
            <dd>{vnDateTime.format(new Date(manualPublishedAt))}</dd>
          </div>
          <div className="space-y-1">
            <dt className="text-muted-foreground text-xs">Sub_ID đối soát</dt>
            <dd className="flex items-center gap-1 font-mono text-xs">
              {displaySubId ?? "—"}
              {displaySubId ? <CopyButton value={displaySubId} label="Sao chép Sub_ID" /> : null}
            </dd>
          </div>
          {manualPublishedBy ? (
            <div className="space-y-1">
              <dt className="text-muted-foreground text-xs">Operator</dt>
              <dd className="truncate text-xs">{manualPublishedBy}</dd>
            </div>
          ) : null}
        </dl>
      </div>
    );
  }

  if (!canRecord) return null;

  return (
    <div className="space-y-4" id="manual-publication">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">1. Lấy link tracking đã xác thực</p>
            <p className="text-muted-foreground text-xs">
              Sub_ID được tạo một lần và giữ nguyên cho mọi lần sao chép, kể cả khi bạn
              chưa duyệt bài.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={fetchTrackedLink}
            disabled={linkPending}
          >
            {linkPending ? <Loader2Icon className="animate-spin" /> : <Link2Icon />}
            {link ? "Lấy lại link" : "Lấy link tracking"}
          </Button>
        </div>

        {displaySubId ? (
          <p className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Sub_ID:</span>
            <span className="font-mono">{displaySubId}</span>
            <CopyButton value={displaySubId} label="Sao chép Sub_ID" />
          </p>
        ) : null}

        {linkError ? (
          <div className="border-destructive/40 bg-destructive/5 text-destructive flex items-start gap-2 rounded-md border p-3 text-xs">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            <span className="break-words">{linkError}</span>
          </div>
        ) : null}

        {link ? (
          <div className="space-y-1 rounded-md border p-3">
            <div className="flex items-center gap-2">
              <Badge variant={link.verification === "shopee_api" ? "success" : "info"}>
                <ShieldCheckIcon />
                {link.verification === "shopee_api" ? "Shopee API xác thực" : "Tham số tracking"}
              </Badge>
              <span className="text-muted-foreground text-xs">
                {link.verification === "shopee_api"
                  ? "Shopee đã tạo link rút gọn với Sub_ID."
                  : "Đã gắn Sub_ID bằng tham số tracking đang cấu hình cho sàn này."}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="min-w-0 flex-1 break-all font-mono text-xs">{link.link}</span>
              <CopyButton value={link.link} label="Sao chép link tracking" />
              <Button variant="ghost" size="icon-sm" asChild>
                <a href={link.link} target="_blank" rel="noreferrer" aria-label="Mở link tracking">
                  <ExternalLinkIcon />
                </a>
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Chỉ dùng đúng link này trong bình luận. Không thay bằng link affiliate gốc.
            </p>
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">2. Đăng bình luận bằng tay</p>
            <p className="text-muted-foreground text-xs">
              Mở bài viết gốc, đăng nội dung và link tracking ở trên. Hệ thống không tự
              động làm bước này.
            </p>
          </div>
          {draft.trim() ? (
            <CopyButton
              value={draft}
              label="Sao chép nội dung bình luận"
              variant="outline"
              size="default"
              className="min-h-11"
            />
          ) : null}
        </div>
      </div>

      <div className="space-y-3 rounded-md border p-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <CalendarClockIcon className="size-4" />
          3. Ghi nhận bài đã đăng
        </p>

        <div className="space-y-2">
          <Label htmlFor="manual-permalink">Permalink của bình luận đã đăng</Label>
          {!link && !subIdCode ? (
            <p className="text-warning text-xs">
              Bạn chưa lấy link tracking trong phiên này. Hãy làm bước 1 trước khi ghi nhận
              để chắc chắn Sub_ID có trong bình luận đã đăng.
            </p>
          ) : null}
          <Input
            id="manual-permalink"
            type="url"
            inputMode="url"
            placeholder="https://www.facebook.com/groups/...?comment_id=..."
            value={permalink}
            onChange={(event) => setPermalink(event.target.value)}
            disabled={pending}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="manual-published-at">Thời điểm đăng thực tế</Label>
          <Input
            id="manual-published-at"
            type="datetime-local"
            value={publishedAt}
            onChange={(event) => setPublishedAt(event.target.value)}
            disabled={pending}
          />
        </div>

        <Button
          type="button"
          variant="success"
          size="block"
          className="min-h-11"
          onClick={() => setConfirmOpen(true)}
          disabled={pending || !permalink.trim() || !publishedAt}
        >
          <CheckCheckIcon />
          Ghi nhận đã đăng thủ công
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Xác nhận đã đăng thủ công?</DialogTitle>
            <DialogDescription>
              Hệ thống sẽ lưu permalink và thời điểm bạn cung cấp, chuyển bài sang trạng thái
              &quot;Đã đăng thủ công&quot; và khóa worker tự động cho bài này. Không có API
              Facebook hay trình duyệt nào được gọi.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1 text-xs">
            <p className="break-all">
              <span className="text-muted-foreground">Permalink:</span> {permalink}
            </p>
            <p>
              <span className="text-muted-foreground">Thời điểm:</span>{" "}
              {publishedAt ? vnDateTime.format(new Date(publishedAt)) : "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Sub_ID:</span>{" "}
              <span className="font-mono">{displaySubId ?? "chưa tạo"}</span>
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={pending}>
              Hủy
            </Button>
            <Button variant="success" onClick={record} disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" /> : <CheckCheckIcon />}
              Xác nhận đã đăng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
