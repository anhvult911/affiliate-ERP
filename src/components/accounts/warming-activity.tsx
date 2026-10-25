import Link from "next/link";
import { ExternalLinkIcon, SparklesIcon, TriangleAlertIcon } from "lucide-react";

import { EmptyState } from "@/components/patterns/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelative } from "@/lib/format";
import type { WarmingRun, WarmingStats } from "@/lib/data/warming";

const KIND_LABEL: Record<WarmingRun["kind"], string> = {
  lifestyle_post: "Lifestyle post",
  cross_warm: "Cross-warm",
  profile_setup: "Dựng hồ sơ"
};

/**
 * What the persona did on its own: lifestyle posts it published and other
 * accounts' posts it warmed. This is the evidence behind the trust score, so it
 * sits next to the tasks the operator drove manually.
 */
export function WarmingActivity({ runs, stats }: { runs: WarmingRun[]; stats: WarmingStats }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SparklesIcon className="size-4" />
          Hoạt động nuôi nick
        </CardTitle>
        <CardDescription>
          Actions the worker performed on this account&apos;s timeline — no affiliate links, only
          persona upkeep.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground text-xs">Runs</dt>
            <dd className="font-semibold tabular-nums">{stats.total}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Lifestyle</dt>
            <dd className="font-semibold tabular-nums">{stats.lifestyle}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Cross-warm</dt>
            <dd className="font-semibold tabular-nums">{stats.crossWarm}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Failed</dt>
            <dd className={stats.failed > 0 ? "text-destructive font-semibold tabular-nums" : "font-semibold tabular-nums"}>
              {stats.failed}
            </dd>
          </div>
        </dl>

        {runs.length === 0 ? (
          <EmptyState
            icon={SparklesIcon}
            title="No warming activity yet"
            description="Slots come from the schedule above. Enable warmup and let the worker run to see lifestyle posts and cross-warm comments here."
          />
        ) : (
          <ul className="-mx-1 divide-y">
            {runs.map((run) => (
              <li key={run.id} className="space-y-1 px-1 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={run.kind === "lifestyle_post" ? "info" : "secondary"}>
                    {KIND_LABEL[run.kind]}
                  </Badge>
                  {run.status === "failed" ? (
                    <Badge variant="destructive">Failed</Badge>
                  ) : null}
                  <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                    {formatRelative(run.executed_at)}
                  </span>
                </div>

                {run.content ? <p className="line-clamp-2 text-sm">{run.content}</p> : null}

                {run.error ? (
                  <p className="text-destructive flex items-start gap-1.5 text-xs">
                    <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                    <span>{run.error}</span>
                  </p>
                ) : null}

                <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  {run.target?.name ? <span>Warmed {run.target.name}&apos;s post</span> : null}
                  {run.post_url ? (
                    <a
                      href={run.post_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                    >
                      <ExternalLinkIcon className="size-3" />
                      Permalink
                    </a>
                  ) : null}
                  {run.target_post_url && run.target_post_url !== run.post_url ? (
                    <a
                      href={run.target_post_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                    >
                      <ExternalLinkIcon className="size-3" />
                      Warmed post
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="text-muted-foreground text-xs">
          Each completed run raises the trust score by one. The schedule, grace window and
          cross-warm targeting are decided by the app, not the worker — see{" "}
          <Link href="/ai" className="underline-offset-4 hover:underline">
            AI Engine
          </Link>{" "}
          for the matching rules that share the same pipeline.
        </p>
      </CardContent>
    </Card>
  );
}
