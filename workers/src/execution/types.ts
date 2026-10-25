import type { Page } from "playwright";

import type { ClaimedAccount, ClaimedTask } from "../api.js";
import type { AccountHealthSignal } from "../account-health.js";
import type { Rng } from "../humanize.js";
import type { Logger } from "../logger.js";

export type ExecutionContext = {
  task: ClaimedTask;
  /** The account driving this browser session (primary, or tier-2 on a reply run). */
  actingAccount: ClaimedAccount;
  page: Page;
  rng: Rng;
  logger: Logger;
  dryRun: boolean;
  evidenceDir: string;
  /** Page the fixture executor drives; Facebook targets use the task's post URL. */
  fixtureUrl: string;
};

export type ExecutionOutcome = {
  /** True only when the comment was actually published (dry runs report false). */
  posted: boolean;
  commentText: string;
  replyText: string | null;
  evidencePath: string | null;
  health: AccountHealthSignal | null;
  /** Notes for the operator, e.g. a partial success. */
  notes: string[];
};

/**
 * Everything that differs between the real Facebook flow and the local fixture
 * harness lives here; the execution flow itself is shared.
 */
export type CommentTarget = {
  readonly name: string;
  readonly commentBox: string;
  readonly replyBox: string;
  readonly fileInput: string | null;
  /** "enter" posts by pressing Enter in the composer; otherwise a button selector. */
  readonly submit: "enter" | string;
  readonly replySubmit: "enter" | string;
  /** Reveal the composer when the platform hides it behind a placeholder click. */
  openComposer(page: Page, logger: Logger): Promise<void>;
  /**
   * Reveal the *reply* composer. On Facebook a reply box only exists after
   * clicking "Reply" under the comment, which is a different action from opening
   * the main composer.
   */
  openReplyComposer?(page: Page, logger: Logger): Promise<void>;
  /** Absolute URL for the post this task belongs to. */
  resolveUrl(task: ClaimedTask, fixtureUrl: string, actingAccount: ClaimedAccount): string;
};
