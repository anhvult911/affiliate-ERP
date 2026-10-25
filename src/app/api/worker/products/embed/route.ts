import { z } from "zod";

import { embedText, isGeminiConfigured } from "@/lib/ai/gemini";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { authorizeWorker, workerJson } from "@/lib/worker/auth";

export const dynamic = "force-dynamic";

const embedSchema = z.object({
  /** Backfill a specific set; omit to backfill the oldest missing embeddings. */
  productIds: z.array(z.string().uuid()).max(100).optional(),
  limit: z.number().int().min(1).max(100).optional()
});

/**
 * POST /api/worker/products/embed
 *
 * Backfills `products.embedding` (vector(768)) so the radar can retrieve
 * candidates by cosine similarity. The embedding text is the product name plus
 * its pros/cons — that is what a post is matched against.
 */
export async function POST(request: Request) {
  const auth = authorizeWorker(request);
  if (!auth.ok) return auth.response;

  const parsed = embedSchema.safeParse((await request.json().catch(() => ({}))) ?? {});
  if (!parsed.success) {
    return workerJson({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid body." }, 400);
  }

  if (!isGeminiConfigured()) {
    return workerJson({ ok: false, error: "GEMINI_API_KEY is not configured." }, 503);
  }

  const supabase = createSupabaseAdminClient();
  const limit = parsed.data.limit ?? 20;

  let query = supabase
    .from("products")
    .select("id,name,niche,pros_cons_summary")
    .order("created_at", { ascending: true })
    .limit(limit);

  query = parsed.data.productIds
    ? query.in("id", parsed.data.productIds)
    : query.is("embedding", null);

  const { data: products, error } = await query;
  if (error) return workerJson({ ok: false, error: error.message }, 500);
  if (!products || products.length === 0) return workerJson({ ok: true, embedded: 0, remaining: 0 });

  const embedded: string[] = [];
  const failures: { id: string; error: string }[] = [];

  for (const [index, product] of products.entries()) {
    const text = [product.name, product.niche, product.pros_cons_summary]
      .filter((part): part is string => Boolean(part))
      .join("\n");

    // A burst of embedding calls trips the per-minute quota, and a swallowed 429 is
    // indistinguishable from "nothing to do" on the next run. Pace the batch and
    // retry, then report whatever still failed.
    try {
      const vector = await embedWithRetry(text);
      // PostgREST casts the '[..]' literal straight into vector(768).
      const { error: updateError } = await supabase
        .from("products")
        .update({ embedding: JSON.stringify(vector) })
        .eq("id", product.id);

      if (updateError) failures.push({ id: product.id, error: updateError.message });
      else embedded.push(product.id);
    } catch (error) {
      failures.push({ id: product.id, error: error instanceof Error ? error.message : String(error) });
    }

    if (index < products.length - 1) await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const { count } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .is("embedding", null);

  return workerJson({
    ok: failures.length === 0,
    embedded: embedded.length,
    embeddedIds: embedded,
    failures,
    remaining: count ?? 0
  });
}

/** Transient Gemini failures — worth a retry, unlike a malformed request. */
const RETRYABLE = /429|RESOURCE_EXHAUSTED|503|UNAVAILABLE|overloaded|timeout/i;

async function embedWithRetry(text: string, attempts = 3): Promise<number[]> {
  let lastError: unknown = new Error("Embedding failed.");

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await embedText(text);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);

      if (!RETRYABLE.test(message) || attempt === attempts) break;

      // 1s, 2s — enough for a per-minute quota to free a slot.
      await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** (attempt - 1)));
    }
  }

  throw lastError;
}
