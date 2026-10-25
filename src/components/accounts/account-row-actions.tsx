"use client";

import { useState } from "react";
import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { AccountForm } from "@/components/accounts/account-form-dialog";
import { SubmitButton } from "@/components/patterns/submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { deleteAccount } from "@/lib/actions/accounts";
import type { AccountRow } from "@/lib/data/accounts";
import { useFormAction } from "@/lib/hooks/use-form-action";

function DeleteAccountDialog({
  account,
  open,
  onOpenChange
}: {
  account: AccountRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { pending, submit } = useFormAction(
    async () => deleteAccount(account.id),
    {
      onSuccess: () => {
        toast.success("Đã xóa tài khoản");
        onOpenChange(false);
      },
      onError: (message) => toast.error(message)
    }
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete account</DialogTitle>
          <DialogDescription>
            {account.name} và lịch nuôi persona sẽ bị xóa. Các task đã gán cho nick này
            vẫn nằm trong hàng đợi nhưng mất liên kết tài khoản.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" size="lg" className="w-full sm:w-auto">
                Huỷ
              </Button>
            </DialogClose>
            <SubmitButton
              variant="destructive"
              size="lg"
              className="w-full sm:w-auto"
              pending={pending}
              pendingLabel="Đang xóa…"
            >
              Delete account
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AccountRowActions({
  account,
  personaTypes
}: {
  account: AccountRow;
  personaTypes: string[];
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for ${account.name}`}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>
            <PencilIcon />
            Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sửa tài khoản</DialogTitle>
            <DialogDescription>
              Update identity, status and the persona warming schedule.
            </DialogDescription>
          </DialogHeader>
          <AccountForm
            account={account}
            personaTypes={personaTypes}
            onSuccess={() => setEditOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <DeleteAccountDialog
        account={account}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </>
  );
}
