import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import type { Database } from "@/lib/database.types";
import { SUPABASE_ANON_KEY, SUPABASE_URL, requireSupabaseEnv } from "@/lib/env";

/**
 * Request-scoped client for Server Components and Server Actions.
 *
 * RLS applies: queries run as the signed-in operator. Cookie writes are wrapped
 * because Server Components are not allowed to mutate cookies during render —
 * the middleware is what refreshes the session there.
 */
export async function createSupabaseServerClient() {
  requireSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render — safe to ignore, middleware
          // already keeps the session fresh.
        }
      }
    }
  });
}

export async function getSupabaseUser() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
}
