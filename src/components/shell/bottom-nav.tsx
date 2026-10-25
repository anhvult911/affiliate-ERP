"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { MOBILE_TABS } from "@/components/shell/nav-items";
import { cn } from "@/lib/utils";

/**
 * Bottom tab bar (< lg). Four thumb-reach slots exactly as specified: Queue,
 * Products, Accounts, Analytics. Everything else lives in the hamburger sheet.
 * Sitting below 44px padding + the iOS home indicator safe area.
 */
export function BottomNav({ pendingCount = 0 }: { pendingCount?: number }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Quick actions"
      className="bg-background/95 supports-[backdrop-filter]:bg-background/80 fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur lg:hidden"
    >
      <ul className="pb-safe grid grid-cols-4">
        {MOBILE_TABS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const isQueue = item.href === "/queue";
          const Icon = item.icon;

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                prefetch={true}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <div className="relative flex items-center justify-center">
                  <Icon className={cn("size-5", active && "stroke-[2.5]")} />
                  {isQueue && pendingCount > 0 ? (
                    <span className="bg-destructive text-destructive-foreground ring-background absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none ring-2 animate-in zoom-in-75">
                      {pendingCount > 99 ? "99+" : pendingCount}
                    </span>
                  ) : null}
                </div>
                <span className="truncate">{item.label.split(" ")[0]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
