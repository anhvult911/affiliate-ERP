import { DEFAULT_LEAD_KEYWORDS, LEAD_OWNER_ID } from "@/lib/leads/config";
import {
  redactSecrets,
  type LeadClassification,
  type LeadClassifier
} from "@/lib/leads/classifier";
import type { LeadAlertInput, Notifier } from "@/lib/leads/notifier";
import { LEAD_STATUS_CHANGED, LeadStoreError, type LeadStore } from "@/lib/leads/store";

/**
 * The lead pipeline: cheap prefilter -> atomic claim -> LLM classification -> alert.
 *
 * Pure dependency injection (store, classifier, notifier) makes the whole run testable
 * offline and lets the dry-run command swap the store. The production collector calls
 * `processLeadPost` with a `createSupabaseLeadStore(db)` and `createLlmClassifier()`.
 *
 * Failure policy: a provider outage, a database error or a Telegram error must never
 * break the radar loop. The raw post is persisted before the LLM call, so a failure
 * leaves a recoverable `pending_review` row rather than a lost lead.
 */

/** Spec §3.1: ignore empty posts and posts shorter than 15 characters. */
export const MIN_POST_CHARS = 15;

export const MIN_INTENT_SCORE_ENV = "MIN_INTENT_SCORE";
export const DEFAULT_MIN_INTENT_SCORE = 4;

export type LeadSourceInput = {
  /** `target_sources.id`; null when the group is external. */
  id: string | null;
  name: string;
  url?: string | null;
  /**
   * `target_sources.keywords_json`. Omitted/null falls back to the product preset;
   * an explicit empty array disables lead capture for that group.
   */
  keywords?: readonly string[] | null;
};

export type LeadPostInput = {
  postId: string;
  postUrl: string;
  content: string;
  authorName?: string | null;
};

export type ProcessLeadPostInput = {
  owner: string;
  source: LeadSourceInput;
  post: LeadPostInput;
};

export type LeadPipelineDeps = {
  store: LeadStore;
  classifier: LeadClassifier;
  /** Omit to classify and persist without alerting (e.g. a capture-only dry run). */
  notifier?: Notifier | null;
  now?: () => Date;
  /** Overrides `MIN_INTENT_SCORE`; defaults to 4. */
  minIntentScore?: number;
  env?: Record<string, string | undefined>;
};

export type LeadSkipReason = "empty" | "too_short" | "no_keyword" | "duplicate" | "status_changed";
export type LeadPendingReason = "llm_failed" | "store_failed";

export type LeadProcessResult =
  | { outcome: "skipped"; reason: LeadSkipReason; leadId: string | null }
  | { outcome: "pending_review"; reason: LeadPendingReason; leadId: string }
  | { outcome: "failed"; reason: "store"; leadId: null }
  | {
      outcome: "classified";
      leadId: string;
      classification: LeadClassification;
      alertSent: boolean;
    };

/**
 * Lowercase, strip Vietnamese diacritics and punctuation, collapse whitespace.
 *
 * Keyword matching must survive the many ways a poster writes "tính lãi lỗ"
 * (case, missing accents, extra emoji), so both sides are normalised the same way.
 */
export function normalizeLeadText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function matchesLeadKeywords(content: string, keywords: readonly string[]): boolean {
  const haystack = normalizeLeadText(content);
  if (!haystack) return false;

  return keywords.some((keyword) => {
    const needle = normalizeLeadText(keyword);
    return needle.length > 0 && haystack.includes(needle);
  });
}

export function readMinIntentScore(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = Number(env[MIN_INTENT_SCORE_ENV]?.trim());
  if (!Number.isFinite(raw)) return DEFAULT_MIN_INTENT_SCORE;
  return Math.min(5, Math.max(1, Math.floor(raw)));
}

/** Spec §3.2: only a qualifying buyer/help post, at or above the threshold, alerts. */
export function shouldAlert(classification: LeadClassification, minIntentScore: number): boolean {
  return (
    classification.score >= minIntentScore &&
    (classification.intent_type === "buyer_inquiry" ||
      classification.intent_type === "help_needed")
  );
}

/** Exactly the notifier's contract — no extra fields, no camelCase surprises. */
export function buildAlertInput(
  classification: LeadClassification,
  source: LeadSourceInput,
  post: LeadPostInput
): LeadAlertInput {
  return {
    score: classification.score,
    matched_category: classification.matched_category,
    group_name: source.name,
    post_url: post.postUrl,
    summary: classification.summary,
    suggested_comment: classification.suggested_comment,
    suggested_dm: classification.suggested_dm
  };
}

function describeFailure(
  error: unknown,
  env: Record<string, string | undefined>
): string {
  if (!(error instanceof Error)) return "unknown error";

  // Alert/store messages can carry a bot token in a URL; never let one reach the log.
  return redactSecrets(error.message, [
    env.LLM_API_KEY,
    env.TELEGRAM_BOT_TOKEN,
    env.TELEGRAM_WEBHOOK_SECRET
  ]);
}

export async function processLeadPost(
  input: ProcessLeadPostInput,
  deps: LeadPipelineDeps
): Promise<LeadProcessResult> {
  const env = deps.env ?? process.env;
  const ownerId = input.owner.trim() || LEAD_OWNER_ID;
  const content = input.post.content ?? "";
  const trimmed = content.trim();

  if (trimmed.length === 0) return { outcome: "skipped", reason: "empty", leadId: null };
  if (trimmed.length < MIN_POST_CHARS) {
    return { outcome: "skipped", reason: "too_short", leadId: null };
  }

  // An explicitly empty array disables capture for this group; only a missing value
  // falls back to the product preset.
  const configured = input.source.keywords;
  const keywords =
    configured == null
      ? DEFAULT_LEAD_KEYWORDS
      : configured.map((keyword) => keyword.trim()).filter(Boolean);

  if (!matchesLeadKeywords(trimmed, keywords)) {
    return { outcome: "skipped", reason: "no_keyword", leadId: null };
  }

  let claim;
  try {
    claim = await deps.store.insertPending({
      ownerId,
      postId: input.post.postId,
      groupId: input.source.id ?? null,
      groupName: input.source.name,
      postUrl: input.post.postUrl,
      authorName: input.post.authorName ?? null,
      content: trimmed
    });
  } catch (error) {
    console.error(`[leads] could not save post ${input.post.postId}: ${describeFailure(error, env)}`);
    return { outcome: "failed", reason: "store", leadId: null };
  }

  if (!claim.inserted) {
    return { outcome: "skipped", reason: "duplicate", leadId: claim.leadId };
  }

  if (!claim.leadId) {
    console.error(`[leads] post ${input.post.postId} was claimed but no lead id was returned.`);
    return { outcome: "failed", reason: "store", leadId: null };
  }

  const leadId = claim.leadId;

  let classification: LeadClassification;
  try {
    classification = await deps.classifier({
      content: trimmed,
      groupName: input.source.name,
      keywords
    });
  } catch (error) {
    console.error(
      `[leads] classification failed for post ${input.post.postId}: ${describeFailure(error, env)}`
    );
    // The raw row already exists as pending_review; the operator can retry it later.
    return { outcome: "pending_review", reason: "llm_failed", leadId };
  }

  try {
    await deps.store.saveClassification({ ownerId, leadId, classification });
  } catch (error) {
    // The operator changed the status while the LLM was running. Their decision wins;
    // the classification is discarded and no alert is sent.
    if (error instanceof LeadStoreError && error.code === LEAD_STATUS_CHANGED) {
      return { outcome: "skipped", reason: "status_changed", leadId };
    }

    console.error(
      `[leads] could not save the classification for post ${input.post.postId}: ${describeFailure(error, env)}`
    );
    return { outcome: "pending_review", reason: "store_failed", leadId };
  }

  const minScore = deps.minIntentScore ?? readMinIntentScore(env);
  let alertSent = false;

  if (deps.notifier && shouldAlert(classification, minScore)) {
    const alertInput = buildAlertInput(classification, input.source, input.post);

    try {
      await deps.notifier.sendAlert(alertInput);
      alertSent = true;

      // Timestamp only after a real delivery, so a failed Telegram call leaves the lead
      // visible for a manual retry instead of pretending it was alerted.
      try {
        await deps.store.markAlertSent({
          ownerId,
          leadId,
          sentAt: (deps.now?.() ?? new Date()).toISOString()
        });
      } catch (error) {
        console.error(
          `[leads] alert was delivered but not timestamped for post ${input.post.postId}: ${describeFailure(error, env)}`
        );
      }
    } catch (error) {
      console.error(
        `[leads] alert delivery failed for post ${input.post.postId}: ${describeFailure(error, env)}`
      );
    }
  }

  return { outcome: "classified", leadId, classification, alertSent };
}
