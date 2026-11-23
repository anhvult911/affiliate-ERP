import { z } from "zod";

import { isGeminiConfigured, analyzePostForMatch, draftComment, embedText } from "@/lib/ai/gemini";
import { readMatchThreshold } from "@/lib/ai/prompts";
import { captureGroupLead } from "@/lib/leads/collector";
import { LEAD_OWNER_ID } from "@/lib/leads/config";
import type { SupabaseDb } from "@/lib/db";
import type { Tables } from "@/lib/database.types";
import { pickDefaultAccount } from "@/lib/queue/assignment";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notifyNewCapture } from "@/lib/telegram/notify";
import { authorizeWorker, workerJson } from "@/lib/worker/auth";
import { readSeen, recordSeen, shouldSkipSeen } from "@/lib/radar/seen-cache";
import { normalizePostUrl } from "@/lib/worker/url";

export const dynamic = "force-dynamic";

const ingestSchema = z.object({
  sourceId: z.string().uuid("sourceId must be a uuid.").optional(),
  sourceUrl: z.string().url().optional(),
  postUrl: z.string().url("postUrl must be a URL."),
  postContent: z.string().max(20000).nullish(),
  postImages: z.array(z.string().url()).max(10).optional(),
  authorName: z.string().trim().max(200).nullish(),
  /** Pin a product instead of letting Gemini choose (manual override). */
  productId: z.string().uuid().optional(),
  /** Generate the comment draft during ingest; otherwise the operator triggers it. */
  draft: z.boolean().optional()
});

type Candidate = { id: string; name: string; niche: string | null; pros_cons_summary: string | null };

type Source = Pick<Tables<"target_sources">,
  "id" | "name" | "source_type" | "capture_mode" | "niche" | "tone_of_voice" | "group_rules" | "is_active" | "keywords_json"
>;

/**
 * POST /api/worker/radar/ingest
 *
 * The radar half of the pipeline. The scraper posts raw captures here; the app
 * owns matching and drafting so prompt changes never require a worker deploy:
 *
 *   capture → normalize + de-duplicate URL → semantic candidate retrieval
 *   (pgvector) → Gemini match score → comment_tasks (pending_approval)
 *   → realtime toast on the dashboard.
 */
export async function POST(request: Request) {
  const auth = authorizeWorker(request);
  if (!auth.ok) return auth.response;

  const parsed = ingestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return workerJson({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid body." }, 400);
  }

  const input = parsed.data;
  const supabase = createSupabaseAdminClient();

  let sourceQuery = supabase
    .from("target_sources")
    .select("id,name,source_type,capture_mode,niche,tone_of_voice,group_rules,is_active,keywords_json")
    .eq("user_id", LEAD_OWNER_ID);
  sourceQuery = input.sourceId
    ? sourceQuery.eq("id", input.sourceId)
    : sourceQuery.eq("url", input.sourceUrl ?? "");

  const { data: source, error: sourceError } = await sourceQuery.maybeSingle();
  if (sourceError) return workerJson({ ok: false, error: sourceError.message }, 500);
  if (!source) {
    return workerJson(
      { ok: false, error: "Unknown target source — add it in the Radar Watchlist first." },
      404
    );
  }

  const postUrl = normalizePostUrl(input.postUrl);
  if (!source.is_active) return workerJson({ ok: true, created: false, paused: true });

  // Routing is stored on the watchlist row, not a process env: different groups
  // can feed the affiliate pipeline and the lead hunter at the same time. The
  // DB check already constrains non-groups to affiliate; mirror it here so a
  // legacy row or a direct service-role write cannot turn a fanpage into a lead.
  const mode = source.source_type === "group" ? source.capture_mode : "affiliate";
  if (mode === "affiliate") return ingestAffiliate(supabase, source, input, postUrl);
  // Fail closed: a missing/unknown mode must not silently fall through to `both`,
  // which would create leads and comment tasks the operator never opted into.
  if (mode !== "leads" && mode !== "both") {
    return workerJson({ ok: false, error: "Invalid capture_mode for this source." }, 500);
  }

  const lead = captureGroupLead(supabase, source, postUrl, input.postContent ?? "", input.authorName ?? null);
  if (mode === "leads") {
    const result = await lead;
    return result === "storage_error"
      ? workerJson({ ok: false, error: "Could not persist lead.", lead: result }, 503)
      : workerJson({ ok: true, created: false, duplicate: result === "duplicate", lead: result });
  }
  // Both consumers see every discovery, even if the other one already processed that URL.
  const [leadResult, affiliate] = await Promise.all([lead, ingestAffiliate(supabase, source, input, postUrl)]);
  const body = await affiliate.json();
  if (leadResult === "storage_error" && affiliate.ok) {
    return workerJson({ ...body, ok: false, error: "Could not persist lead.", lead: leadResult }, 503);
  }
  return workerJson({ ...body, lead: leadResult }, affiliate.status);
}

async function ingestAffiliate(
  supabase: SupabaseDb, source: Source, input: z.infer<typeof ingestSchema>, postUrl: string
) {
  const { data: existing } = await supabase
    .from("comment_tasks")
    .select("id")
    .eq("post_url", postUrl)
    .maybeSingle();

  if (existing) {
    return workerJson({ ok: true, created: false, duplicate: true, taskId: existing.id });
  }

  // Negative cache (P2-4): a post already judged below the threshold is not scored
  // again until the entry expires. Without this every 15-minute scan re-embedded the
  // same static top-of-feed posts.
  const seen = await readSeen(supabase, postUrl);
  if (shouldSkipSeen(seen)) {
    return workerJson({
      ok: true,
      created: false,
      cached: true,
      score: seen?.score ?? null,
      seenAt: seen?.seenAt ?? null
    });
  }

  // A pinned product needs no AI matching — only the auto-match path does. This
  // keeps the radar usable (and locally testable) before GEMINI_API_KEY exists.
  if (!input.productId && !isGeminiConfigured()) {
    return workerJson(
      {
        ok: false,
        error:
          "GEMINI_API_KEY is not configured — automatic matching is disabled. Send productId to pin a product instead."
      },
      503
    );
  }

  const threshold = readMatchThreshold();

  type ProductRow = {
    id: string;
    name: string;
    niche: string | null;
    pros_cons_summary: string | null;
  };

  let matchedProductId: string | null = null;
  let productRow: ProductRow | null = null;
  let matchScore = 0;
  let matchReason = "";

  const PRODUCT_COLUMNS = "id,name,niche,pros_cons_summary";

  if (input.productId) {
    // Operator-pinned product: matching is a human decision, so this path needs
    // no GEMINI_API_KEY at all (and no embedding round-trip).
    const { data: pinned, error: pinnedError } = await supabase
      .from("products")
      .select(PRODUCT_COLUMNS)
      .eq("id", input.productId)
      .maybeSingle()
      .overrideTypes<ProductRow | null, { merge: false }>();

    if (pinnedError) return workerJson({ ok: false, error: pinnedError.message }, 500);
    if (!pinned) return workerJson({ ok: false, error: "Pinned product not found." }, 404);

    productRow = pinned;
    matchedProductId = pinned.id;
    matchScore = 1;
    matchReason = "Pinned by the operator at ingest.";
  } else {
    // Candidate retrieval: vector search when the post can be embedded, otherwise
    // fall back to the source's niche so matching still works before the embedding
    // worker has backfilled products.
    let candidates: Candidate[] = [];
    const postText = [input.postContent ?? "", input.postUrl].join("\n").trim();

    try {
      const embedding = await embedText(postText);
      const { data: matched, error: matchError } = await supabase.rpc("match_products", {
        p_embedding: JSON.stringify(embedding),
        p_limit: 25
      });

      if (matchError) throw new Error(matchError.message);
      candidates = matched ?? [];
    } catch {
      // Embedding unavailable (quota, model rename) — degrade to niche filtering
      // rather than dropping the capture.
      let fallback = supabase
        .from("products")
        .select("id,name,niche,pros_cons_summary")
        .eq("is_active", true)
        .limit(50);

      if (source.niche) fallback = fallback.eq("niche", source.niche);

      const { data } = await fallback;
      candidates = data ?? [];
    }

    if (candidates.length === 0) {
      return workerJson(
        {
          ok: false,
          error: "No candidate products. Add products (with embeddings) to the Affiliate Hub."
        },
        409
      );
    }

    let match: Awaited<ReturnType<typeof analyzePostForMatch>>;
    try {
      match = await analyzePostForMatch({
        postContent: input.postContent ?? "",
        postImages: input.postImages ?? [],
        candidates
      });
    } catch (error) {
      // A model outage (504 DEADLINE_EXPIRED on both fallback models after ~32 s, seen in
      // practice) used to escape this route as an unhandled exception: the worker got a
      // 500 with an empty body, so it could not even say why, and nothing retried
      // differently. Answer honestly instead: 503 + a readable reason, and do NOT record
      // the post as seen — the next scan must be free to try it again.
      return workerJson(
        {
          ok: false,
          retryable: true,
          error: `Matching failed: ${error instanceof Error ? error.message : String(error)}`
        },
        503
      );
    }

    matchedProductId = match.productId;
    matchScore = match.score;
    matchReason = match.reason;
  }

  if (!matchedProductId || matchScore < threshold) {
    await Promise.all([
      supabase
        .from("target_sources")
        .update({ last_scanned_at: new Date().toISOString() })
        .eq("user_id", LEAD_OWNER_ID)
        .eq("id", source.id),
      recordSeen(supabase, {
        postUrl,
        sourceId: source.id,
        score: matchScore,
        reason: matchReason.slice(0, 500)
      })
    ]);

    return workerJson({
      ok: true,
      created: false,
      belowThreshold: true,
      score: matchScore,
      threshold,
      reason: matchReason
    });
  }

  const { data: accounts } = await supabase
    .from("social_accounts")
    .select("id,name,persona_type,status,trust_score,browser_profile_id,proxy_ip")
    .order("trust_score", { ascending: false });

  // The AI path resolved an id, not the row — fetch it once, here.
  const product =
    productRow ??
    (
      await supabase
        .from("products")
        .select(PRODUCT_COLUMNS)
        .eq("id", matchedProductId)
        .maybeSingle()
        .overrideTypes<ProductRow | null, { merge: false }>()
    ).data;

  if (!product) {
    return workerJson({ ok: false, error: "Matched product disappeared before insert." }, 409);
  }

  const defaultAccount = pickDefaultAccount(accounts ?? [], product.niche ?? source.niche);

  let draft: string | null = null;
  if (input.draft && defaultAccount) {
    try {
      const generated = await draftComment({
        post: { content: input.postContent ?? null, images: input.postImages ?? [], url: postUrl },
        product: {
          name: product.name,
          niche: product.niche,
          pros_cons_summary: product.pros_cons_summary
        },
        source: {
          name: source.name,
          niche: source.niche,
          tone_of_voice: source.tone_of_voice,
          group_rules: source.group_rules
        },
        persona: { name: defaultAccount.name, persona_type: defaultAccount.persona_type },
        mode: "single"
      });
      draft = generated.comment;
    } catch {
      // Drafting is best-effort: the task still lands in the queue for the
      // operator to write or regenerate.
      draft = null;
    }
  }

  const { data: created, error: insertError } = await supabase
    .from("comment_tasks")
    .insert({
      source_id: source.id,
      post_url: postUrl,
      post_content: input.postContent ?? null,
      post_images: input.postImages ?? [],
      match_score: matchScore,
      matched_product_id: matchedProductId,
      assigned_account_id: defaultAccount?.id ?? null,
      execution_mode: "single",
      status: "pending_approval",
      ai_draft_comment: draft
    })
    .select("id")
    .single();

  if (insertError) {
    // 23505 = the unique index on post_url won the race with a parallel scan.
    if (insertError.code === "23505") {
      return workerJson({ ok: true, created: false, duplicate: true });
    }
    return workerJson({ ok: false, error: insertError.message }, 500);
  }

  await supabase
    .from("target_sources")
    .update({ last_scanned_at: new Date().toISOString() })
    .eq("user_id", LEAD_OWNER_ID)
    .eq("id", source.id);

  // Push it to the phone: a capture is worthless if it waits for someone to open
  // the dashboard.
  await notifyNewCapture(supabase, created.id);

  return workerJson({
    ok: true,
    created: true,
    taskId: created.id,
    score: matchScore,
    reason: matchReason,
    drafted: draft !== null
  });
}
