import { draftDealPost, isGeminiConfigured } from "@/lib/ai/gemini";
import { trimForTelegram, type DealProduct } from "@/lib/deals/copy";

/**
 * Best-effort AI caption for a deal post (P5-1).
 *
 * Returns null instead of throwing on every failure path: the channel must keep working
 * when Gemini is unconfigured, rate-limited or down — `resolveDealCaption` then falls back
 * to the static template, which is built only from the product row.
 */
export async function generateDealCaption(
  product: DealProduct & { niche?: string | null }
): Promise<string | null> {
  if (!isGeminiConfigured()) return null;

  const link = product.affiliate_short_link?.trim() ?? "";
  if (!link) return null;

  try {
    const price =
      typeof product.price === "number"
        ? product.price
        : Number.parseFloat(String(product.price ?? ""));

    const text = await draftDealPost({
      name: product.name,
      price: Number.isFinite(price) ? price : null,
      link,
      niche: product.niche ?? null
    });

    const trimmed = trimForTelegram(text);
    return trimmed.length > 0 ? trimmed : null;
  } catch (error) {
    console.warn(
      "[deals] Gemini caption failed, falling back to the template:",
      error instanceof Error ? error.message : error
    );
    return null;
  }
}
