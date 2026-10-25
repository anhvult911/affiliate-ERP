"use client";

import Link from "next/link";
import { FilterIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { TASK_STATUS_LABEL, TASK_STATUSES, type TaskStatus } from "@/lib/constants";
import { buildQueueHref, type QueueUrlState } from "@/lib/queue/url";
import { cn } from "@/lib/utils";

type SourceOption = { id: string; name: string };

const ALL_SOURCES = "all";

/**
 * Status rail + source filter. Every state change is a plain link built by
 * buildQueueHref, so the mobile back gesture restores the previous filter and a
 * filtered queue can be shared as a URL.
 */
export function QueueFilters({
  status,
  counts,
  sources,
  sourceId,
  limit
}: {
  status: TaskStatus;
  counts: Record<TaskStatus, number> & { total: number };
  sources: SourceOption[];
  sourceId: string | null;
  limit: number;
}) {
  const sourceFilter = (
    <Select
      value={sourceId ?? ALL_SOURCES}
      onValueChange={(value) => {
        const next = value === ALL_SOURCES ? null : value;
        window.location.assign(buildQueueHref({ status, sourceId: next, limit }));
      }}
    >
      <SelectTrigger className="w-full sm:w-64">
        <SelectValue placeholder="Tất cả nguồn" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_SOURCES}>Tất cả nguồn radar</SelectItem>
        {sources.map((source) => (
          <SelectItem key={source.id} value={source.id}>
            {source.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const state: QueueUrlState = { status, sourceId, limit };

  return (
    <div className="flex flex-col gap-3">
      {/* Mobile: swipeable rail — announces each status and its backlog size. */}
      <div className="snap-rail -mx-4 gap-2 px-4 pb-1 lg:mx-0 lg:px-0">
        {TASK_STATUSES.map((value) => {
          const active = value === status;
          const href = buildQueueHref({ ...state, status: value });

          return (
            <a
              key={value}
              href={href}
              // Real navigation on purpose. Client-side transitions to a new
              // `?status=` on the same route were unreliable in production: the RSC
              // payload arrived (200) but the router never committed, so the click
              // looked dead. A normal navigation always works; the page renders in
              // ~60ms on the server, so the cost is one paint, not a spinner.
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-11 shrink-0 snap-start items-center gap-2 rounded-full border px-3 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground border-transparent"
                  : "bg-background text-muted-foreground hover:text-foreground"
              )}
            >
              {TASK_STATUS_LABEL[value]}
              <Badge variant={active ? "secondary" : "muted"} className="tabular-nums">
                {counts[value]}
              </Badge>
            </a>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden flex-1 sm:block">{sourceFilter}</div>

        {/* Mobile: filters live in a bottom sheet so the list keeps the screen. */}
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="block" className="sm:hidden">
              <FilterIcon />
              {sourceId ? "Đang lọc nguồn" : "Lọc theo nguồn"}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom">
            <SheetHeader>
              <SheetTitle>Lọc hàng đợi theo nguồn</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-3 p-4">
              {sourceFilter}
              {sourceId ? (
                <Button variant="secondary" size="block" asChild>
                  <Link href={buildQueueHref({ ...state, sourceId: null })}>Xóa bộ lọc nguồn</Link>
                </Button>
              ) : null}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
