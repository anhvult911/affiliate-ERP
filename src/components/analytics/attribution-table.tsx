import Link from "next/link";

import { CopyButton } from "@/components/patterns/copy-button";
import { ResponsiveView } from "@/components/patterns/responsive-view";
import { TaskStatusBadge } from "@/components/patterns/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import type { TaskRoiRow } from "@/lib/data/analytics";
import { formatNumber, formatVnd } from "@/lib/format";

/** Sub_ID attribution: one row per task, linked back to the approval queue. */
export function AttributionTable({ rows }: { rows: TaskRoiRow[] }) {
  return (
    <ResponsiveView
      desktop={
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sub_ID</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Orders</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">Commission</TableHead>
              <TableHead className="text-right">Queue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => {
              const href = row.task_id ? `/queue?task=${row.task_id}` : null;
              return (
                <TableRow key={row.task_id ?? `roi-${index}`}>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {href ? (
                        <Link
                          href={href}
                          className="font-mono text-xs underline-offset-4 hover:underline"
                        >
                          {row.sub_id_code ?? "Open task"}
                        </Link>
                      ) : (
                        <span className="font-mono text-xs">{row.sub_id_code ?? "—"}</span>
                      )}
                      {row.sub_id_code ? (
                        <CopyButton value={row.sub_id_code} label="Copy Sub_ID" size="icon" />
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-48 truncate">{row.product_name ?? "—"}</TableCell>
                  <TableCell className="max-w-40 truncate">{row.source_name ?? "—"}</TableCell>
                  <TableCell className="max-w-40 truncate">{row.account_name ?? "—"}</TableCell>
                  <TableCell>
                    {row.status ? <TaskStatusBadge status={row.status} /> : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(row.orders ?? 0)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatVnd(row.revenue ?? 0)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatVnd(row.commission ?? 0)}
                  </TableCell>
                  <TableCell className="text-right">
                    {href ? (
                      <Link
                        href={href}
                        className="text-xs font-medium underline-offset-4 hover:underline"
                      >
                        Open
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      }
      mobile={rows.map((row, index) => {
        const href = row.task_id ? `/queue?task=${row.task_id}` : null;
        return (
          <div
            key={row.task_id ?? `roi-${index}`}
            className="bg-card space-y-3 rounded-xl border p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-1">
                  {href ? (
                    <Link
                      href={href}
                      className="inline-flex min-h-11 items-center font-mono text-xs underline-offset-4 hover:underline"
                    >
                      {row.sub_id_code ?? "Open task"}
                    </Link>
                  ) : (
                    <span className="font-mono text-xs">{row.sub_id_code ?? "—"}</span>
                  )}
                  {row.sub_id_code ? (
                    <CopyButton value={row.sub_id_code} label="Copy Sub_ID" size="icon" />
                  ) : null}
                </div>
                <p className="truncate text-sm font-medium">{row.product_name ?? "—"}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {row.source_name ?? "—"} · {row.account_name ?? "—"}
                </p>
              </div>
              {row.status ? <TaskStatusBadge status={row.status} /> : null}
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <p className="text-muted-foreground">Orders</p>
                <p className="font-semibold tabular-nums">{formatNumber(row.orders ?? 0)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Revenue</p>
                <p className="font-semibold tabular-nums">{formatVnd(row.revenue ?? 0)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Commission</p>
                <p className="font-semibold tabular-nums">{formatVnd(row.commission ?? 0)}</p>
              </div>
            </div>
          </div>
        );
      })}
    />
  );
}
