import Link from "next/link";
import { ArrowRightIcon, BadgeDollarSignIcon, RadarIcon, RepeatIcon, UsersIcon } from "lucide-react";

import { EmptyState } from "@/components/patterns/empty-state";
import { StatCard } from "@/components/patterns/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import type { LeadGroupFunnelRow } from "@/lib/data/leads";
import { formatNumber, formatVnd } from "@/lib/format";
import { buildLeadsHref } from "@/lib/leads/url";
import { LEAD_FUNNEL_WINDOW_DAYS } from "@/lib/leads/sales";

function n(value: number | null | undefined) {
  return Number(value ?? 0);
}

/**
 * Server-rendered CRM group report used on /leads. Every number comes from
 * `v_lead_group_funnel_14d`; the component only totals rows and formats them.
 * Paid customers are distinct leads, while cash sums every actual receipt.
 */
export function LeadGroupReport({ rows }: { rows: LeadGroupFunnelRow[] }) {
  const totals = rows.reduce(
    (acc, row) => ({
      qualified: acc.qualified + n(row.qualified_leads),
      twoWay: acc.twoWay + n(row.two_way_leads),
      trial: acc.trial + n(row.trial_confirmed_leads),
      paid: acc.paid + n(row.paid_customers),
      receipts: acc.receipts + n(row.receipt_count),
      cash: acc.cash + n(row.cash_total_vnd),
      recurring: acc.recurring + n(row.recurring_monthly_vnd)
    }),
    { qualified: 0, twoWay: 0, trial: 0, paid: 0, receipts: 0, cash: 0, recurring: 0 }
  );

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          Phễu chốt đơn {LEAD_FUNNEL_WINDOW_DAYS} ngày theo nhóm
        </h2>
        <p className="text-muted-foreground text-sm">
          Đếm lead có mốc thực tế trong {LEAD_FUNNEL_WINDOW_DAYS} ngày qua: đủ điều kiện → khách
          thực sự trả lời → khách xác nhận đã dùng thử → đã trả tiền. Không suy ra mốc nào từ trạng
          thái chăm sóc; “đã gửi” không phải “đã dùng thử”.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Tiền thực nhận"
          value={formatVnd(totals.cash)}
          hint={`${formatNumber(totals.receipts)} khoản thu đã ghi`}
          icon={BadgeDollarSignIcon}
          tone="success"
        />
        <StatCard
          label="Khách đã trả"
          value={formatNumber(totals.paid)}
          hint="Số lead khác nhau, không đếm trùng khoản thu"
          icon={UsersIcon}
          tone="success"
        />
        <StatCard
          label="Khách xác nhận dùng thử"
          value={formatNumber(totals.trial)}
          hint="Mốc thực tế trong kỳ — không phải số file/trial đã gửi"
          icon={ArrowRightIcon}
          tone="info"
        />
        <StatCard
          label="Giá duy trì/tháng"
          value={formatVnd(totals.recurring)}
          hint="Đã thỏa thuận — không phải MRR, không phải tiền đã thu"
          icon={RepeatIcon}
          tone="warning"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Báo cáo theo nhóm</CardTitle>
          <CardDescription>
            {formatNumber(totals.qualified)} lead đủ điều kiện · {formatNumber(totals.twoWay)} hội
            thoại 2 chiều · {formatNumber(totals.trial)} xác nhận dùng thử ·{" "}
            {formatNumber(totals.paid)} khách đã trả. Đây là số đếm sự kiện trong kỳ, không phải tỷ
            lệ chuyển đổi theo cohort.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.length === 0 ? (
            <EmptyState
              icon={RadarIcon}
              title="Chưa có nhóm nào để báo cáo"
              description="Thêm nhóm Facebook vào Radar để bắt đầu. Nhóm chưa có hoạt động vẫn sẽ xuất hiện với phễu 0."
              action={
                <Button asChild variant="outline">
                  <Link href="/radar">Mở Radar</Link>
                </Button>
              }
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-44">Nhóm</TableHead>
                      <TableHead className="text-right">Đủ điều kiện</TableHead>
                      <TableHead className="text-right">Hội thoại 2 chiều</TableHead>
                      <TableHead className="text-right">Xác nhận dùng thử</TableHead>
                      <TableHead className="text-right">Khách đã trả</TableHead>
                      <TableHead className="text-right">Tiền template</TableHead>
                      <TableHead className="text-right">Tiền setup</TableHead>
                      <TableHead className="text-right">Tiền duy trì</TableHead>
                      <TableHead className="text-right">Tổng tiền</TableHead>
                      <TableHead className="text-right">Giá duy trì/tháng</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const groupName = row.group_name?.trim() || "Nhóm không xác định";
                      const qualified = n(row.qualified_leads);
                      const twoWay = n(row.two_way_leads);
                      const trial = n(row.trial_confirmed_leads);
                      const paid = n(row.paid_customers);

                      return (
                        <TableRow key={`${row.user_id ?? "owner"}:${row.group_id ?? groupName}`}>
                          <TableCell className="max-w-64 whitespace-normal">
                            <Link
                              href={buildLeadsHref({ query: groupName })}
                              className="inline-flex min-h-9 items-center gap-1 font-medium hover:underline"
                            >
                              <span className="truncate">{groupName}</span>
                            </Link>
                            <p className="text-muted-foreground text-xs">
                              {formatNumber(n(row.receipt_count))} khoản thu
                              {n(row.avg_cash_per_paid_customer) > 0
                                ? ` · TB ${formatVnd(n(row.avg_cash_per_paid_customer))}/khách`
                                : ""}
                            </p>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatNumber(qualified)}
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatNumber(twoWay)}
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatNumber(trial)}
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatNumber(paid)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatVnd(n(row.cash_template_vnd))}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatVnd(n(row.cash_setup_vnd))}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatVnd(n(row.cash_maintenance_vnd))}
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {formatVnd(n(row.cash_total_vnd))}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatVnd(n(row.recurring_monthly_vnd))}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="outline">Đơn vị tiền: VND</Badge>
                <span>
                  Số đếm sự kiện trong 14 ngày lịch Việt Nam; lead đủ điều kiện từ trước kỳ vẫn có
                  thể phát sinh hội thoại trong kỳ. Không hiển thị tỷ lệ thô để tránh vượt 100%.
                </span>
                <span>
                  “Giá duy trì/tháng” là thỏa thuận, không phải MRR và không cộng vào tổng tiền.
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
