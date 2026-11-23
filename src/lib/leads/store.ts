import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";
import type { SupabaseDb } from "@/lib/db";
import type { LeadClassification } from "@/lib/leads/classifier";

/**
 * Persistence for the lead pipeline.
 *
 * The interface is mutation-only: the pipeline only needs to claim a post, save the
 * classification and record a delivered alert. Reads (list, filters, pagination) belong
 * to the dashboard's own query layer, so they cannot accidentally be coupled to the
 * crawler's write path.
 *
 * Claiming is an atomic INSERT against `leads (user_id, post_id)` — the unique
 * constraint, not a read-then-write check, is what makes duplicate and concurrent
 * discovery classify and alert at most once. The raw post is stored with
 * `status = 'pending_review'` before the LLM call, so a provider outage leaves the
 * content recoverable instead of losing the lead.
 */

export type LeadRow = Tables<"leads">;
export type LeadStatus = LeadRow["status"];

export type NewLeadPost = {
  ownerId: string;
  postId: string;
  /** `target_sources.id`, or null when the group is external/not on the watchlist. */
  groupId: string | null;
  groupName: string;
  postUrl: string;
  authorName: string | null;
  content: string;
};

/** `inserted: false` means another scan already claimed this `(owner, post_id)`. */
export type LeadClaimResult = {
  inserted: boolean;
  leadId: string | null;
};

export type LeadSaveClassificationInput = {
  ownerId: string;
  leadId: string;
  classification: LeadClassification;
};

export type LeadMarkAlertInput = {
  ownerId: string;
  leadId: string;
  /** ISO timestamp; only set after the notifier actually delivered. */
  sentAt: string;
};

export interface LeadStore {
  insertPending(input: NewLeadPost): Promise<LeadClaimResult>;
  saveClassification(input: LeadSaveClassificationInput): Promise<void>;
  markAlertSent(input: LeadMarkAlertInput): Promise<void>;
}

/** A database failure the pipeline can log without leaking credentials. */
export class LeadStoreError extends Error {
  readonly code: string | null;

  constructor(message: string, options: { code?: string | null; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "LeadStoreError";
    this.code = options.code ?? null;
  }
}

const DUPLICATE_KEY = "23505";

/**
 * Error code returned by `saveClassification` when the row is no longer
 * `pending_review` — the operator changed its status (ignored, replied, ...) while the
 * LLM was running. The classification is discarded instead of overwriting that
 * decision, and the pipeline reports `status_changed` without alerting.
 */
export const LEAD_STATUS_CHANGED = "lead_status_changed";

export function createSupabaseLeadStore(db: SupabaseDb): LeadStore {
  return {
    async insertPending(input) {
      const payload: TablesInsert<"leads"> = {
        user_id: input.ownerId,
        post_id: input.postId,
        group_id: input.groupId,
        group_name: input.groupName,
        post_url: input.postUrl,
        author_name: input.authorName,
        post_content: input.content,
        status: "pending_review"
      };

      const { data, error } = await db.from("leads").insert(payload).select("id").single();

      if (error) {
        if (error.code === DUPLICATE_KEY) return { inserted: false, leadId: null };
        throw new LeadStoreError("Could not save the pending lead.", {
          code: error.code,
          cause: error
        });
      }

      if (!data?.id) {
        throw new LeadStoreError("The pending lead was saved but its id was not returned.");
      }

      return { inserted: true, leadId: data.id };
    },

    async saveClassification(input) {
      const { classification } = input;
      const patch: TablesUpdate<"leads"> = {
        intent_type: classification.intent_type,
        score: classification.score,
        matched_category: classification.matched_category,
        summary: classification.summary,
        suggested_comment: classification.suggested_comment,
        suggested_dm: classification.suggested_dm,
        status: "new"
      };

      // Owner scoping is redundant under Phase 1 RLS but keeps the write path correct
      // once Phase 2 has more than one tenant. The status predicate is what protects a
      // concurrent operator disposition: only a still-pending row may become `new`.
      const { data, error } = await db
        .from("leads")
        .update(patch)
        .eq("id", input.leadId)
        .eq("user_id", input.ownerId)
        .eq("status", "pending_review")
        .select("id")
        .maybeSingle();

      if (error) {
        throw new LeadStoreError("Could not save the lead classification.", {
          code: error.code,
          cause: error
        });
      }

      if (!data) {
        throw new LeadStoreError(
          "The lead is no longer pending review; the classification was discarded.",
          { code: LEAD_STATUS_CHANGED }
        );
      }
    },

    async markAlertSent(input) {
      const { data, error } = await db
        .from("leads")
        .update({ alert_sent_at: input.sentAt })
        .eq("id", input.leadId)
        .eq("user_id", input.ownerId)
        .select("id")
        .maybeSingle();

      if (error) {
        throw new LeadStoreError("Could not record that the lead alert was sent.", {
          code: error.code,
          cause: error
        });
      }

      if (!data) {
        throw new LeadStoreError("The alerted lead no longer exists for this owner.");
      }
    }
  };
}
