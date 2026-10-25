import type { Metadata } from "next";
import { CheckCircle2Icon, ImagesIcon, PackageIcon, PercentIcon } from "lucide-react";

import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { ResponsiveView } from "@/components/patterns/responsive-view";
import { StatCard } from "@/components/patterns/stat-card";
import { ProductCards } from "@/components/products/product-cards";
import { ImportProductsDialog } from "@/components/products/import-products-dialog";
import { ProductCreateDialog } from "@/components/products/product-create-dialog";
import { ProductsFilters } from "@/components/products/products-filters";
import { ProductsTable } from "@/components/products/products-table";
import { getProductStats, listNicheOptions, listProducts, toProductListItem } from "@/lib/data/products";
import { formatNumber, formatPercent } from "@/lib/format";

export const metadata: Metadata = { title: "Kho sản phẩm" };

type ProductsSearchParams = {
  q?: string | string[];
  niche?: string | string[];
  active?: string | string[];
};

/** A repeated query param arrives as an array; the first value wins. */
function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function ProductsPage({
  searchParams
}: {
  searchParams: Promise<ProductsSearchParams>;
}) {
  const params = await searchParams;
  const query = firstParam(params.q).trim();
  const niche = firstParam(params.niche).trim();
  const activeOnly = firstParam(params.active) === "1";

  const [products, stats, niches] = await Promise.all([
    listProducts({ query, niche, activeOnly }),
    getProductStats(),
    listNicheOptions()
  ]);

  const rows = products.map(toProductListItem);
  const hasFilters = query !== "" || niche !== "" || activeOnly;

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Kho sản phẩm"
        description="Quản lý sản phẩm affiliate, bộ sưu tập ảnh review thực tế và link rút gọn."
        actions={
          <>
            <ImportProductsDialog />
            <ProductCreateDialog />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Tổng sản phẩm" value={formatNumber(stats.total)} icon={PackageIcon} />
        <StatCard
          label="Đang hoạt động"
          value={formatNumber(stats.active)}
          icon={CheckCircle2Icon}
          tone="success"
        />
        <StatCard
          label="Hoa hồng TB"
          value={formatPercent(stats.averageCommissionRate)}
          icon={PercentIcon}
        />
        <StatCard
          label="Có ảnh review"
          value={formatNumber(stats.withReviewImages)}
          icon={ImagesIcon}
          tone="info"
        />
      </div>

      <ProductsFilters
        key={`${query}|${niche}|${String(activeOnly)}`}
        niches={niches}
        query={query}
        niche={niche}
        activeOnly={activeOnly}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={PackageIcon}
          title={hasFilters ? "Không có sản phẩm nào khớp bộ lọc" : "Chưa có sản phẩm nào"}
          description={
            hasFilters
              ? "Thử tìm kiếm với từ khóa khác hoặc xóa bộ lọc để xem toàn bộ danh sách."
              : "Thêm sản phẩm affiliate đầu tiên để bắt đầu ghép đôi bài viết và gắn ảnh review."
          }
          action={hasFilters ? undefined : <ProductCreateDialog />}
        />
      ) : (
        <ResponsiveView
          desktop={<ProductsTable products={rows} />}
          mobile={<ProductCards products={rows} />}
        />
      )}
    </div>
  );
}
