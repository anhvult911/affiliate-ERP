import type { Json } from "@/lib/database.types";
import type { WarmingKind } from "@/lib/db-types";
import type { SupabaseDb } from "@/lib/db";
import { contentFor } from "@/lib/warming/templates";
import {
  dueSlots,
  localMoment,
  profileSetupRetryMinutes,
  warmingGraceMinutes,
  warmingTimezone
} from "@/lib/warming/schedule";

/**
 * Assembles the warming work that is actionable right now.
 *
 * Kept on the app side (not in the worker) for the same reason the radar match
 * lives here: schedule rules and persona copy change often, and changing them
 * must not require redeploying the process that drives browsers.
 */

export type WarmingSlot = {
  accountId: string;
  accountName: string;
  personaType: string;
  /** Antidetect profile id; null when the worker owns the profile (local provider). */
  browserProfileId: string | null;
  proxyIp: string | null;
  kind: WarmingKind;
  /** "HH:MM" local, as scheduled. */
  scheduledAt: string;
  content: string;
  /** cross_warm only: the account whose post we are warming, and where it is. */
  targetAccountId: string | null;
  targetAccountName: string | null;
  targetPostUrl: string | null;
};

type AccountRow = {
  id: string;
  name: string;
  persona_type: string;
  persona_schedule: Json;
  status: string;
  browser_profile_id: string | null;
  proxy_ip: string | null;
  profile_built_at: string | null;
  daily_warming_limit: number;
  min_action_gap_minutes: number;
};

type UsageRow = {
  account_id: string;
  comments_24h: number;
  warming_24h: number;
  last_comment_at: string | null;
  last_warming_at: string | null;
};

type RunRow = {
  account_id: string;
  kind: WarmingKind;
  post_url: string | null;
  target_post_url: string | null;
  executed_at: string;
  sandbox: boolean;
};

const CROSS_WARM_WINDOW_HOURS = 48;
const MAX_LIFESTYLE_TARGET_AGE_HOURS = 72;

function latest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

export async function findDueWarming(db: SupabaseDb, now = new Date()): Promise<WarmingSlot[]> {
  const timezone = warmingTimezone();
  const graceMinutes = warmingGraceMinutes();

  const accountsQuery = db
    .from("social_accounts")
    .select(
      "id,name,persona_type,persona_schedule,status,browser_profile_id,proxy_ip,profile_built_at,daily_warming_limit,min_action_gap_minutes"
    )
    .eq("status", "active")
    .eq("warmup_enabled", true);

  const since = new Date(now.getTime() - CROSS_WARM_WINDOW_HOURS * 3_600_000).toISOString();

  const [accountsResult, runsResult, usageResult] = await Promise.all([
    accountsQuery.overrideTypes<AccountRow[], { merge: false }>(),
    db
      .from("warming_runs")
      .select("account_id,kind,post_url,target_post_url,executed_at,sandbox")
      .gte("executed_at", since)
      .order("executed_at", { ascending: false })
      .overrideTypes<RunRow[], { merge: false }>(),
    db.from("v_account_daily_usage").select("*").overrideTypes<UsageRow[], { merge: false }>()
  ]);

  if (accountsResult.error) throw new Error(`Could not load accounts for warming: ${accountsResult.error.message}`);
  if (runsResult.error) throw new Error(`Could not load warming runs: ${runsResult.error.message}`);
  if (usageResult.error) throw new Error(`Could not load account usage: ${usageResult.error.message}`);

  const accounts = accountsResult.data ?? [];
  const runs = runsResult.data ?? [];
  const usageByAccount = new Map((usageResult.data ?? []).map((row) => [row.account_id, row]));
  const byId = new Map(accounts.map((account) => [account.id, account]));

  // Posts available to warm: a lifestyle post another account published recently.
  // A fixture post is not a real permalink, so it can never be warmed for real.
  const warmableTargets = runs
    .filter((run) => !run.sandbox)
    .filter((run) => run.kind === "lifestyle_post" && run.post_url)
    .filter((run) => new Date(run.executed_at).getTime() >= now.getTime() - MAX_LIFESTYLE_TARGET_AGE_HOURS * 3_600_000);

  const slots: WarmingSlot[] = [];

  for (const account of accounts) {
    const accountRuns = runs.filter((run) => run.account_id === account.id);


    // An account whose profile was never dressed gets that first: an empty avatar
    // and no bio is the fastest way for a visitor to see a farm. It runs outside
    // the schedule because it is a one-off precondition, not a routine, and it is
    // throttled to one attempt per 6 hours so a missing asset cannot turn into a
    // retry loop against Facebook.
    // Volume and rhythm: a persona that already did its share today, or acted
    // minutes ago, is skipped — warming is the most repetitive traffic there is,
    // so it is the first place a fixed rhythm gets noticed.
    const usage = usageByAccount.get(account.id);
    if (usage && usage.warming_24h >= account.daily_warming_limit) continue;

    const lastAction = latest(usage?.last_comment_at ?? null, usage?.last_warming_at ?? null);
    if (lastAction && now.getTime() - new Date(lastAction).getTime() < account.min_action_gap_minutes * 60_000) {
      continue;
    }

    // A failed attempt is retried after 30 minutes, not 6 hours: selector drift and
    // timeouts are transient, while a 6-hour bench leaves the profile looking empty
    // all day. Success sets `profile_built_at`, so this branch stops applying.
    const setupRetryMs = profileSetupRetryMinutes() * 60_000;
    const recentSetupAttempt = accountRuns.some(
      (run) => run.kind === "profile_setup" && new Date(run.executed_at).getTime() >= now.getTime() - setupRetryMs
    );

    // One action per account per cycle: the worker would otherwise run every slot
    // it was handed back-to-back, which is exactly the burst the gap exists to stop.
    if (!account.profile_built_at && !recentSetupAttempt) {
      slots.push({
        accountId: account.id,
        accountName: account.name,
        personaType: account.persona_type,
        browserProfileId: account.browser_profile_id,
        proxyIp: account.proxy_ip,
        kind: "profile_setup",
        scheduledAt: "first",
        content: contentFor(account.persona_type, "profile_setup", `${account.id}:bio`),
        targetAccountId: null,
        targetAccountName: null,
        targetPostUrl: null
      });
      continue;
    }

    const slotRuns = accountRuns.map((run) => ({ kind: run.kind, executedAt: run.executed_at }));

    for (const slot of dueSlots(account.persona_schedule, { now, timezone, graceMinutes, runs: slotRuns })) {
      const seedKey = `${account.id}:${localMoment(now, timezone).date}:${slot.kind}:${slot.at}`;

      if (slot.kind === "lifestyle_post") {
        slots.push({
          accountId: account.id,
          accountName: account.name,
          personaType: account.persona_type,
          browserProfileId: account.browser_profile_id,
          proxyIp: account.proxy_ip,
          kind: slot.kind,
          scheduledAt: slot.at,
          content: contentFor(account.persona_type, slot.kind, seedKey),
          targetAccountId: null,
          targetAccountName: null,
          targetPostUrl: null
        });
        continue;
      }

      // cross_warm: warm somebody else's recent post, once, and prefer the same
      // persona — two decor accounts agreeing reads like a community, not a farm.
      const alreadyWarmed = new Set(
        accountRuns.filter((run) => run.kind === "cross_warm").map((run) => run.target_post_url)
      );

      const candidates = warmableTargets.filter(
        (target) => target.account_id !== account.id && target.post_url && !alreadyWarmed.has(target.post_url)
      );
      const samePersona = candidates.filter(
        (candidate) => byId.get(candidate.account_id)?.persona_type === account.persona_type
      );
      const target = samePersona[0] ?? candidates[0];

      if (!target?.post_url) continue; // nothing to warm yet — not a failure, just quiet

      slots.push({
        accountId: account.id,
        accountName: account.name,
        personaType: account.persona_type,
        browserProfileId: account.browser_profile_id,
        proxyIp: account.proxy_ip,
        kind: slot.kind,
        scheduledAt: slot.at,
        content: contentFor(account.persona_type, slot.kind, `${seedKey}:${target.post_url}`),
        targetAccountId: target.account_id,
        targetAccountName: byId.get(target.account_id)?.name ?? null,
        targetPostUrl: target.post_url
      });

      // One scheduled slot per account per cycle (see the note above).
      break;
    }
  }

  return slots;
}
