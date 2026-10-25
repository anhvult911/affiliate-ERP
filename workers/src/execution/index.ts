import type { ExecutorName } from "../config.js";
import { facebookTarget } from "./facebook.js";
import { fixtureTarget } from "./fixture.js";
import type { CommentTarget } from "./types.js";

export function resolveTarget(executor: ExecutorName): CommentTarget {
  return executor === "fixture" ? fixtureTarget : facebookTarget;
}

export type { CommentTarget, ExecutionContext, ExecutionOutcome } from "./types.js";
export { runCommentFlow } from "./flow.js";
