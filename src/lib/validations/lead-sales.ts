import { z } from "zod";

import { LEAD_MILESTONE_KINDS, LEAD_RECEIPT_KINDS } from "@/lib/leads/sales";

/** Guardrail so a mistyped amount cannot overflow the bigint column. */
const MAX_VND = 10_000_000_000;

const optionalNote = z.preprocess(
  (value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === "string" && value.trim() === "") return null;
    return value;
  },
  z.string().trim().max(500, "Ghi chú tối đa 500 ký tự.").nullable().optional()
);

const isoDateTime = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Thời điểm không hợp lệ.")
  .transform((value) => new Date(value).toISOString());

const amountVnd = z.preprocess(
  (value) => {
    if (typeof value === "string") {
      // Accept "1.500.000" but reject "-100" instead of silently flipping it.
      const normalized = value.replace(/[.,\s]/g, "");
      return /^\d+$/.test(normalized) ? Number(normalized) : Number.NaN;
    }
    return value;
  },
  z
    .number({ invalid_type_error: "Số tiền không hợp lệ." })
    .int("Số tiền phải là số nguyên VND.")
    .positive("Số tiền phải lớn hơn 0.")
    .max(MAX_VND, "Số tiền vượt giới hạn cho phép.")
);

export const leadMilestoneSchema = z.object({
  leadId: z.string().uuid("Lead không hợp lệ."),
  kind: z.enum(LEAD_MILESTONE_KINDS, {
    errorMap: () => ({ message: "Mốc chốt không hợp lệ." })
  }),
  occurredAt: isoDateTime,
  note: optionalNote
});

export const clearLeadMilestoneSchema = z.object({
  leadId: z.string().uuid("Lead không hợp lệ."),
  kind: z.enum(LEAD_MILESTONE_KINDS, {
    errorMap: () => ({ message: "Mốc chốt không hợp lệ." })
  })
});

export const leadReceiptSchema = z.object({
  leadId: z.string().uuid("Lead không hợp lệ."),
  kind: z.enum(LEAD_RECEIPT_KINDS, {
    errorMap: () => ({ message: "Loại khoản thu không hợp lệ." })
  }),
  amountVnd,
  paidAt: isoDateTime,
  note: optionalNote,
  idempotencyKey: z
    .string()
    .trim()
    .min(8, "Mã chống trùng không hợp lệ.")
    .max(120, "Mã chống trùng quá dài.")
});

export const deleteLeadReceiptSchema = z.object({
  id: z.string().uuid("Khoản thu không hợp lệ.")
});

export const leadRecurringRateSchema = z.object({
  leadId: z.string().uuid("Lead không hợp lệ."),
  monthlyVnd: z.preprocess(
    (value) => {
      if (value === null || value === undefined) return null;
      if (typeof value === "string" && value.trim() === "") return null;
      return value;
    },
    amountVnd.nullable()
  ),
  startedOn: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày bắt đầu không hợp lệ.")
    .optional(),
  note: optionalNote
});

export type LeadMilestoneInput = z.infer<typeof leadMilestoneSchema>;
export type LeadReceiptInput = z.infer<typeof leadReceiptSchema>;
export type LeadRecurringRateInput = z.infer<typeof leadRecurringRateSchema>;
