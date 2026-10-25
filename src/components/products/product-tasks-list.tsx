import Link from "next/link";
import { InboxIcon, UserIcon } from "lucide-react";

import { EmptyState } from "@/components/patterns/empty-state";
import { TaskStatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProductTask } from "@/lib/data/products";
import { formatRelative } from "@/lib/format";

export function ProductTasksList({ tasks }: { tasks: ProductTask[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tasks using this product</CardTitle>
        <CardDescription>Latest comment tasks matched to this product.</CardDescription>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <EmptyState
            icon={InboxIcon}
            title="No tasks yet"
            description="When the radar matches a post to this product, the task will appear here."
          />
        ) : (
          <ul className="divide-y">
            {tasks.map((task) => (
              <li
                key={task.id}
                className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <TaskStatusBadge status={task.status} />
                    <span className="text-muted-foreground text-xs">
                      {formatRelative(task.created_at)}
                    </span>
                  </div>
                  <p className="flex items-center gap-1.5 text-sm">
                    <UserIcon className="text-muted-foreground size-3.5 shrink-0" />
                    <span className="truncate">{task.account?.name ?? "Unassigned"}</span>
                  </p>
                  <a
                    href={task.post_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground block truncate text-xs hover:underline"
                  >
                    {task.post_url}
                  </a>
                </div>

                <Button asChild variant="outline" size="lg" className="w-full sm:w-auto">
                  <Link href={`/queue?task=${task.id}`}>Open in queue</Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
