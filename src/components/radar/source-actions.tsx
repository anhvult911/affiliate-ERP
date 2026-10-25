"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ExternalLinkIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  ScanLineIcon,
  Trash2Icon
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from "@/components/ui/sheet";
import { markSourceScanned } from "@/lib/actions/target-sources";

import { DeleteSourceDialog } from "./delete-source-dialog";
import { SourceFormDialog, type SourceFormSource } from "./source-form-dialog";

/**
 * One action surface for both list layouts: a dropdown on the desktop table and
 * a bottom action sheet on the mobile card. The edit/delete dialogs are shared.
 */
export function SourceActions({
  source,
  variant
}: {
  source: SourceFormSource;
  variant: "menu" | "sheet";
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [markPending, startMark] = useTransition();

  function markScanned() {
    startMark(async () => {
      const result = await markSourceScanned(source.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success("Scan clock reset — the worker skips this source until the interval elapses.");
      router.refresh();
    });
  }

  const dialogs = (
    <>
      <SourceFormDialog
        mode="edit"
        source={source}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
      <DeleteSourceDialog
        sourceId={source.id}
        sourceName={source.name}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </>
  );

  if (variant === "menu") {
    return (
      <div className="flex items-center justify-end gap-1">
        <Button asChild variant="ghost" size="icon-sm">
          <Link href={`/radar/${source.id}`} aria-label={`Open ${source.name}`}>
            <ExternalLinkIcon />
          </Link>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${source.name}`}>
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/radar/${source.id}`}>
                <ExternalLinkIcon />
                View details
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setEditOpen(true)}>
              <PencilIcon />
              Edit source
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={markScanned} disabled={markPending}>
              <ScanLineIcon />
              Mark scanned now
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
              <Trash2Icon />
              Remove source
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {dialogs}
      </div>
    );
  }

  return (
    <>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="icon" aria-label={`Actions for ${source.name}`}>
            <MoreHorizontalIcon />
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="px-4 pt-4">
          <SheetHeader className="px-0">
            <SheetTitle className="truncate pr-10">{source.name}</SheetTitle>
            <SheetDescription>Manage this radar source.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-2 pb-2">
            <Button asChild variant="outline" size="lg" className="justify-start">
              <Link href={`/radar/${source.id}`}>
                <ExternalLinkIcon />
                View details
              </Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="justify-start"
              onClick={() => {
                setSheetOpen(false);
                setEditOpen(true);
              }}
            >
              <PencilIcon />
              Edit source
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="justify-start"
              onClick={() => {
                setSheetOpen(false);
                markScanned();
              }}
              disabled={markPending}
            >
              {markPending ? <Loader2Icon className="animate-spin" /> : <ScanLineIcon />}
              Mark scanned now
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="lg"
              className="justify-start"
              onClick={() => {
                setSheetOpen(false);
                setDeleteOpen(true);
              }}
            >
              <Trash2Icon />
              Remove source
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {dialogs}
    </>
  );
}
