import { AccountStatusBadge } from "@/components/patterns/status-badge";
import { ResponsiveView } from "@/components/patterns/responsive-view";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import type { AccountPerformanceRow } from "@/lib/data/analytics";
import { formatNumber, formatVnd } from "@/lib/format";

/** Lifetime account rollup, already ordered by settled commission. */
export function AccountLeaderboard({ rows }: { rows: AccountPerformanceRow[] }) {
  return (
    <ResponsiveView
      desktop={
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead>Persona</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Published</TableHead>
              <TableHead className="text-right">Failed</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">Settled</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={row.account_id ?? `account-${index}`}>
                <TableCell className="max-w-48 truncate font-medium">
                  {row.account_name ?? "—"}
                </TableCell>
                <TableCell className="max-w-40 truncate">{row.persona_type ?? "—"}</TableCell>
                <TableCell>
                  {row.status ? <AccountStatusBadge status={row.status} /> : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(row.comments_published ?? 0)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(row.comments_failed ?? 0)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatVnd(row.revenue ?? 0)}
                </TableCell>
                <TableCell className="text-right tabular-nums font-medium">
                  {formatVnd(row.settled_commission ?? 0)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
      mobile={rows.map((row, index) => (
        <div
          key={row.account_id ?? `account-${index}`}
          className="bg-card space-y-3 rounded-xl border p-4"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <p className="truncate font-medium">{row.account_name ?? "—"}</p>
              <p className="text-muted-foreground truncate text-xs">
                {row.persona_type ?? "—"}
              </p>
            </div>
            {row.status ? <AccountStatusBadge status={row.status} /> : null}
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <p className="text-muted-foreground">Published / failed</p>
              <p className="font-semibold tabular-nums">
                {formatNumber(row.comments_published ?? 0)} /{" "}
                {formatNumber(row.comments_failed ?? 0)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Revenue</p>
              <p className="font-semibold tabular-nums">{formatVnd(row.revenue ?? 0)}</p>
            </div>
            <div className="col-span-2">
              <p className="text-muted-foreground">Settled commission</p>
              <p className="font-semibold tabular-nums">
                {formatVnd(row.settled_commission ?? 0)}
              </p>
            </div>
          </div>
        </div>
      ))}
    />
  );
}
