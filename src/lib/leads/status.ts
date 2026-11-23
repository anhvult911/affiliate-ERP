/**
 * Lead CRM vocabulary shared by the list, the filters and the update action.
 *
 * `pending_review` is the pipeline's holding state while only the raw post has
 * been persisted (LLM failure or classification still running); the pipeline
 * moves a successfully classified lead to `new`.
 */
export const LEAD_STATUSES = [
  "pending_review",
  "new",
  "replied",
  "sent_freebie",
  "bought_template",
  "upsold_automation",
  "ignored"
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Statuses that put a lead back on the 48h follow-up clock. */
export const LEAD_FOLLOWUP_STATUSES: readonly LeadStatus[] = ["replied", "sent_freebie"];

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  pending_review: "Chờ phân loại",
  new: "Lead mới",
  replied: "Đã trả lời",
  sent_freebie: "Đã gửi template",
  bought_template: "Đã mua template",
  upsold_automation: "Đã upsell automation",
  ignored: "Bỏ qua"
};

export const LEAD_STATUS_TONE: Record<
  LeadStatus,
  "success" | "warning" | "destructive" | "info" | "muted"
> = {
  pending_review: "warning",
  new: "info",
  replied: "info",
  sent_freebie: "success",
  bought_template: "success",
  upsold_automation: "success",
  ignored: "muted"
};

export const LEAD_INTENT_TYPES = [
  "buyer_inquiry",
  "help_needed",
  "seller_promo",
  "irrelevant"
] as const;

export type LeadIntentType = (typeof LEAD_INTENT_TYPES)[number];

export const LEAD_INTENT_LABEL: Record<LeadIntentType, string> = {
  buyer_inquiry: "Cần mua / thuê",
  help_needed: "Cần được giúp",
  seller_promo: "Tự quảng cáo",
  irrelevant: "Không liên quan"
};

export const LEAD_CATEGORIES = ["sheets_excel", "automation", "other"] as const;

export type LeadCategory = (typeof LEAD_CATEGORIES)[number];

export const LEAD_CATEGORY_LABEL: Record<LeadCategory, string> = {
  sheets_excel: "Excel / Google Sheets",
  automation: "Automation / Tool",
  other: "Khác"
};

export function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === "string" && (LEAD_STATUSES as readonly string[]).includes(value);
}

export function leadStatusLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return isLeadStatus(value) ? LEAD_STATUS_LABEL[value] : value;
}

export function leadIntentLabel(value: string | null | undefined): string {
  if (!value) return "Chưa phân loại";
  return (LEAD_INTENT_LABEL as Record<string, string | undefined>)[value] ?? value;
}

export function leadCategoryLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return (LEAD_CATEGORY_LABEL as Record<string, string | undefined>)[value] ?? value;
}

/** "4/5" score badge text; raw rows that were never classified show "—". */
export function leadScoreLabel(value: number | null | undefined): string {
  return typeof value === "number" ? `${value}/5` : "—";
}
