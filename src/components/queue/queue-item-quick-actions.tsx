"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2Icon, SendIcon, ThumbsDownIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { approveTaskWithDefaults, rejectTask } from "@/lib/actions/comment-tasks";

/**
 * Mobile quick actions on a queue card: approve with the AI draft + default
 * account, or push the post out of the queue. Deliberately two taps max from the
 * lock screen to a queued execution.
 */
export function QueueItemQuickActions({
  taskId,
  keepQuery = "",
  compact = false
}: {
  taskId: string;
  /**
   * Current filter query ("status=…&limit=…"), passed from the server page.
   *
   * Deliberately not `useSearchParams`: that hook suspends on navigation, and a
   * client component using it on this page made same-route filter links fetch the
   * RSC payload and then never commit (the click looked dead in production).
   */
  keepQuery?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function approve() {
    startTransition(async () => {
      const result = await approveTaskWithDefaults(taskId);

      if (!result.ok) {
        toast.error(result.error);
        router.push(`/queue?${keepQuery}task=${taskId}`);
        return;
      }

      toast.success(`Đã xếp hàng cho nick ${result.data.accountName}`, {
        description: `Mã Sub_ID ${result.data.subIdCode} đã được gắn vào link affiliate.`
      });
      router.refresh();
    });
  }

  function reject() {
    startTransition(async () => {
      const result = await rejectTask({ taskId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Đã chuyển vào mục từ chối");
      router.refresh();
    });
  }

  if (compact) {
    return (
      <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        <Button
          size="sm"
          variant="success"
          className="h-11 px-3 text-xs font-medium sm:h-8 sm:px-2.5"
          onClick={approve}
          disabled={pending}
          title="Duyệt nhanh với thiết lập mặc định"
        >
          {pending ? <Loader2Icon className="size-3.5 animate-spin" /> : <SendIcon className="size-3.5" />}
          <span>Duyệt</span>
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="size-11 shrink-0 p-0 text-muted-foreground hover:text-destructive sm:size-8"
          onClick={reject}
          disabled={pending}
          aria-label="Từ chối bài này"
          title="Từ chối bài này"
        >
          <ThumbsDownIcon className="size-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="success"
        className="min-h-11 flex-1 font-medium sm:flex-none"
        onClick={approve}
        disabled={pending}
      >
        {pending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
        Duyệt &amp; Chạy
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="min-h-11 px-3 text-muted-foreground hover:text-destructive"
        onClick={reject}
        disabled={pending}
        aria-label="Từ chối bài viết này"
      >
        <ThumbsDownIcon />
        <span className="sm:sr-only">Từ chối</span>
      </Button>
    </div>
  );
}

