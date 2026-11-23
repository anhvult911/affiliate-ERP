import { z } from "zod";

import { LEAD_STATUSES } from "@/lib/leads/status";

/**
 * `undefined` = leave the column alone, `null` = explicitly clear it. The
 * distinction matters for the manually overridden follow-up timestamp: an
 * absent field lets the workflow rule choose +48h / null, while an explicit
 * value always wins.
 */
const optionalNullableText = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
}, z.string().trim().max(4000, "Ghi chú tối đa 4.000 ký tự.").nullable().optional());

const optionalNullableDateTime = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
}, z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Thời gian nhắc lại không hợp lệ.")
  .transform((value) => new Date(value).toISOString())
  .nullable()
  .optional());

export const leadUpdateSchema = z
  .object({
    id: z.string().uuid("Lead không hợp lệ."),
    status: z.enum(LEAD_STATUSES, {
      errorMap: () => ({ message: "Trạng thái lead không hợp lệ." })
    }).optional(),
    notes: optionalNullableText,
    next_followup_at: optionalNullableDateTime
  })
  .superRefine((value, context) => {
    if (
      value.status === undefined &&
      value.notes === undefined &&
      value.next_followup_at === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["id"],
        message: "Không có thay đổi nào để lưu."
      });
    }
  });

export type LeadUpdateInput = z.infer<typeof leadUpdateSchema>;
