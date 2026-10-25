import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/shell/app-sidebar";
import { BottomNav } from "@/components/shell/bottom-nav";
import { MobileHeader } from "@/components/shell/mobile-header";
import { SetupRequired } from "@/components/shell/setup-required";
import { RealtimeTasksListener } from "@/components/queue/realtime-tasks-listener";
import { isSupabaseConfigured } from "@/lib/env";
import { getSupabaseUser } from "@/lib/supabase/server";
import { getQueueCounts } from "@/lib/data/comment-tasks";

/**
 * Everything under (app) is authenticated with cookies and reads live queue
 * data, so it must render per request. Without this, `next build` tries to
 * prerender the pages and fails on the missing Supabase session.
 */
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured) return <SetupRequired />;
  // The middleware already redirects anonymous traffic; this is the typed
  // guarantee the rest of the tree relies on (and covers direct RSC fetches).
  const [user, counts] = await Promise.all([
    getSupabaseUser(),
    getQueueCounts().catch(() => null)
  ]);
  if (!user) redirect("/login");

  const pendingCount = counts?.pending_approval ?? 0;

  return (
    <div className="flex min-h-dvh w-full">
      {/* Radar → dashboard toasts: mounted once, fires on any screen. */}
      <RealtimeTasksListener />

      <AppSidebar email={user.email ?? null} pendingCount={pendingCount} />

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileHeader email={user.email ?? null} pendingCount={pendingCount} />
        {/* pb-24 clears the fixed bottom tab bar; lg drops it since the tab bar is hidden. */}
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-4 pb-24 sm:px-6 sm:py-6 lg:pb-8">
          {children}
        </main>
      </div>

      <BottomNav pendingCount={pendingCount} />
    </div>
  );
}
