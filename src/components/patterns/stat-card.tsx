import type { LucideIcon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const toneClasses = {
  default: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  info: "text-info"
} as const;

/** KPI tile used across the dashboard modules (2-up on mobile, 4-up on desktop). */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  className
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  tone?: keyof typeof toneClasses;
  className?: string;
}) {
  return (
    <Card className={cn("gap-2 py-3 sm:py-4", className)}>
      <div className="flex items-start justify-between gap-2 px-3 sm:px-4">
        <p className="text-muted-foreground text-xs font-medium sm:text-sm">{label}</p>
        {Icon ? <Icon className={cn("size-4 shrink-0", toneClasses[tone])} /> : null}
      </div>
      <div className="space-y-0.5 px-3 sm:px-4">
        <p className={cn("text-lg font-semibold tabular-nums sm:text-2xl", toneClasses[tone])}>
          {value}
        </p>
        {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      </div>
    </Card>
  );
}
