import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import type { Database } from "@/lib/database.types";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "@/lib/env";

/** Routes that never require a signed-in operator. */
const PUBLIC_PATHS = ["/login", "/auth", "/setup"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Refreshes the Supabase session cookie on every navigation and gates the
 * dashboard behind auth. Worker/postback APIs are excluded by the matcher in
 * src/middleware.ts — they authenticate with a bearer token instead.
 */
export async function updateSession(request: NextRequest) {
  // Unconfigured install: let the (app) layout render its setup screen.
  if (!isSupabaseConfigured) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      }
    }
  });

  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser();

  /*
   * A stale session (most often after `supabase db reset`, which wipes auth.users)
   * makes every request retry a refresh token that can never be valid, spamming
   * AuthApiError. Dropping the cookies turns that into a single clean redirect to
   * the sign-in page.
   */
  if (authError && /refresh token|invalid|not found/i.test(authError.message)) {
    for (const cookie of request.cookies.getAll()) {
      if (cookie.name.startsWith("sb-") && cookie.name.includes("auth-token")) {
        response.cookies.delete(cookie.name);
      }
    }
  }

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    if (request.nextUrl.pathname !== "/") {
      loginUrl.searchParams.set("next", request.nextUrl.pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  if (user && request.nextUrl.pathname === "/login") {
    const home = request.nextUrl.clone();
    home.pathname = "/queue";
    home.search = "";
    return NextResponse.redirect(home);
  }

  return response;
}
