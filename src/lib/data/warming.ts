import type { Tables } from "@/lib/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Read side of persona warming.
 *
 * The worker writes `warming_runs`; without this the operator cannot tell whether
 * the farm is actually warming itself — which is the whole point of module 2.
 */

export type WarmingRun = Tables<"warming_runs"> & {
  target: { name: string } | null;
};

export type WarmingStats = {
  total: number;
  lifestyle: number;
  crossWarm: number;
  failed: number;
  lastRunAt: string | null;
};

const RUN_LIMIT = 12;

export async function listWarmingRuns(accountId: string, limit = RUN_LIMIT): Promise<WarmingRun[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("warming_runs")
    .select("*,target:social_accounts!warming_runs_target_account_id_fkey(name)")
    .eq("account_id", accountId)
    .order("executed_at", { ascending: false })
    .limit(limit)
    .overrideTypes<WarmingRun[], { merge: false }>();

  if (error) throw new Error(`Could not load warming runs: ${error.message}`);

  return data ?? [];
}

export async function getWarmingStats(accountId: string): Promise<WarmingStats> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("warming_runs")
    .select("kind,status,executed_at")
    .eq("account_id", accountId)
    .order("executed_at", { ascending: false })
    .limit(200);

  if (error) throw new Error(`Could not load warming stats: ${error.message}`);

  const rows = data ?? [];
  const failed = rows.filter((row) => row.status === "failed").length;

  return {
    total: rows.length,
    lifestyle: rows.filter((row) => row.kind === "lifestyle_post").length,
    crossWarm: rows.filter((row) => row.kind === "cross_warm").length,
    failed,
    lastRunAt: rows[0]?.executed_at ?? null
  };
}

export type ProfileReadiness = {
  /** What a visitor reads under the avatar. */
  bio: string | null;
  avatarSetAt: string | null;
  coverSetAt: string | null;
  profileBuiltAt: string | null;
  /** Lifestyle posts published on the timeline so far. */
  posts: number;
  /** 0–100: avatar, cover, bio and at least three posts. */
  score: number;
  missing: ("avatar" | "cover" | "bio" | "posts")[];
  lastSetupAt: string | null;
  lastSetupError: string | null;
};

/**
 * How complete the public profile looks, which is the only thing a real visitor
 * (or a moderator) actually sees.
 */
export async function getProfileReadiness(accountId: string): Promise<ProfileReadiness> {
  const supabase = await createSupabaseServerClient();

  const [accountResult, runsResult] = await Promise.all([
    supabase
      .from("social_accounts")
      .select("bio,avatar_set_at,cover_set_at,profile_built_at")
      .eq("id", accountId)
      .maybeSingle(),
    supabase
      .from("warming_runs")
      .select("kind,status,error,executed_at")
      .eq("account_id", accountId)
      .order("executed_at", { ascending: false })
      .limit(200)
  ]);

  if (accountResult.error) throw new Error(`Could not load the profile: ${accountResult.error.message}`);
  if (runsResult.error) throw new Error(`Could not load warming runs: ${runsResult.error.message}`);

  const account = accountResult.data;
  const runs = runsResult.data ?? [];

  const posts = runs.filter((run) => run.kind === "lifestyle_post" && run.status === "completed").length;
  const setupRun = runs.find((run) => run.kind === "profile_setup") ?? null;

  const missing: ProfileReadiness["missing"] = [];
  if (!account?.avatar_set_at) missing.push("avatar");
  if (!account?.cover_set_at) missing.push("cover");
  if (!account?.bio) missing.push("bio");
  if (posts < 3) missing.push("posts");

  return {
    bio: account?.bio ?? null,
    avatarSetAt: account?.avatar_set_at ?? null,
    coverSetAt: account?.cover_set_at ?? null,
    profileBuiltAt: account?.profile_built_at ?? null,
    posts,
    score: Math.round(((4 - missing.length) / 4) * 100),
    missing,
    lastSetupAt: setupRun?.executed_at ?? null,
    lastSetupError: setupRun?.status === "failed" ? (setupRun.error ?? null) : null
  };
}
