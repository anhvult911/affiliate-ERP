import type { Metadata } from "next";
import Link from "next/link";
import { ClockIcon, PauseCircleIcon, RadarIcon, ScanLineIcon } from "lucide-react";

import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { LatestCaptures } from "@/components/radar/latest-captures";
import { SourceFilters } from "@/components/radar/source-filters";
import { SourceFormDialog } from "@/components/radar/source-form-dialog";
import { SourceList } from "@/components/radar/source-list";
import { Button } from "@/components/ui/button";
import { SOURCE_TYPES, type SourceType } from "@/lib/constants";
import { getRadarActivity, getSourceStats, listSources } from "@/lib/data/target-sources";
import { formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Radar theo dõi" };

type RadarSearchParams = Record<string, string | string[] | undefined>;

export default async function RadarPage({
  searchParams
}: {
  searchParams: Promise<RadarSearchParams>;
}) {
  const params = await searchParams;

  const typeParam = typeof params.type === "string" ? params.type : undefined;
  const sourceType =
    typeParam && SOURCE_TYPES.includes(typeParam as SourceType)
      ? (typeParam as SourceType)
      : undefined;
  const activeOnly = params.active === "1";
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const hasFilters = Boolean(sourceType || activeOnly || query);

  const [sources, stats, activity] = await Promise.all([
    listSources({ sourceType, activeOnly, query }),
    getSourceStats(),
    getRadarActivity(8)
  ]);

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Radar theo dõi"
        description="Các hội nhóm, fanpage, KOL và diễn đàn được scanner theo dõi để phát hiện bài viết tiềm năng."
        actions={<SourceFormDialog mode="create" />}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Nguồn hoạt động" value={stats.active} icon={RadarIcon} tone="success" />
        <StatCard
          label="Tạm dừng"
          value={stats.paused}
          icon={PauseCircleIcon}
          tone={stats.paused > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Đến hạn quét"
          value={stats.due}
          icon={ClockIcon}
          tone={stats.due > 0 ? "warning" : "default"}
          hint={stats.due > 0 ? "Đang chờ scanner quét" : "Đúng tiến độ"}
        />
        <StatCard
          label="Bắt bài · 24h"
          value={formatNumber(stats.capturesLast24h)}
          icon={ScanLineIcon}
          tone="info"
        />
      </div>

      <SourceFilters />

      {sources.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={RadarIcon}
            title="Không tìm thấy nguồn nào khớp bộ lọc"
            description="Thử chọn loại nguồn khác, xóa từ khóa tìm kiếm hoặc kiểm tra các nguồn tạm dừng."
            action={
              <Button asChild variant="outline" size="lg">
                <Link href="/radar">Xóa bộ lọc</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={RadarIcon}
            title="Chưa có nguồn radar nào"
            description="Thêm nhóm Facebook, Fanpage, KOL hoặc diễn đàn đầu tiên để bắt đầu quét bài viết."
            action={<SourceFormDialog mode="create" triggerLabel="Thêm nguồn đầu tiên" />}
          />
        )
      ) : (
        <SourceList sources={sources} />
      )}

      <LatestCaptures items={activity} />
    </div>
  );
}
