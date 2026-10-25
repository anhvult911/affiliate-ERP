"use client";

import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/database.types";
import { SUPABASE_ANON_KEY, SUPABASE_URL, requireSupabaseEnv } from "@/lib/env";

/**
 * Browser client — used for realtime subscriptions in the dashboard.
 * RLS (public.is_operator()) is the only thing guarding these queries.
 */
export function createSupabaseBrowserClient() {
  requireSupabaseEnv();
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
}
