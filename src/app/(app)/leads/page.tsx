import type { Metadata } from "next";
import Link from "next/link";
import { InboxIcon, PackageCheckIcon, SparklesIcon } from "lucide-react";

import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { LeadCard } from "@/components/leads/lead-card";
import { LeadFilterReport } from "@/components/leads/lead-filter-report";
import { LeadFilters } from "@/components/leads/lead-filters";
import { LeadGroupReport } from "@/components/leads/lead-group-report";
import { LeadsPagination } from "@/components/leads/leads-pagination";
import { Button } from "@/components/ui/button";
import { listLeadGroupFunnel, listLeads } from "@/lib/data/leads";
import { buildLeadsHref, hasLeadFilters, parseLeadListState } from "@/lib/leads/url";

export const metadata: Metadata = { title: "Lead Hunter & chốt đơn" };

type LeadsSearchParams = Record<string, string | string[] | undefined>;

/**
 * Mini CRM (Phase 1). The page is a server component: reads go through the
 * RLS-scoped server client and are filtered by `LEAD_OWNER_ID`, so the operator
 * session and the Phase 2 tenant boundary are both enforced outside the UI.
 */
export default async function LeadsPage({
  searchParams
}: {
  searchParams: Promise<LeadsSearchParams>;
}) {
  const params = await searchParams;
  const state = parseLeadListState(params);
  const filtered = hasLeadFilters(state);

  const [list, funnel] = await Promise.all([
    listLeads({
      status: state.status,
      minScore: state.minScore,
      category: state.category,
      query: state.query,
      page: state.page
    }),
    listLeadGroupFunnel()
  ]);

  const pastLastPage = list.rows.length === 0 && state.page > 1;

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Lead Hunter &amp; chốt đơn"
        description="Bài viết trong nhóm Facebook đang có nhu cầu về Excel, Google Sheets, quản lý kho, dòng tiền hoặc automation. Chấm điểm, ghi mốc chốt thực tế và tiền khách đã trả — không suy ra doanh thu từ trạng thái."
        actions={
          <>
            <Button asChild variant="outline" size="lg" className="w-full sm:w-auto">
              <Link href="/shop-profit">
                <SparklesIcon />
                Offer miễn phí
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="w-full sm:w-auto">
              <Link href="/leads/fulfillment">
                <PackageCheckIcon />
                Vận hành giao hàng
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="w-full sm:w-auto">
              <Link href="/radar">Quản lý từ khóa Radar</Link>
            </Button>
          </>
        }
      />

      <LeadFilterReport />

      <LeadGroupReport rows={funnel} />

      <LeadFilters state={state} />

      {list.rows.length === 0 ? (
        pastLastPage ? (
          <EmptyState
            icon={InboxIcon}
            title="Trang này không còn lead"
            description={`Danh sách chỉ có ${list.pageCount} trang với bộ lọc hiện tại.`}
            action={
              <Button asChild variant="outline">
                <Link href={buildLeadsHref({ ...state, page: 1 })}>Về trang đầu</Link>
              </Button>
            }
          />
        ) : filtered ? (
          <EmptyState
            icon={InboxIcon}
            title="Không có lead khớp bộ lọc"
            description="Thử nới điểm tối thiểu, đổi trạng thái hoặc xóa từ khóa tìm kiếm."
            action={
              <Button asChild variant="outline">
                <Link href={buildLeadsHref({})}>Xóa bộ lọc</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={InboxIcon}
            title="Chưa có lead nào"
            description="Radar sẽ lưu bài viết vào đây ngay khi một nhóm Facebook có bài khớp từ khóa. Thêm nhóm và bật từ khóa ở trang Radar để bắt đầu."
            action={
              <Button asChild variant="outline">
                <Link href="/radar">Mở Radar theo dõi</Link>
              </Button>
            }
          />
        )
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {list.rows.map((lead) => (
              <LeadCard key={lead.id} lead={lead} />
            ))}
          </div>
          <LeadsPagination
            state={state}
            page={list.page}
            pageCount={list.pageCount}
            total={list.total}
          />
        </>
      )}
    </div>
  );
}
