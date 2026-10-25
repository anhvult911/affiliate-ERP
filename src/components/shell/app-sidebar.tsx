import Link from "next/link";

import { SidebarNav } from "@/components/shell/sidebar-nav";
import { UserMenu } from "@/components/shell/user-menu";
import { Zap } from "lucide-react";

/** Desktop-only rail (lg+). Below lg the hamburger sheet + bottom tabs take over. */
export function AppSidebar({
  email,
  pendingCount = 0
}: {
  email: string | null;
  pendingCount?: number;
}) {
  return (
    <aside className="bg-sidebar text-sidebar-foreground sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r lg:flex">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-md">
          <Zap className="size-4" />
        </span>
        <Link href="/queue" className="min-w-0">
          <span className="block truncate text-sm font-semibold">Affiliate ERP</span>
          <span className="text-muted-foreground block truncate text-[11px]">
            Social Automation Hub
          </span>
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto py-3">
        <SidebarNav pendingCount={pendingCount} />
      </div>

      <div className="border-t p-2">
        <UserMenu email={email} />
      </div>
    </aside>
  );
}
