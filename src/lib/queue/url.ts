import type { TaskStatus } from "@/lib/constants";

/**
 * The approval queue's entire navigation state lives in the URL so the mobile
 * back gesture, refresh and sharing all behave. One builder, used by the server
 * list and the client filter rail, so the two cannot diverge.
 */
export type QueueUrlState = {
  status: TaskStatus;
  sourceId?: string | null;
  limit?: number;
  taskId?: string | null;
};

export function buildQueueHref({ status, sourceId, limit, taskId }: QueueUrlState) {
  const params = new URLSearchParams({ status });
  if (sourceId) params.set("source", sourceId);
  if (limit) params.set("limit", String(limit));
  if (taskId) params.set("task", taskId);

  return `/queue?${params.toString()}`;
}

export const QUEUE_LIMIT_OPTIONS = [25, 50, 100] as const;
export type QueueLimit = (typeof QUEUE_LIMIT_OPTIONS)[number];
export const QUEUE_LIMIT_MAX: QueueLimit = 100;

export function parseQueueLimit(raw: string | undefined): QueueLimit {
  const parsed = Number(raw);
  return QUEUE_LIMIT_OPTIONS.find((option) => option === parsed) ?? QUEUE_LIMIT_OPTIONS[0];
}

/** "Show more" doubles the page, capped at QUEUE_LIMIT_MAX so the link never falls back to 25. */
export function nextQueueLimit(current: QueueLimit): QueueLimit {
  return current * 2 >= QUEUE_LIMIT_MAX ? QUEUE_LIMIT_MAX : ((current * 2) as QueueLimit);
}
