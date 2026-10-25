import Link from "next/link";
import { ActivityIcon } from "lucide-react";

import { EmptyState } from "@/components/patterns/empty-state";
import { TaskStatusBadge } from "@/components/patterns/status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import type { RadarActivityItem } from "@/lib/data/target-sources";
import { formatRelative } from "@/lib/format";

import { MatchScoreBadge } from "./match-score-badge";

/** Newest captures across every source — the live feed of the radar module. */
export function LatestCaptures({ items }: { items: RadarActivityItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ActivityIcon className="size-4" />
          Latest captures
        </CardTitle>
        <CardDescription>
          Posts the radar pushed into the approval queue, newest first.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {items.length === 0 ? (
          <EmptyState
            icon={ActivityIcon}
            title="No captures yet"
            description="Once the scanner matches a post, it appears here."
            className="mx-4 border-0 sm:mx-6"
          />
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/queue?task=${item.id}`}
                  className="hover:bg-muted/50 flex flex-col gap-2 px-4 py-3 transition-colors sm:px-6"
                >
                  <p className="line-clamp-2 text-sm">
                    {item.post_content?.trim() || item.post_url}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <MatchScoreBadge score={item.match_score} />
                    <TaskStatusBadge status={item.status} />
                    <span className="text-muted-foreground truncate text-xs">
                      {item.source ? item.source.name : "Source removed"}
                    </span>
                    <span className="text-muted-foreground ml-auto text-xs">
                      {formatRelative(item.created_at)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
