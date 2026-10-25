"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { setRealtimeStatus } from "@/components/queue/realtime-status";
import { formatMatchScore } from "@/lib/format";
import { isSupabaseConfigured } from "@/lib/env";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Radar → dashboard bridge. Mounted once in the (app) layout so a new capture
 * announces itself on whatever screen the operator is looking at (phone
 * included), then refreshes the server components behind it.
 *
 * Two failure modes are handled explicitly, because both are silent:
 *
 * 1. The channel must join with the operator's JWT. If it joins as `anon`, the
 *    subscribe succeeds and RLS then filters every row — "live" but empty
 *    forever. So the session is hydrated (and re-applied on token refresh)
 *    before subscribing.
 * 2. A dead subscription used to be invisible: the queue simply stopped
 *    refreshing. Every transition now feeds the RealtimeBadge in the queue
 *    header and logs to the console.
 */
export function RealtimeTasksListener() {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const warnedRef = useRef(false);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      console.warn(
        "[realtime] NEXT_PUBLIC_SUPABASE_* missing from the browser bundle — live queue updates are disabled."
      );
      setRealtimeStatus("offline");
      return;
    }

    setRealtimeStatus("connecting");

    let supabase: ReturnType<typeof createSupabaseBrowserClient>;
    try {
      supabase = createSupabaseBrowserClient();
    } catch (error) {
      console.error("[realtime] browser client init failed", error);
      setRealtimeStatus("offline");
      return;
    }

    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    // Keep the socket's token in step with the session across refreshes.
    const { data: authSubscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) supabase.realtime.setAuth(session.access_token);
    });

    const start = async () => {
      const {
        data: { session }
      } = await supabase.auth.getSession();

      if (session?.access_token) {
        supabase.realtime.setAuth(session.access_token);
      } else {
        console.warn("[realtime] no operator session yet — events would be filtered by RLS.");
      }

      if (cancelled) return;

      channel = supabase
        .channel("comment_tasks_stream")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "comment_tasks" },
          (payload) => {
            const row = payload.new as { match_score?: number | null };
            const score = row.match_score ?? null;

            toast("New high-intent post captured", {
              description: `${formatMatchScore(score)} match · tap Queue to review`,
              duration: 8000,
              action: { label: "Open", onClick: () => routerRef.current.push("/queue") }
            });
            routerRef.current.refresh();
          }
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "comment_tasks" },
          (payload) => {
            const row = payload.new as { status?: string; last_error?: string | null };

            if (row.status === "failed" && row.last_error) {
              toast.error("Execution failed", { description: row.last_error });
            }
            routerRef.current.refresh();
          }
        )
        .subscribe((status, error) => {
          if (status === "SUBSCRIBED") {
            console.info("[realtime] subscribed to comment_tasks changes");
            setRealtimeStatus("live");
            return;
          }

          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            console.warn(`[realtime] channel ${status}`, error ?? "");
            setRealtimeStatus("offline");
            if (!warnedRef.current) {
              warnedRef.current = true;
              toast.error("Live updates offline", {
                description: "The queue will not refresh by itself. Reload the page to retry."
              });
            }
          }
        });
    };

    void start();

    return () => {
      cancelled = true;
      authSubscription.subscription.unsubscribe();
      if (channel) void supabase.removeChannel(channel);
    };
  }, []);

  return null;
}
