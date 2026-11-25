import type { SupabaseDb } from "@/lib/db";
import type { Tables } from "@/lib/database.types";
import { createLlmClassifier } from "./classifier";
import { LEAD_OWNER_ID } from "./config";
import { createLeadNotifier } from "./notifier";
import { processLeadPost } from "./pipeline";
import { createSupabaseLeadStore } from "./store";

/** Called after worker auth and owner-scoped source lookup. The collector already normalized the URL. */
export async function captureGroupLead(
  db: SupabaseDb, source: Pick<Tables<"target_sources">, "id" | "name" | "keywords_json">,
  postUrl: string, content: string, authorName: string | null
) {
  const keywords = Array.isArray(source.keywords_json)
    ? source.keywords_json.filter((term): term is string => typeof term === "string") : [];
  const result = await processLeadPost({
    owner: LEAD_OWNER_ID,
    source: { id: source.id, name: source.name, keywords },
    post: { postId: postUrl, postUrl, content, authorName }
  }, {
    store: createSupabaseLeadStore(db), classifier: createLlmClassifier(), notifier: createLeadNotifier(LEAD_OWNER_ID)
  });
  // The worker needs the outcome, not a second copy of private drafts or provider errors.
  const outcome = result.outcome === "failed" || (result.outcome === "pending_review" && result.reason === "store_failed")
    ? "storage_error"
    : result.outcome === "skipped" ? result.reason
    : result.outcome === "classified" && result.alertSent ? "alerted" : result.outcome;
  // A metrics failure must not retry an already delivered notification.
  const { error } = await db.rpc("record_lead_capture", { p_source_id: source.id, p_outcome: outcome });
  if (error) console.warn("[leads] capture counter unavailable", { code: error.code });
  return outcome;
}
