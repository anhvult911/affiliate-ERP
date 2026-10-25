import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Module header. Stacks on mobile (title above, actions full width below) and
 * becomes a single row from `sm` up so desktop toolbars stay compact.
 */
export function PageHeader({
  title,
  description,
  actions,
  className
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0 space-y-1">
        <h1 className="truncate text-xl font-semibold tracking-tight lg:text-2xl">{title}</h1>
        {description ? (
          <p className="text-muted-foreground text-sm text-balance">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">{actions}</div> : null}
    </div>
  );
}
