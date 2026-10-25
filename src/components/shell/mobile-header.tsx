"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MenuIcon, Zap } from "lucide-react";

import { findNavItem } from "@/components/shell/nav-items";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { ThemeToggleButton } from "@/components/shell/theme-toggle";
import { UserMenu } from "@/components/shell/user-menu";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

/**
 * Mobile/tablet top bar. Sticky so the hamburger (and therefore the four
 * modules that are not bottom tabs) stays reachable while scrolling.
 */
export function MobileHeader({
  email,
  pendingCount = 0
}: {
  email: string | null;
  pendingCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const current = findNavItem(pathname);

  return (
    <header className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-40 flex h-14 items-center gap-2 border-b px-2 backdrop-blur lg:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open navigation"
          onClick={() => setOpen(true)}
          className="relative"
        >
          <MenuIcon className="size-5" />
          {pendingCount > 0 ? (
            <span className="bg-destructive absolute top-2 right-2 size-2 rounded-full ring-2 ring-background" />
          ) : null}
        </Button>

        <SheetContent side="left" className="w-[85vw] max-w-xs gap-0 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Module navigation and account actions
          </SheetDescription>

          <div className="flex h-14 items-center gap-2 border-b px-4">
            <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-md">
              <Zap className="size-4" />
            </span>
            <span className="text-sm font-semibold">Affiliate ERP</span>
          </div>

          <div className="flex-1 overflow-y-auto py-3">
            <SidebarNav onNavigate={() => setOpen(false)} pendingCount={pendingCount} />
          </div>

          <div className="border-t p-2 pb-safe">
            <UserMenu email={email} className="h-auto w-full justify-start gap-2 px-3 py-3" />
          </div>
        </SheetContent>
      </Sheet>

      <Link
        href={current?.href ?? "/queue"}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2"
      >
        <span className="block truncate text-sm font-semibold">
          {current?.label ?? "Affiliate ERP"}
        </span>
        {current?.href === "/queue" && pendingCount > 0 ? (
          <span className="bg-destructive/15 text-destructive border-destructive/25 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold tabular-nums">
            {pendingCount} chờ duyệt
          </span>
        ) : null}
      </Link>

      <ThemeToggleButton />
    </header>
  );
}
