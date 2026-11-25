/**
 * Sales vocabulary shared by the lead card, the operator forms and the group
 * report. Keep this in lockstep with the enums in
 * supabase/migrations/20261123151000_lead_sales.sql.
 *
 * The three milestones are deliberately explicit:
 *   - `qualified`: the operator judged this lead a real opportunity.
 *   - `two_way_conversation`: the prospect actually replied; a sent DM is not
 *     a conversation.
 *   - `trial_use_confirmed`: the prospect confirmed they used the trial; merely
 *     sending a file/trial is not this stage.
 * A missing row means "not reached". Nothing is inferred from `leads.status`.
 */

export const LEAD_MILESTONE_KINDS = [
  "qualified",
  "two_way_conversation",
  "trial_use_confirmed"
] as const;

export type LeadMilestoneKind = (typeof LEAD_MILESTONE_KINDS)[number];

export const LEAD_MILESTONE_LABEL: Record<LeadMilestoneKind, string> = {
  qualified: "Đủ điều kiện",
  two_way_conversation: "Hội thoại 2 chiều thực tế",
  trial_use_confirmed: "Khách xác nhận đã dùng thử"
};

export const LEAD_MILESTONE_HINT: Record<LeadMilestoneKind, string> = {
  qualified: "Khách đúng nhu cầu, có khả năng mua/thuê.",
  two_way_conversation: "Khách đã trả lời thật, không chỉ mình đã gửi tin.",
  trial_use_confirmed: "Khách nói đã dùng thử — không tính việc chỉ gửi file/trial."
};

export const LEAD_MILESTONE_TONE: Record<
  LeadMilestoneKind,
  "info" | "warning" | "success"
> = {
  qualified: "info",
  two_way_conversation: "warning",
  trial_use_confirmed: "success"
};

export const LEAD_RECEIPT_KINDS = ["template", "setup", "maintenance"] as const;

export type LeadReceiptKind = (typeof LEAD_RECEIPT_KINDS)[number];

export const LEAD_RECEIPT_LABEL: Record<LeadReceiptKind, string> = {
  template: "Template / file",
  setup: "Setup / triển khai",
  maintenance: "Duy trì / bảo trì"
};

export const LEAD_RECEIPT_TONE: Record<
  LeadReceiptKind,
  "info" | "warning" | "success"
> = {
  template: "info",
  setup: "success",
  maintenance: "warning"
};

export function isLeadMilestoneKind(value: unknown): value is LeadMilestoneKind {
  return typeof value === "string" && (LEAD_MILESTONE_KINDS as readonly string[]).includes(value);
}

export function isLeadReceiptKind(value: unknown): value is LeadReceiptKind {
  return typeof value === "string" && (LEAD_RECEIPT_KINDS as readonly string[]).includes(value);
}

export function leadMilestoneLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return (LEAD_MILESTONE_LABEL as Record<string, string | undefined>)[value] ?? value;
}

export function leadReceiptLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return (LEAD_RECEIPT_LABEL as Record<string, string | undefined>)[value] ?? value;
}

/** Funnel window used by `v_lead_group_funnel_14d` and the report copy. */
export const LEAD_FUNNEL_WINDOW_DAYS = 14;
