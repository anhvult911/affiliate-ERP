import Link from "next/link";

import { ResponsiveView } from "@/components/patterns/responsive-view";
import { ConversionStatusBadge } from "@/components/patterns/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import type { ConversionFeedItem } from "@/lib/data/analytics";
import { formatHostname, formatRelative, formatVnd } from "@/lib/format";

/** Newest postbacks first, with the Sub_ID that produced them. */
export function ConversionFeed({ rows }: { rows: ConversionFeedItem[] }) {
  return (
    <ResponsiveView
      desktop={
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sub_ID</TableHead>
              <TableHead>Order amount</TableHead>
              <TableHead className="text-right">Commission</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="space-y-0.5">
                    {row.task ? (
                      <Link
                        href={`/queue?task=${row.task.id}`}
                        className="font-mono text-xs underline-offset-4 hover:underline"
                      >
                        {row.sub_id}
                      </Link>
                    ) : (
                      <span className="font-mono text-xs">{row.sub_id}</span>
                    )}
                    <p className="text-muted-foreground text-xs">
                      {formatHostname(row.task?.post_url)}
                    </p>
                  </div>
                </TableCell>
                <TableCell className="tabular-nums">{formatVnd(row.order_amount)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatVnd(row.estimated_commission)}
                </TableCell>
                <TableCell>
                  <ConversionStatusBadge status={row.status} />
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {formatRelative(row.converted_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
      mobile={rows.map((row) => (
        <div key={row.id} className="bg-card space-y-3 rounded-xl border p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-0.5">
              {row.task ? (
                <Link
                  href={`/queue?task=${row.task.id}`}
                  className="inline-flex min-h-11 items-center font-mono text-xs underline-offset-4 hover:underline"
                >
                  {row.sub_id}
                </Link>
              ) : (
                <span className="font-mono text-xs">{row.sub_id}</span>
              )}
              <p className="text-muted-foreground truncate text-xs">
                {formatHostname(row.task?.post_url)}
              </p>
            </div>
            <ConversionStatusBadge status={row.status} />
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <p className="text-muted-foreground">Order amount</p>
              <p className="font-semibold tabular-nums">{formatVnd(row.order_amount)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Commission</p>
              <p className="font-semibold tabular-nums">
                {formatVnd(row.estimated_commission)}
              </p>
            </div>
          </div>
          <p className="text-muted-foreground text-xs">{formatRelative(row.converted_at)}</p>
        </div>
      ))}
    />
  );
}
