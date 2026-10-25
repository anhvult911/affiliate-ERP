import type { ReactNode } from "react";

/**
 * The one place where the desktop/mobile split is decided for list views:
 * >= lg renders the table, below lg renders stacked touch cards. Both branches
 * receive the same rows, so they cannot drift.
 */
export function ResponsiveView({
  desktop,
  mobile
}: {
  desktop: ReactNode;
  mobile: ReactNode;
}) {
  return (
    <>
      <div className="hidden lg:block">{desktop}</div>
      <div className="@container/mobile-list lg:hidden">
        <div className="flex flex-col gap-3">{mobile}</div>
      </div>
    </>
  );
}
