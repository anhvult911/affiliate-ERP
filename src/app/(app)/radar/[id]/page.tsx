import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeftIcon, ClockIcon, ExternalLinkIcon } from "lucide-react";

import { CopyButton } from "@/components/patterns/copy-button";
import { PageHeader } from "@/components/patterns/page-header";
import { DeleteSourceDialog } from "@/components/radar/delete-source-dialog";
import { MarkScannedButton } from "@/components/radar/mark-scanned-button";
import { SourceActiveSwitch } from "@/components/radar/source-active-switch";
import { SourceCaptureList } from "@/components/radar/source-capture-list";
import { SourceFormDialog } from "@/components/radar/source-form-dialog";
import { SourceTypeBadge } from "@/components/radar/source-type-badge";
import { isSourceDue } from "@/components/radar/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSource, listSourceCaptures } from "@/lib/data/target-sources";
import { formatDateTime, formatHostname, formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Radar source" };

export default async function RadarSourcePage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const source = await getSource(id);
  if (!source) notFound();

  const captures = await listSourceCaptures(source.id, 30);
  const due = isSourceDue(source);

  return (
    <div className="space-y-4 sm:space-y-6">
      <Link
        href="/radar"
        className="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center gap-1 text-sm transition-colors"
      >
        <ChevronLeftIcon className="size-4" />
        Radar Watchlist
      </Link>

      <div className="space-y-3">
        <PageHeader
          title={source.name}
          description={source.niche ?? "No niche set"}
          actions={
            <>
              <SourceActiveSwitch
                sourceId={source.id}
                isActive={source.is_active}
                name={source.name}
                showLabel
                className="justify-center rounded-md border px-3 sm:justify-start"
              />
              <MarkScannedButton
                sourceId={source.id}
                className="w-full sm:w-auto"
              />
              <SourceFormDialog mode="edit" source={source} />
              <DeleteSourceDialog
                sourceId={source.id}
                sourceName={source.name}
                redirectTo="/radar"
              />
            </>
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          <SourceTypeBadge type={source.source_type} />
          {!source.is_active ? (
            <Badge variant="muted">Monitoring paused</Badge>
          ) : due ? (
            <Badge variant="warning">
              <ClockIcon />
              Due for scan
            </Badge>
          ) : (
            <Badge variant="muted">Within cadence</Badge>
          )}
          <Button asChild variant="link" size="lg" className="px-0">
            <a href={source.url} target="_blank" rel="noreferrer">
              {formatHostname(source.url)}
              <ExternalLinkIcon />
            </a>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>AI context</CardTitle>
            <CardDescription>
              Sent verbatim to Gemini when drafting a reply for captures from this source. Empty
              fields are left out of the prompt.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  Tone of voice
                </span>
                {source.tone_of_voice ? (
                  <CopyButton value={source.tone_of_voice} size="icon" label="Copy tone of voice" />
                ) : null}
              </div>
              {source.tone_of_voice ? (
                <pre className="bg-muted/50 max-h-48 overflow-auto rounded-lg border p-3 font-mono text-xs break-words whitespace-pre-wrap sm:text-sm">
                  {source.tone_of_voice}
                </pre>
              ) : (
                <p className="text-muted-foreground text-sm">Not set — no tone block is sent.</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  Group rules
                </span>
                {source.group_rules ? (
                  <CopyButton value={source.group_rules} size="icon" label="Copy group rules" />
                ) : null}
              </div>
              {source.group_rules ? (
                <pre className="bg-muted/50 max-h-64 overflow-auto rounded-lg border p-3 font-mono text-xs break-words whitespace-pre-wrap sm:text-sm">
                  {source.group_rules}
                </pre>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Not set — no rules block is sent. Add posting rules and banned words to keep
                  drafts compliant.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Scan cadence</CardTitle>
            <CardDescription>
              The worker reads this source once the last scan is older than the interval.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div className="space-y-1">
                <dt className="text-muted-foreground text-xs">Interval</dt>
                <dd className="font-medium tabular-nums">Every {source.scan_interval_mins} min</dd>
              </div>
              <div className="space-y-1">
                <dt className="text-muted-foreground text-xs">Monitoring</dt>
                <dd className="font-medium">{source.is_active ? "Active" : "Paused"}</dd>
              </div>
              <div className="space-y-1">
                <dt className="text-muted-foreground text-xs">Last scanned</dt>
                <dd className="font-medium">{formatRelative(source.last_scanned_at)}</dd>
              </div>
              <div className="space-y-1">
                <dt className="text-muted-foreground text-xs">Last scan timestamp</dt>
                <dd className="font-medium tabular-nums">
                  {formatDateTime(source.last_scanned_at)}
                </dd>
              </div>
              <div className="space-y-1">
                <dt className="text-muted-foreground text-xs">Added</dt>
                <dd className="font-medium tabular-nums">{formatDateTime(source.created_at)}</dd>
              </div>
            </dl>

            {!source.is_active ? (
              <p className="text-muted-foreground text-xs">
                Paused — the worker skips this source until monitoring resumes.
              </p>
            ) : due ? (
              <p className="text-warning text-xs">
                Due now — the worker picks this source up on its next cycle.
              </p>
            ) : (
              <p className="text-muted-foreground text-xs">
                Within cadence — the next scan is not due yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-2">
          <h2 className="text-base font-semibold tracking-tight sm:text-lg">Captures</h2>
          <span className="text-muted-foreground text-xs">
            {captures.length} most recent
          </span>
        </div>
        <SourceCaptureList captures={captures} />
      </section>
    </div>
  );
}
