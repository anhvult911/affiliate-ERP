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

/**
 * A manual-publication record is audit evidence, so an arbitrary URL cannot stand in
 * for the Facebook post the operator actually made. Facebook share/mobile hosts are
 * accepted; the action separately refuses the original post URL itself.
 */
const facebookPermalink = httpUrl.refine((value) => {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return (
      host === "facebook.com" ||
      host.endsWith(".facebook.com") ||
      host === "fb.com" ||
      host.endsWith(".fb.com") ||
      host === "fb.me" ||
      host.endsWith(".fb.me") ||
      host === "fb.watch" ||
      host.endsWith(".fb.watch")
    );
  } catch {
    return false;
  }
}, "Permalink phải là link Facebook (facebook.com, fb.com, fb.me hoặc fb.watch) của bình luận đã đăng.");

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

export const manualPublicationSchema = z.object({
  taskId: uuid,
  /** The real permalink the operator copied from the post they published by hand. */
  permalink: facebookPermalink,
  /**
   * Operator-supplied publication time in ISO form. The client converts its
   * datetime-local input before calling; anything unparsable is rejected here and
   * the future bound is enforced in the action, where the server clock decides.
   */
  publishedAt: z
    .string()
    .trim()
    .min(1, "Publication time is required.")
    .refine((value) => !Number.isNaN(new Date(value).getTime()), "Invalid publication time.")
});

export type ApproveTaskInput = z.input<typeof approveTaskSchema>;
export type RejectTaskInput = z.input<typeof rejectTaskSchema>;
export type ManualPublicationInput = z.input<typeof manualPublicationSchema>;
