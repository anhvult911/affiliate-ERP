"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { SubmitButton } from "@/components/patterns/submit-button";
import { useFormAction } from "@/lib/hooks/use-form-action";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { deleteSource } from "@/lib/actions/target-sources";

export function DeleteSourceDialog({
  sourceId,
  sourceName,
  redirectTo,
  open: controlledOpen,
  onOpenChange
}: {
  sourceId: string;
  sourceName: string;
  /** Navigate here after deletion (detail page); otherwise the current list refreshes. */
  redirectTo?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const { pending, submit } = useFormAction(
    async () => deleteSource(sourceId),
    {
      onSuccess: () => {
        toast.success(`Đã xóa “${sourceName}” khỏi radar.`);
        setOpen(false);
        if (redirectTo) router.push(redirectTo);
        else router.refresh();
      },
      onError: (message) => toast.error(message)
    }
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {controlledOpen === undefined ? (
        <DialogTrigger asChild>
          <Button variant="destructive" size="lg" className="w-full sm:w-auto">
            <Trash2Icon />
            Xóa
          </Button>
        </DialogTrigger>
      ) : null}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Xóa “{sourceName}”?</DialogTitle>
          <DialogDescription>
            Worker sẽ dừng quét nguồn này ngay. Không thể hoàn tác.
          </DialogDescription>
        </DialogHeader>

        <Alert>
          <AlertTitle>Các bài đã bắt được vẫn giữ</AlertTitle>
          <AlertDescription>
            Bài đã quét và bản nháp AI vẫn nằm trong hàng đợi duyệt và analytics; chỉ mất liên kết
            tới nguồn này.
          </AlertDescription>
        </Alert>

        <form onSubmit={submit}>
          <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <Button type="button" variant="outline" size="lg" className="w-full sm:w-auto">
                Keep source
              </Button>
            </DialogClose>
            <SubmitButton
              variant="destructive"
              size="lg"
              className="w-full sm:w-auto"
              pending={pending}
              pendingLabel="Đang xóa…"
            >
              <Trash2Icon />
              Xóa nguồn
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
