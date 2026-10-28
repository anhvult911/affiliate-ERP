import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildTrackedAffiliateUrl } from "@/lib/worker/affiliate";
import { ShopeeClient } from "@/lib/shopee/client";
import { isShopeeConfigured, readShopeeConfig } from "@/lib/shopee/config";
import { generateShortLink, originUrlFor, preferShortLink } from "@/lib/shopee/short-link";
import { authorizeWorker, workerJson } from "@/lib/worker/auth";
import { asStringArray } from "@/lib/json";

export const dynamic = "force-dynamic";

/** One mutation per claimed task is already 5 calls; a bigger batch keeps the query-string link. */
const SHORT_LINK_MAX_PER_CLAIM = 5;

const claimSchema = z.object({
  worker: z.string().trim().min(1, "Identify the worker.").max(64),
  limit: z.number().int().min(1).max(25).optional()
});

/**
 * POST /api/worker/tasks/claim
 *
 * The browser worker calls this in a loop. `claim_comment_tasks` moves queued
 * rows to `running` with FOR UPDATE SKIP LOCKED, so a task can only ever be
 * handed to one worker. Everything the worker needs to execute is in the
 * response: the account (antidetect profile + proxy), the product and its review
 * photo, and the tracked affiliate link.
 */
export async function POST(request: Request) {
  const auth = authorizeWorker(request);
  if (!auth.ok) return auth.response;

  const parsed = claimSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return workerJson({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid body." }, 400);
  }

  const supabase = createSupabaseAdminClient();

  const { data: claimed, error } = await supabase.rpc("claim_comment_tasks", {
    p_worker: parsed.data.worker,
    p_limit: parsed.data.limit ?? 5
  });

  if (error) return workerJson({ ok: false, error: error.message }, 500);
  if (!claimed || claimed.length === 0) return workerJson({ ok: true, tasks: [] });

  const accountIds = [
    ...new Set(
      claimed
        .flatMap((task) => [task.assigned_account_id, task.secondary_account_id])
        .filter((id): id is string => Boolean(id))
    )
  ];
  const productIds = [
    ...new Set(claimed.map((task) => task.matched_product_id).filter((id): id is string => Boolean(id)))
  ];

  const [{ data: accounts, error: accountsError }, { data: products, error: productsError }] =
    await Promise.all([
      accountIds.length > 0
        ? supabase
            .from("social_accounts")
            .select("id,name,persona_type,browser_profile_id,proxy_ip,status,trust_score,bio_link_url")
            .in("id", accountIds)
        : Promise.resolve({ data: [], error: null }),
      productIds.length > 0
        ? supabase
            .from("products")
            .select("id,name,price,commission_rate,affiliate_short_link,origin_link,review_images,pros_cons_summary")
            .in("id", productIds)
        : Promise.resolve({ data: [], error: null })
    ]);

  if (accountsError || productsError) {
    return workerJson({ ok: false, error: (accountsError ?? productsError)?.message ?? "Lookup failed." }, 500);
  }

  // Shopee, when configured, mints a short link with the Sub_ID baked in — docs §4.2 says
  // the query-string append is unverified for API-produced links. Best-effort and capped:
  // a failed call (no credential, 10030, malformed response) keeps the existing tracked
  // URL, and every task beyond the cap does too, so a slow API never stalls a claim.
  const shortLinks = new Map<string, string>();

  if (isShopeeConfigured()) {
    const candidates = claimed.slice(0, SHORT_LINK_MAX_PER_CLAIM).filter((task) => {
      const product = products?.find((row) => row.id === task.matched_product_id);
      return Boolean(product && task.sub_id_code && originUrlFor(product));
    });

    const client = new ShopeeClient(readShopeeConfig());
    const generated = await Promise.allSettled(
      candidates.map(async (task) => {
        const product = products!.find((row) => row.id === task.matched_product_id)!;
        const link = await generateShortLink(client, {
          originUrl: originUrlFor(product)!,
          subId: task.sub_id_code!
        });
        return { taskId: task.id, link };
      })
    );

    for (const outcome of generated) {
      if (outcome.status === "fulfilled" && outcome.value.link) {
        shortLinks.set(outcome.value.taskId, outcome.value.link);
      }
    }
  }

  const tasks = claimed.map((task) => {
    const account = accounts?.find((row) => row.id === task.assigned_account_id) ?? null;
    const secondary = accounts?.find((row) => row.id === task.secondary_account_id) ?? null;
    const product = products?.find((row) => row.id === task.matched_product_id) ?? null;

    return {
      taskId: task.id,
      executionMode: task.execution_mode,
      subIdCode: task.sub_id_code,
      postUrl: task.post_url,
      postContent: task.post_content,
      postImages: asStringArray(task.post_images),
      comment: task.ai_draft_comment,
      attachImage: task.selected_review_image,
      attempt: task.attempt_count,
      claimWorker: task.claimed_by,
      account,
      secondaryAccount: secondary,
      product: product
        ? {
            ...product,
            reviewImages: asStringArray(product.review_images),
            trackedAffiliateUrl: preferShortLink(
              buildTrackedAffiliateUrl(product.affiliate_short_link, task.sub_id_code),
              shortLinks.get(task.id) ?? null
            )
          }
        : null
    };
  });

  return workerJson({ ok: true, tasks });
}
