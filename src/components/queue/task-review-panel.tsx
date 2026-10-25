"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2Icon,
  SaveIcon,
  SendIcon,
  ThumbsDownIcon,
  Undo2Icon,
  WandSparklesIcon,
  ZoomInIcon
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalImage } from "@/components/patterns/external-image";
import { ImageLightbox } from "@/components/patterns/image-lightbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { approveTask, rejectTask, returnTaskToApproval, updateTaskDraft } from "@/lib/actions/comment-tasks";
import { EXECUTION_MODE_LABEL, WORKER_LEASE_MINUTES, type ExecutionMode, type TaskStatus } from "@/lib/constants";
import type { AssignableAccount } from "@/lib/queue/assignment";
import { cn } from "@/lib/utils";

const DRAFT_MAX = 2000;

const QUICK_TWEAKS = [
  { label: "⚡ Ngắn gọn hơn", guidance: "Viết ngắn gọn súc tích trong 1-2 câu, đi thẳng vào trọng tâm, không vòng vo" },
  { label: "💬 Hỏi mồi / Tò mò", guidance: "Đóng vai thành viên tò mò muốn hỏi thêm kinh nghiệm thực tế để tạo tương tác tự nhiên" },
  { label: "🔍 Thêm lưu ý thực tế", guidance: "Nhắc khéo một lưu ý hoặc nhược điểm nhỏ từ trải nghiệm thực tế để tăng độ chân thực" },
  { label: "☕ Thân mật / Chân thành", guidance: "Giọng văn chị em thân mật, chia sẻ nhiệt tình và ấm áp" }
];

/** Statuses whose draft the operator may still change and queue. */
const REVIEWABLE: TaskStatus[] = ["pending_approval", "failed"];

function accountLabel(account: AssignableAccount) {
  const suffix = account.status === "active" ? "" : ` · ${account.status}`;
  return `${account.name} · ${account.persona_type} · trust ${account.trust_score}${suffix}`;
}

/**
 * The approval workspace. Everything an operator needs for a single post:
 * edit/regenerate the AI draft, choose the account (and the tier-2 account for
 * seeding), pick which real buyer photo rides along, then approve or reject.
 */
export function TaskReviewPanel({
  taskId,
  status,
  claimedAt,
  initialDraft,
  initialMode,
  initialAccountId,
  initialSecondaryId,
  initialReviewImage,
  accounts,
  reviewImages
}: {
  taskId: string;
  status: TaskStatus;
  claimedAt: string | null;
  initialDraft: string;
  initialMode: ExecutionMode;
  initialAccountId: string | null;
  initialSecondaryId: string | null;
  initialReviewImage: string | null;
  accounts: AssignableAccount[];
  reviewImages: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [generating, setGenerating] = useState(false);

  const [draft, setDraft] = useState(initialDraft);
  const [mode, setMode] = useState<ExecutionMode>(initialMode);
  const [accountId, setAccountId] = useState(initialAccountId ?? "");
  const [secondaryId, setSecondaryId] = useState(initialSecondaryId ?? "");
  const [reviewImage, setReviewImage] = useState(initialReviewImage ?? "");
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const reviewable = REVIEWABLE.includes(status);
  // A running task may only be pulled back once its claim is stale, otherwise the
  // operator could re-approve work a worker is still posting (duplicate comment).
  // Computed in an effect so SSR and hydration agree on the clock.
  const [claimIsStale, setClaimIsStale] = useState(status !== "running");
  useEffect(() => {
    if (status !== "running" || !claimedAt) {
      setClaimIsStale(status !== "running");
      return;
    }
    setClaimIsStale(Date.now() - new Date(claimedAt).getTime() >= WORKER_LEASE_MINUTES * 60_000);
  }, [status, claimedAt]);

  const canReturnToApproval = status === "queued" || status === "failed" || claimIsStale;
  const selectedAccount = accounts.find((account) => account.id === accountId) ?? null;
  const accountWarning =
    selectedAccount && selectedAccount.status !== "active"
      ? `${selectedAccount.name} is ${selectedAccount.status} — the worker will refuse this task.`
      : null;

  function saveDraft() {
    startTransition(async () => {
      const result = await updateTaskDraft(taskId, draft);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Draft saved");
      router.refresh();
    });
  }

  async function generateDraft(guidance?: string) {
    setGenerating(true);
    try {
      const response = await fetch("/api/ai/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId, guidance: guidance || undefined })
      });
      const payload = (await response.json()) as {
        ok: boolean;
        draft?: string;
        followUp?: string | null;
        error?: string;
      };

      if (!response.ok || !payload.ok || !payload.draft) {
        toast.error(payload.error ?? "Gemini could not produce a draft.");
        return;
      }

      setDraft(payload.draft);
      setFollowUp(payload.followUp ?? null);
      toast.success(
        guidance ? "Draft updated with new style" : "Draft regenerated — review before approving"
      );
      router.refresh();
    } catch {
      toast.error("Could not reach the AI route.");
    } finally {
      setGenerating(false);
    }
  }

  function approve() {
    if (!accountId) {
      toast.error("Pick the account that will post the comment.");
      return;
    }

    startTransition(async () => {
      const result = await approveTask({
        taskId,
        accountId,
        secondaryAccountId: mode === "seeding_2_accounts" ? secondaryId || null : null,
        executionMode: mode,
        draft,
        selectedReviewImage: reviewImage || null
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success("Task queued for execution", {
        description: `Sub_ID ${result.data.subIdCode} is appended to the affiliate link.`
      });
      router.refresh();
    });
  }

  function reject() {
    startTransition(async () => {
      const result = await rejectTask({ taskId, reason: rejectReason });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setRejectOpen(false);
      setRejectReason("");
      toast.success("Post rejected");
      router.refresh();
    });
  }

  function returnToApproval() {
    startTransition(async () => {
      const result = await returnTaskToApproval(taskId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Back in the approval queue");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {reviewable ? (
        <>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="draft">Bản nháp bình luận AI</Label>
              <span className="text-muted-foreground text-xs tabular-nums">
                {draft.length}/{DRAFT_MAX}
              </span>
            </div>
            <Textarea
              id="draft"
              value={draft}
              onChange={(event) => setDraft(event.target.value.slice(0, DRAFT_MAX))}
              rows={7}
              placeholder="Nhập nội dung bình luận tài khoản sẽ đăng…"
              className="min-h-40 text-base leading-relaxed"
            />

            {/* Quick AI Tweak Pills */}
            <div className="space-y-1.5 pt-1">
              <span className="text-muted-foreground flex items-center gap-1 text-xs">
                <WandSparklesIcon className="text-primary size-3.5" />
                Chỉnh phong cách nhanh với AI:
              </span>
              <div className="scrollbar-none -mx-1 flex items-center gap-1.5 overflow-x-auto px-1 py-1">
                {QUICK_TWEAKS.map((tweak) => (
                  <button
                    key={tweak.label}
                    type="button"
                    onClick={() => generateDraft(tweak.guidance)}
                    disabled={generating || pending}
                    className="hover:bg-muted/80 bg-muted/40 active:scale-95 inline-flex shrink-0 items-center rounded-full border px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50"
                  >
                    {tweak.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => generateDraft()}
                disabled={generating || pending}
              >
                {generating ? <Loader2Icon className="animate-spin" /> : <WandSparklesIcon />}
                {draft ? "Tạo lại với AI" : "Tạo bản nháp với AI"}
              </Button>
              <Button
                variant="secondary"
                className="min-h-11"
                onClick={saveDraft}
                disabled={pending || draft === initialDraft}
              >
                <SaveIcon />
                Lưu bản nháp
              </Button>
            </div>
          </div>

          {followUp ? (
            <div className="bg-muted/50 space-y-1 rounded-md border p-3">
              <Badge variant="info">Phản hồi mồi tầng 2</Badge>
              <p className="text-sm whitespace-pre-wrap">{followUp}</p>
              <p className="text-muted-foreground text-xs">
                Được đăng dưới dạng phản hồi từ nick thứ 2 để tăng tính thảo luận tự nhiên.
              </p>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="account">Tài khoản đăng</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger id="account" className="w-full">
                  <SelectValue placeholder="Chọn tài khoản" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem
                      key={account.id}
                      value={account.id}
                      disabled={account.status === "checkpoint" || !account.browser_profile_id}
                    >
                      {accountLabel(account)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {accountWarning ? (
                <p className="text-warning text-xs">{accountWarning}</p>
              ) : null}
              {accounts.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  Chưa có tài khoản nào được gắn profile trình duyệt — hãy thêm trong mục Dàn tài khoản.
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label>Chế độ thực thi</Label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(EXECUTION_MODE_LABEL) as ExecutionMode[]).map((value) => (
                  <Button
                    key={value}
                    type="button"
                    variant={mode === value ? "default" : "outline"}
                    className="min-h-11"
                    aria-pressed={mode === value}
                    onClick={() => setMode(value)}
                  >
                    {EXECUTION_MODE_LABEL[value]}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {mode === "seeding_2_accounts" ? (
            <div className="space-y-2">
              <Label htmlFor="secondary">Tài khoản tầng 2 (trả lời bình luận mồi)</Label>
              <Select value={secondaryId} onValueChange={setSecondaryId}>
                <SelectTrigger id="secondary" className="w-full">
                  <SelectValue placeholder="Chọn tài khoản thứ 2" />
                </SelectTrigger>
                <SelectContent>
                  {accounts
                    .filter((account) => account.id !== accountId)
                    .map((account) => (
                      <SelectItem
                        key={account.id}
                        value={account.id}
                        disabled={account.status === "checkpoint" || !account.browser_profile_id}
                      >
                        {accountLabel(account)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {reviewImages.length > 0 ? (
            <div className="space-y-2">
              <Label>Đính kèm ảnh review thực tế của người mua</Label>
              <div className="snap-rail gap-2">
                <button
                  type="button"
                  onClick={() => setReviewImage("")}
                  className={cn(
                    "flex h-20 w-20 shrink-0 snap-start items-center justify-center rounded-md border text-xs",
                    reviewImage === "" ? "border-primary text-primary" : "text-muted-foreground"
                  )}
                >
                  Không ảnh
                </button>
                {reviewImages.map((url) => (
                  <div
                    key={url}
                    className={cn(
                      "group relative h-20 w-20 shrink-0 snap-start overflow-hidden rounded-md border-2",
                      reviewImage === url ? "border-primary" : "border-transparent"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setReviewImage(url)}
                      aria-pressed={reviewImage === url}
                      className="size-full text-left"
                    >
                      <ExternalImage src={url} alt="Buyer review photo" sizes="80px" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setLightboxUrl(url);
                      }}
                      className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-black/60 text-white opacity-80 backdrop-blur transition-opacity hover:opacity-100 hover:bg-black/90 active:scale-90"
                      title="Phóng to soi watermark/chi tiết"
                    >
                      <ZoomInIcon className="size-3.5" />
                      <span className="sr-only">Phóng to</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {reviewImages.length > 0 ? (
            <ImageLightbox
              images={reviewImages}
              initialIndex={lightboxUrl ? Math.max(0, reviewImages.indexOf(lightboxUrl)) : 0}
              open={Boolean(lightboxUrl)}
              onOpenChange={(open) => !open && setLightboxUrl(null)}
              title="Ảnh đánh giá sản phẩm (Buyer Review)"
            />
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="success"
              size="block"
              className="sm:flex-1"
              onClick={approve}
              disabled={pending}
            >
              {pending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
              Duyệt &amp; Chạy
            </Button>
            <Button
              variant="outline"
              size="block"
              className="sm:w-auto"
              onClick={() => setRejectOpen(true)}
              disabled={pending}
            >
              <ThumbsDownIcon />
              Từ chối
            </Button>
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <div className="bg-muted/50 rounded-md border p-3">
            <p className="text-sm font-medium">Bài viết này đang ở trạng thái {status.replace("_", " ")}.</p>
            <p className="text-muted-foreground text-xs">
              Các tùy chọn phê duyệt đã bị khóa. Hãy chuyển về trạng thái chờ duyệt nếu muốn chỉnh sửa lại nháp.
            </p>
          </div>
          {canReturnToApproval ? (
            <Button variant="outline" size="block" onClick={returnToApproval} disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" /> : <Undo2Icon />}
              Chuyển về chờ duyệt
            </Button>
          ) : (
            <p className="text-muted-foreground text-xs">
              Một worker đã nhận nhiệm vụ này và có thể đang tiến hành bình luận. Có thể chuyển về chờ duyệt sau {WORKER_LEASE_MINUTES} phút nếu tác vụ bị kẹt.
            </p>
          )}
        </div>
      )}

      {/* Mobile Sticky Action Bar — keeps Approve/Reject within instant thumb reach */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 p-3 pb-safe shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:hidden">
        {reviewable ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="lg"
              className="min-h-12 px-4 shrink-0"
              onClick={() => setRejectOpen(true)}
              disabled={pending}
              aria-label="Từ chối bài này"
            >
              <ThumbsDownIcon className="text-destructive size-5" />
              <span className="sr-only sm:not-sr-only sm:text-xs">Từ chối</span>
            </Button>
            <Button
              variant="success"
              size="lg"
              className="min-h-12 flex-1 text-sm font-semibold shadow-md active:scale-[0.99]"
              onClick={approve}
              disabled={pending}
            >
              {pending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
              Duyệt &amp; Chạy
            </Button>
          </div>
        ) : canReturnToApproval ? (
          <Button
            variant="outline"
            size="block"
            className="min-h-12"
            onClick={returnToApproval}
            disabled={pending}
          >
            {pending ? <Loader2Icon className="animate-spin" /> : <Undo2Icon />}
            Chuyển về chờ duyệt
          </Button>
        ) : null}
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Từ chối bài viết này</DialogTitle>
            <DialogDescription>
              Bài viết sẽ được chuyển vào mục Đã từ chối. Lý do từ chối sẽ được lưu lại để cải thiện gợi ý AI sau này.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value.slice(0, 500))}
            rows={3}
            placeholder="vd: Bài viết cảnh báo phốt sản phẩm, không có nhu cầu mua hàng..."
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={pending}>
              Hủy
            </Button>
            <Button variant="destructive" onClick={reject} disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" /> : <ThumbsDownIcon />}
              Xác nhận từ chối
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
