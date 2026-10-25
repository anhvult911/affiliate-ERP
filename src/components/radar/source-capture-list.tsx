import Link from "next/link";
import { ExternalLinkIcon, InboxIcon } from "lucide-react";

import { EmptyState } from "@/components/patterns/empty-state";
import { TaskStatusBadge } from "@/components/patterns/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { SourceCapture } from "@/lib/data/target-sources";
import { formatRelative } from "@/lib/format";

import { MatchScoreBadge } from "./match-score-badge";
import { CaptureThumbnail } from "./capture-thumbnail";
import { parsePostImages } from "./utils";

export function SourceCaptureList({ captures }: { captures: SourceCapture[] }) {
  if (captures.length === 0) {
    return (
      <EmptyState
        icon={InboxIcon}
        title="No captures from this source yet"
        description="The scanner has not matched a post here. Once a post crosses the match threshold it lands in the approval queue and shows up below."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {captures.map((capture) => {
        const images = parsePostImages(capture.post_images);

        return (
          <Card key={capture.id} className="gap-3 p-4 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <MatchScoreBadge score={capture.match_score} />
              <TaskStatusBadge status={capture.status} />
              <span className="text-muted-foreground ml-auto text-xs">
                {formatRelative(capture.created_at)}
              </span>
            </div>

            <p className="text-sm break-words whitespace-pre-wrap">
              {capture.post_content?.trim() || "No caption captured."}
            </p>

            {images.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {images.slice(0, 6).map((src, index) => (
                  <CaptureThumbnail
                    key={`${capture.id}-${index}`}
                    src={src}
                    alt="Captured post attachment"
                    className="size-20 sm:size-24"
                  />
                ))}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              {capture.product ? (
                <Badge variant="muted">Matched: {capture.product.name}</Badge>
              ) : null}
              <Button asChild variant="outline" size="lg" className="ml-auto">
                <Link href={`/queue?task=${capture.id}`}>Open in queue</Link>
              </Button>
              <Button asChild variant="ghost" size="lg">
                <a href={capture.post_url} target="_blank" rel="noreferrer">
                  Original post
                  <ExternalLinkIcon />
                </a>
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
