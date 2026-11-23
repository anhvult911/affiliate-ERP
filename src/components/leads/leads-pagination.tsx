import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { buildLeadsHref, type LeadListUrlState } from "@/lib/leads/url";

/**
 * Prev/next links preserve every active filter. Pages exist beyond the first
 * page because the server reads `?page=` and computes the range from it.
 */
export function LeadsPagination({
  state,
  page,
  pageCount,
  total
}: {
  state: LeadListUrlState;
  page: number;
  pageCount: number;
  total: number;
}) {
  const previousHref = buildLeadsHref({ ...state, page: Math.max(1, page - 1) });
  const nextHref = buildLeadsHref({ ...state, page: page + 1 });
  const hasPrevious = page > 1;
  const hasNext = page < pageCount;

  return (
    <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-muted-foreground text-sm">
        {formatNumber(total)} lead · Trang <span className="text-foreground font-medium">{page}</span>
        /{pageCount}
      </p>

      <div className="flex items-center gap-2">
        {hasPrevious ? (
          <Button asChild variant="outline" size="sm" className="min-h-11">
            <Link href={previousHref} rel="prev">
              <ChevronLeftIcon />
              Trang trước
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="min-h-11" disabled>
            <ChevronLeftIcon />
            Trang trước
          </Button>
        )}

        {hasNext ? (
          <Button asChild variant="outline" size="sm" className="min-h-11">
            <Link href={nextHref} rel="next">
              Trang sau
              <ChevronRightIcon />
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="min-h-11" disabled>
            Trang sau
            <ChevronRightIcon />
          </Button>
        )}
      </div>
    </div>
  );
}
