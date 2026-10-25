import { z } from "zod";

import { EXECUTION_MODES } from "@/lib/constants";

const uuid = z.string().uuid("Invalid id.");

const httpUrl = z
  .string()
  .trim()
  .url("Enter a full URL.")
  .refine((value) => /^https?:\/\//i.test(value), "Only http(s) URLs are supported.");

const draft = z
  .string()
  .trim()
  .min(1, "The draft comment cannot be empty.")
  .max(2000, "Keep the draft under 2000 characters.");

export const taskIdSchema = z.object({ taskId: uuid });

export const updateDraftSchema = z.object({ taskId: uuid, draft });

export const rejectTaskSchema = z.object({
  taskId: uuid,
  reason: z
    .string()
    .trim()
    .max(500, "Keep the reason under 500 characters.")
    .optional()
    .transform((value) => (value ? value : null))
});

export const approveTaskSchema = z
  .object({
    taskId: uuid,
    accountId: uuid,
    secondaryAccountId: uuid.nullish(),
    executionMode: z.enum(EXECUTION_MODES),
    draft,
    selectedReviewImage: httpUrl.nullish()
  })
  .refine((value) => value.executionMode !== "seeding_2_accounts" || Boolean(value.secondaryAccountId), {
    message: "2-tier seeding needs a second account.",
    path: ["secondaryAccountId"]
  })
  .refine((value) => !value.secondaryAccountId || value.secondaryAccountId !== value.accountId, {
    message: "The second account must be different from the main account.",
    path: ["secondaryAccountId"]
  });

export type ApproveTaskInput = z.input<typeof approveTaskSchema>;
export type RejectTaskInput = z.input<typeof rejectTaskSchema>;
