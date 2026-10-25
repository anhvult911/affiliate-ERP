import type { AccountStatus } from "@/lib/constants";
import type { Tables } from "@/lib/database.types";
import type { Views } from "@/lib/db-types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AccountRow = Tables<"social_accounts">;
export type AccountPerformance = Views<"v_account_performance">;

export type AccountStats = {
  total: number;
  active: number;
  cooldown: number;
  checkpoint: number;
  averageTrustScore: number;
};

export type AccountRecentTask = Tables<"comment_tasks"> & {
  product: Pick<Tables<"products">, "id" | "name"> | null;
  source: Pick<Tables<"target_sources">, "id" | "name" | "source_type"> | null;
};

export type AccountListFilters = {
  query?: string;
  status?: AccountStatus;
  limit?: number;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Accounts for the list route. Highest trust first: the operator wants to see
 * which personas are ready to comment and which are still warming.
 */
export async function listAccounts(
  filters: AccountListFilters = {}
): Promise<AccountRow[]> {
  const supabase = await createSupabaseServerClient();

  let request = supabase
    .from("social_accounts")
    .select("*")
    .order("trust_score", { ascending: false })
    .order("name", { ascending: true });

  const term = filters.query?.trim().replace(/[,()]/g, " ").trim();
  if (term) {
    request = request.or(`name.ilike.%${term}%,persona_type.ilike.%${term}%`);
  }

  if (filters.status) request = request.eq("status", filters.status);

  if (typeof filters.limit === "number" && filters.limit > 0) {
    request = request.limit(filters.limit);
  }

  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getAccount(id: string): Promise<AccountRow | null> {
  if (!UUID_PATTERN.test(id)) return null;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("social_accounts")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

export async function getAccountPerformance(
  id: string
): Promise<AccountPerformance | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("v_account_performance")
    .select("*")
    .eq("account_id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

export async function getAccountRecentTasks(
  id: string,
  limit = 10
): Promise<AccountRecentTask[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("comment_tasks")
    .select("*, product:products(id, name), source:target_sources(id, name, source_type)")
    .eq("assigned_account_id", id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as AccountRecentTask[];
}

export async function getAccountStats(): Promise<AccountStats> {
  const supabase = await createSupabaseServerClient();

  // One aggregate round trip instead of five (4 counts + a full trust_score scan).
  const { data, error } = await supabase.rpc("account_stats");
  if (error) throw new Error(`Could not load account stats: ${error.message}`);

  const byStatus: Record<AccountStatus, number> = { active: 0, cooldown: 0, checkpoint: 0 };
  let total = 0;
  let trustSum = 0;
  let trustCount = 0;

  for (const row of data ?? []) {
    const count = Number(row.total);
    byStatus[row.status] = count;
    total += count;
    if (row.avg_trust !== null) {
      trustSum += Number(row.avg_trust) * count;
      trustCount += count;
    }
  }

  return {
    total,
    active: byStatus.active,
    cooldown: byStatus.cooldown,
    checkpoint: byStatus.checkpoint,
    averageTrustScore: trustCount > 0 ? Math.round(trustSum / trustCount) : 0
  };
}

/** Distinct persona keys already in use, for the persona-type suggestions. */
export async function listPersonaTypes(): Promise<string[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("social_accounts")
    .select("persona_type")
    .order("persona_type", { ascending: true });

  if (error) throw new Error(error.message);

  const seen = new Set<string>();
  for (const row of data ?? []) {
    const value = row.persona_type.trim();
    if (value) seen.add(value);
  }
  return [...seen];
}

export type AccountDailyUsage = {
  accountId: string;
  comments24h: number;
  warming24h: number;
  lastActionAt: string | null;
};

/**
 * How much of each account's daily budget is already spent.
 *
 * The claim function enforces these numbers, so the dashboard has to show them:
 * an operator looking at an idle-looking queue needs to know whether the tasks are
 * waiting for a persona that is simply out of comments for today.
 */
export async function listAccountDailyUsage(): Promise<Map<string, AccountDailyUsage>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("v_account_daily_usage")
    .select("account_id,comments_24h,warming_24h,last_comment_at,last_warming_at")
    .overrideTypes<
      {
        account_id: string;
        comments_24h: number;
        warming_24h: number;
        last_comment_at: string | null;
        last_warming_at: string | null;
      }[],
      { merge: false }
    >();

  if (error) throw new Error(`Could not load daily usage: ${error.message}`);

  const map = new Map<string, AccountDailyUsage>();
  for (const row of data ?? []) {
    const last =
      !row.last_comment_at
        ? row.last_warming_at
        : !row.last_warming_at
          ? row.last_comment_at
          : new Date(row.last_comment_at).getTime() >= new Date(row.last_warming_at).getTime()
            ? row.last_comment_at
            : row.last_warming_at;

    map.set(row.account_id, {
      accountId: row.account_id,
      comments24h: row.comments_24h,
      warming24h: row.warming_24h,
      lastActionAt: last ?? null
    });
  }

  return map;
}
