"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

function ChartSkeleton() {
  return (
    <div className="h-56 w-full sm:h-72 flex items-center justify-center">
      <Skeleton className="h-full w-full rounded-md" />
    </div>
  );
}

export const DynamicRevenueChart = dynamic(
  () => import("@/components/analytics/revenue-chart").then((mod) => mod.RevenueChart),
  {
    ssr: false,
    loading: () => <ChartSkeleton />
  }
);

export const DynamicSourceCommissionChart = dynamic(
  () => import("@/components/analytics/source-chart").then((mod) => mod.SourceCommissionChart),
  {
    ssr: false,
    loading: () => <ChartSkeleton />
  }
);

export const DynamicTopAccountsChart = dynamic(
  () => import("@/components/analytics/accounts-chart").then((mod) => mod.TopAccountsChart),
  {
    ssr: false,
    loading: () => <ChartSkeleton />
  }
);
