import type { Metadata } from "next";
import {
  BadgeCheck,
  BarChart3,
  Clock,
  Inbox,
  Percent,
  Receipt,
  ShoppingCart,
  Target,
  TrendingUp,
  Users,
  Wallet
} from "lucide-react";

import { AccountLeaderboard } from "@/components/analytics/account-leaderboard";
import { AttributionTable } from "@/components/analytics/attribution-table";
import { ConversionFeed } from "@/components/analytics/conversion-feed";
import {
  DynamicRevenueChart,
  DynamicSourceCommissionChart,
  DynamicTopAccountsChart
} from "@/components/analytics/dynamic-charts";
import { AnalyticsRangeNav } from "@/components/analytics/range-nav";
import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getAccountPerformance,
  getAnalyticsSummary,
  getConversionFeed,
  getPerformanceByAccount,
  getPerformanceBySource,
  getRevenueSeries,
  getTaskRoiRows
} from "@/lib/data/analytics";
import { formatCompactVnd, formatNumber, formatPercent } from "@/lib/format";

export const metadata: Metadata = { title: "Phân tích & Doanh thu" };

const ATTRIBUTION_LIMIT = 30;
const FEED_LIMIT = 15;
const LEADERBOARD_LIMIT = 10;
const CHART_SERIES_LIMIT = 6;

type AnalyticsSearchParams = { days?: string };

/** `?days=7|30|90|all`; anything else falls back to the 30-day view. */
function parseDays(raw: string | undefined): number | null {
  if (raw === "all") return null;
  if (raw === "7") return 7;
  if (raw === "90") return 90;
  return 30;
}

export default async function AnalyticsPage({
  searchParams
}: {
  searchParams: Promise<AnalyticsSearchParams>;
}) {
  const params = await searchParams;
  const days = parseDays(params.days);

  const [summary, series, bySource, byAccount, roiRows, accountRows, feed] = await Promise.all([
    getAnalyticsSummary({ days }),
    getRevenueSeries({ days }),
    getPerformanceBySource({ days }),
    getPerformanceByAccount({ days }),
    getTaskRoiRows({ days, limit: ATTRIBUTION_LIMIT }),
    getAccountPerformance(),
    getConversionFeed({ days, limit: FEED_LIMIT })
  ]);

  const rangeLabel = days === null ? "Toàn thời gian" : `${days} ngày qua`;
  const description = `${rangeLabel} · Đối soát Sub_ID, doanh thu và hoa hồng affiliate${
    feed.length === 0 ? " · Chưa có chuyển đổi nào trong khoảng thời gian này." : ""
  }`;

  const sourceChartData = bySource.slice(0, CHART_SERIES_LIMIT);
  const accountChartData = byAccount.slice(0, CHART_SERIES_LIMIT);
  const leaderboardRows = accountRows.slice(0, LEADERBOARD_LIMIT);

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Phân tích &amp; Doanh thu"
        description={description}
        actions={<AnalyticsRangeNav days={days} />}
      />

      {/* KPI grid — 2-up on phones, 4-up from md. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Doanh thu"
          value={formatCompactVnd(summary.revenue)}
          hint="Đơn hàng thành công"
          icon={Wallet}
        />
        <StatCard
          label="Hoa hồng"
          value={formatCompactVnd(summary.commission)}
          hint="Tạm tính, không tính đơn hủy"
          icon={Percent}
          tone="success"
        />
        <StatCard
          label="Đã quyết toán"
          value={formatCompactVnd(summary.settledCommission)}
          hint="Đã được sàn xác nhận"
          icon={BadgeCheck}
          tone="success"
        />
        <StatCard
          label="Chờ duyệt"
          value={formatCompactVnd(summary.pendingCommission)}
          hint={`Đã hủy: ${formatCompactVnd(summary.canceledCommission)}`}
          icon={Clock}
          tone="warning"
        />
        <StatCard
          label="Đơn hàng"
          value={formatNumber(summary.orders)}
          hint="Số chuyển đổi thành công"
          icon={ShoppingCart}
          tone="info"
        />
        <StatCard
          label="Tỷ lệ chuyển đổi"
          value={formatPercent(summary.conversionRate)}
          hint={`${formatNumber(summary.tasksExecuted)} bài đã đăng`}
          icon={Target}
          tone="info"
        />
        <StatCard
          label="Giá trị TB/đơn"
          value={formatCompactVnd(summary.averageOrderValue)}
          hint="Doanh thu trên mỗi đơn"
          icon={Receipt}
        />
      </div>

      <section className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Biểu đồ Doanh thu &amp; Hoa hồng hàng ngày</CardTitle>
            <CardDescription>{rangeLabel}, thống kê theo ngày (UTC).</CardDescription>
          </CardHeader>
          <CardContent>
            {series.length === 0 || summary.orders === 0 ? (
              <EmptyState
                icon={TrendingUp}
                title="Chưa có dữ liệu doanh thu"
                description="Các chuyển đổi sẽ tự động hiển thị tại đây ngay khi nhận postback đơn hàng từ sàn."
              />
            ) : (
              <DynamicRevenueChart data={series} />
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Hoa hồng theo Nguồn</CardTitle>
              <CardDescription>Top các nhóm/fanpage mang lại nhiều hoa hồng nhất.</CardDescription>
            </CardHeader>
            <CardContent>
              {sourceChartData.length === 0 ? (
                <EmptyState
                  icon={BarChart3}
                  title="Chưa có hiệu suất nguồn"
                  description="Chưa có bài viết nào phát sinh đơn hàng trong khoảng thời gian này."
                />
              ) : (
                <DynamicSourceCommissionChart data={sourceChartData} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top Tài khoản hiệu quả nhất</CardTitle>
              <CardDescription>Tài khoản xếp hạng theo doanh thu mang lại.</CardDescription>
            </CardHeader>
            <CardContent>
              {accountChartData.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title="Chưa có hiệu suất tài khoản"
                  description="Duyệt và chạy các tác vụ để xem persona nào chuyển đổi tốt nhất."
                />
              ) : (
                <DynamicTopAccountsChart data={accountChartData} />
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Đối soát chi tiết theo Sub_ID</CardTitle>
          <CardDescription>
            Mỗi dòng ứng với một bài viết. Nhấp vào bài viết để mở trong hàng đợi duyệt.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {roiRows.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="Chưa có bài viết trong khoảng này"
              description="Thay đổi khoảng thời gian hoặc duyệt thêm bài viết để bắt đầu thu thập số liệu ROI."
            />
          ) : (
            <AttributionTable rows={roiRows} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bảng xếp hạng tài khoản (Toàn thời gian)</CardTitle>
          <CardDescription>
            Tổng doanh thu lũy kế từ tất cả bình luận đã đăng, không phụ thuộc bộ lọc thời gian.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {leaderboardRows.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Chưa có tài khoản nào"
              description="Thêm tài khoản mạng xã hội để đối soát doanh thu theo từng persona."
            />
          ) : (
            <AccountLeaderboard rows={leaderboardRows} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Đơn hàng chuyển đổi gần đây</CardTitle>
          <CardDescription>Các postback mới nhất được sàn gửi về hệ thống.</CardDescription>
        </CardHeader>
        <CardContent>
          {feed.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="Chưa có đơn hàng trong khoảng này"
              description="Các đơn hàng phát sinh từ mã Sub_ID sẽ xuất hiện tại đây."
            />
          ) : (
            <ConversionFeed rows={feed} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
