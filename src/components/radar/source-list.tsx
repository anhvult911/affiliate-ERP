import Link from "next/link";
import { ClockIcon } from "lucide-react";

import { ResponsiveView } from "@/components/patterns/responsive-view";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import type { SourceListItem } from "@/lib/data/target-sources";
import { formatHostname, formatNumber, formatRelative } from "@/lib/format";

import { SourceActions } from "./source-actions";
import { SourceActiveSwitch } from "./source-active-switch";
import { SourceTypeBadge } from "./source-type-badge";
import { isSourceDue } from "./utils";

function DueBadge() {
  return (
    <Badge variant="warning">
      <ClockIcon />
      Due now
    </Badge>
  );
}

/** Desktop table + mobile cards, both fed by the same normalised rows. */
export function SourceList({ sources }: { sources: SourceListItem[] }) {
  return (
    <ResponsiveView
      desktop={
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Source</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Niche</TableHead>
                <TableHead className="text-right">Interval</TableHead>
                <TableHead className="text-right">Captures</TableHead>
                <TableHead>Last scanned</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.map((source) => {
                const due = isSourceDue(source);

                return (
                  <TableRow key={source.id}>
                    <TableCell className="max-w-[280px] pl-4">
                      <div className="flex flex-col gap-0.5">
                        <Link href={`/radar/${source.id}`} className="flex min-h-11 items-center hover:underline">
                          <span className="truncate font-medium">{source.name}</span>
                        </Link>
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-muted-foreground truncate text-xs hover:underline"
                        >
                          {formatHostname(source.url)}
                        </a>
                      </div>
                    </TableCell>
                    <TableCell>
                      <SourceTypeBadge type={source.source_type} />
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-[160px] truncate">
                      {source.niche ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {source.scan_interval_mins}m
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(source.captureCount)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground text-xs">
                          {formatRelative(source.last_scanned_at)}
                        </span>
                        {due ? <DueBadge /> : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <SourceActiveSwitch
                        sourceId={source.id}
                        isActive={source.is_active}
                        name={source.name}
                      />
                    </TableCell>
                    <TableCell className="pr-4">
                      <SourceActions source={source} variant="menu" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      }
      mobile={sources.map((source) => {
        const due = isSourceDue(source);

        return (
          <Card key={source.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/radar/${source.id}`} className="flex min-h-11 items-center hover:underline">
                    <span className="truncate font-medium">{source.name}</span>
                  </Link>
                  {due ? <DueBadge /> : null}
                </div>
                <p className="text-muted-foreground truncate text-xs">{source.url}</p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <SourceTypeBadge type={source.source_type} />
                  {source.niche ? (
                    <span className="text-muted-foreground text-xs">{source.niche}</span>
                  ) : null}
                </div>
              </div>
              <SourceActions source={source} variant="sheet" />
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div>
                <dt className="text-muted-foreground">Cadence</dt>
                <dd className="font-medium tabular-nums">Every {source.scan_interval_mins} min</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Captures</dt>
                <dd className="font-medium tabular-nums">{formatNumber(source.captureCount)}</dd>
              </div>
            </dl>

            <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
              <span className="text-muted-foreground text-xs">
                Scanned {formatRelative(source.last_scanned_at)}
              </span>
              <SourceActiveSwitch
                sourceId={source.id}
                isActive={source.is_active}
                name={source.name}
                showLabel
              />
            </div>
          </Card>
        );
      })}
    />
  );
}
