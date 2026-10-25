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
import { deleteProduct } from "@/lib/actions/products";

export function ProductDeleteDialog({
  productId,
  productName,
  redirectTo
}: {
  productId: string;
  productName: string;
  /** List stays put and refreshes; detail page navigates back to the pool. */
  redirectTo?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const { pending, submit } = useFormAction(
    async () => deleteProduct(productId),
    {
      onSuccess: () => {
        toast.success("Đã xóa sản phẩm");
        setOpen(false);
        if (redirectTo) router.push(redirectTo);
        else router.refresh();
      },
      onError: (message) => toast.error(message)
    }
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="lg" className="w-full sm:w-auto">
          <Trash2Icon />
          Xóa
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Xác nhận xóa sản phẩm?</DialogTitle>
          <DialogDescription>
            Thao tác này sẽ gỡ bỏ <span className="text-foreground font-medium">{productName}</span> khỏi
            kho sản phẩm affiliate. Thao tác không thể hoàn tác.
          </DialogDescription>
        </DialogHeader>

        <Alert variant="destructive">
          <AlertTitle>Lịch sử tác vụ vẫn được lưu trữ</AlertTitle>
          <AlertDescription>
            Các tác vụ bình luận đã tạo vẫn sẽ nằm trong hàng đợi, nhưng liên kết sản phẩm khớp sẽ đặt về trống.
          </AlertDescription>
        </Alert>

        <form onSubmit={submit}>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="lg" className="w-full sm:w-auto">
                Hủy
              </Button>
            </DialogClose>
            <SubmitButton
              variant="destructive"
              size="lg"
              pending={pending}
              pendingLabel="Đang xóa…"
              className="w-full sm:w-auto"
            >
              Xóa sản phẩm
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
