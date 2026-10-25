import { z } from "zod";

/** Body of POST /api/ai/draft — the operator drafts one pending task at a time. */
export const aiDraftRequestSchema = z.object({
  taskId: z
    .string({ required_error: "Select a task to draft." })
    .trim()
    .uuid("Select a valid task."),
  guidance: z.string().trim().max(300).optional()
});

export type AiDraftRequest = z.infer<typeof aiDraftRequestSchema>;

/** Server action input for persisting an operator-edited draft. */
export const saveDraftSchema = z.object({
  taskId: z
    .string({ required_error: "Select a task to save." })
    .trim()
    .uuid("Select a valid task."),
  draft: z
    .string({ required_error: "Draft cannot be empty." })
    .trim()
    .min(1, "Draft cannot be empty.")
    .max(4000, "Draft is longer than the 4000 character limit.")
});

export type SaveDraftInput = z.infer<typeof saveDraftSchema>;
