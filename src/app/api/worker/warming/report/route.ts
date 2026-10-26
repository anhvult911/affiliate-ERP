import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { authorizeWorker, workerJson } from "@/lib/worker/auth";

export const dynamic = "force-dynamic";

const reportSchema = z
  .object({
    accountId: z.string().uuid("accountId must be a uuid."),
    kind: z.enum(["lifestyle_post", "cross_warm", "profile_setup"]),
    status: z.enum(["completed", "failed"]),
    content: z.string().trim().max(2000).nullish(),
    /** Lifestyle posts: the permalink, so another account can warm it later. */
    postUrl: z.string().url().nullish(),
    targetAccountId: z.string().uuid().nullish(),
    targetPostUrl: z.string().url().nullish(),
    error: z.string().trim().max(2000).nullish(),
    executedAt: z.string().datetime().optional(),
    accountStatus: z.enum(["cooldown", "checkpoint"]).optional(),
    cooldownMinutes: z.number().int().min(1).max(10080).optional(),
    /** profile_setup only: which assets the run actually applied. */
    avatarSet: z.boolean().optional(),
    coverSet: z.boolean().optional(),
    bioSet: z.boolean().optional(),
    /** True when the worker drove the local fixture, not the real platform. */
    sandbox: z.boolean().optional()
  })
  .refine((value) => value.status === "failed" || (value.content && value.content.length > 0), {
    message: "A completed warming run must carry the content that was published.",
    path: ["content"]
  })
  .refine((value) => value.kind !== "lifestyle_post" || value.status === "failed" || Boolean(value.postUrl), {
    message: "A published lifestyle post must report its permalink, otherwise no account can warm it.",
    path: ["postUrl"]
  })
  .refine(
    (value) => value.kind !== "profile_setup" || value.status === "failed" || value.avatarSet || value.coverSet,
    { message: "A completed profile_setup must report at least one applied asset.", path: ["avatarSet"] }
  );

/**
 * POST /api/worker/warming/report
 *
 * Records one warming action and applies its side effects: the run row (audit +
 * schedule gate), `last_warmed_at`, and the trust increment that the persona
 * builder depends on. Account health reported here follows the same rule as task
 * reports — the worker may flag cooldown/checkpoint, never clear them.
 */
export async function POST(request: Request) {
  const auth = authorizeWorker(request);
  if (!auth.ok) return auth.response;

  const parsed = reportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return workerJson({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid body." }, 400);
  }

  const input = parsed.data;
  const supabase = createSupabaseAdminClient();
  const now = input.executedAt ?? new Date().toISOString();

  const { data: account, error: accountError } = await supabase
    .from("social_accounts")
    .select("id,name,trust_score,status")
    .eq("id", input.accountId)
    .maybeSingle();

  if (accountError) return workerJson({ ok: false, error: accountError.message }, 500);
  if (!account) return workerJson({ ok: false, error: "Unknown account." }, 404);

  const { data: run, error: runError } = await supabase
    .from("warming_runs")
    .insert({
      account_id: input.accountId,
      kind: input.kind,
      status: input.status,
      content: input.content ?? null,
      post_url: input.postUrl ?? null,
      target_account_id: input.targetAccountId ?? null,
      target_post_url: input.targetPostUrl ?? null,
      error: input.status === "failed" ? (input.error ?? "Warming action failed") : null,
      sandbox: input.sandbox ?? false,
      executed_at: now
    })
    .select("id")
    .single();

  if (runError) return workerJson({ ok: false, error: runError.message }, 500);

  const patch: {
    last_action_at: string;
    last_warmed_at?: string;
    status?: "cooldown" | "checkpoint";
    cooldown_until?: string | null;
    bio?: string;
    avatar_set_at?: string;
    cover_set_at?: string;
    profile_built_at?: string;
  } = { last_action_at: now };

  let trustScore = account.trust_score ?? 0;

  // Profile state is what a visitor sees, so it is recorded on the account rather
  // than only in the run log — and it is recorded per asset, because a run that
  // changed the avatar and then failed on the bio still changed the avatar. Marking
  // only "completed" runs made the dashboard disagree with the actual profile.
  // Rehearsal runs are recorded for the audit trail but never rewrite it.
  if (input.kind === "profile_setup" && !input.sandbox) {
    if (input.avatarSet) patch.avatar_set_at = now;
    if (input.coverSet) patch.cover_set_at = now;
    // Only when the bio step really ran: writing `content` unconditionally made the
    // dashboard claim an intro that was never saved on Facebook.
    if (input.status === "completed" && input.bioSet && input.content) patch.bio = input.content;

    // The avatar is the minimum for a profile that does not scream "farm", so it is
    // what marks the profile built; without it the schedule retries later.
    if (input.avatarSet) patch.profile_built_at = now;
  }

  if (input.status === "completed") {
    patch.last_warmed_at = now;
  }

  if (input.accountStatus) {
    patch.status = input.accountStatus;
    patch.cooldown_until =
      input.accountStatus === "cooldown" && input.cooldownMinutes
        ? new Date(Date.now() + input.cooldownMinutes * 60_000).toISOString()
        : null;
  }

  const { error: patchError } = await supabase.from("social_accounts").update(patch).eq("id", input.accountId);
  if (patchError) return workerJson({ ok: false, error: patchError.message }, 500);

  // Same rule as a published comment: a successful action earns trust, unless the same
  // report flagged the account for checkpoint. Done in one statement so two reports
  // landing together cannot overwrite each other's increment.
  if (input.status === "completed" && input.accountStatus !== "checkpoint") {
    const { data: bumped, error: bumpError } = await supabase
      .rpc("bump_trust_score", { p_account_id: input.accountId, p_delta: 1 });

    if (bumpError) return workerJson({ ok: false, error: bumpError.message }, 500);
    if (typeof bumped === "number") trustScore = bumped;
  }

  return workerJson({ ok: true, runId: run.id, trustScore });
}
