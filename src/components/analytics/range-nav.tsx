import Link from "next/link";

import { Button } from "@/components/ui/button";

const RANGE_OPTIONS = [
  { value: "7", days: 7, label: "7 ngày", ariaLabel: "7 ngày qua" },
  { value: "30", days: 30, label: "30 ngày", ariaLabel: "30 ngày qua" },
  { value: "90", days: 90, label: "90 ngày", ariaLabel: "90 ngày qua" },
  { value: "all", days: null, label: "Tất cả", ariaLabel: "Toàn thời gian" }
] as const;

/**
 * URL-driven range switcher. Every option is a plain link, so the selected
 * window survives refresh, sharing and the back button without client state.
 */
export function AnalyticsRangeNav({ days }: { days: number | null }) {
  return (
    <nav
      aria-label="Date range"
      className="bg-muted/50 grid grid-cols-4 gap-1 rounded-lg border p-1"
    >
      {RANGE_OPTIONS.map((option) => {
        const active = option.days === days;
        return (
          <Button
            key={option.value}
            asChild
            variant={active ? "default" : "ghost"}
            className="h-11 px-3"
          >
            <Link
              href={`/analytics?days=${option.value}`}
              aria-current={active ? "page" : undefined}
              aria-label={option.ariaLabel}
            >
              {option.label}
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}
