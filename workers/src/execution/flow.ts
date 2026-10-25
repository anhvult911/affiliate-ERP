
import type { Page } from "playwright";

import { detectAccountHealth } from "../account-health.js";
import { downloadAttachment } from "../attachments.js";
import { captureScreenshot } from "../evidence.js";
import { moveMouseLikeHuman, readingPause, scrollLikeHuman, sleep, typeLikeHuman } from "../humanize.js";
import type { CommentTarget, ExecutionContext, ExecutionOutcome } from "./types.js";

const NAVIGATION_TIMEOUT_MS = 60_000;
const VERIFY_TIMEOUT_MS = 20_000;
const REPLY_ATTEMPTS = 2;

export type FlowPhase = "full" | "reply-only";

/**
 * The execution flow, shared by the real Facebook target and the local fixture
 * target:
 *
 *   open post → read/scroll like a person → comment (no link) → attach a real
 *   buyer photo → verify it published → reply with the Sub_ID affiliate link →
 *   verify the reply → screenshot evidence
 *
 * The link deliberately goes in the reply, not the comment: a bare link in the
 * comment body is what group rules and spam filters look for.
 *
 * `phase: "reply-only"` is what the tier-2 account runs: it opens the post, finds
 * the comment the primary account just left, and answers it with the link.
 */
export async function runCommentFlow(
  target: CommentTarget,
  context: ExecutionContext,
  phase: FlowPhase = "full"
): Promise<ExecutionOutcome> {
  const { task, page, rng, logger, dryRun } = context;
  const notes: string[] = [];
  const comment = (task.comment ?? "").trim();

  if (phase === "full" && comment.length === 0) {
    throw new Error("Task has no approved comment text.");
  }

  const url = target.resolveUrl(task, context.fixtureUrl, context.actingAccount);
  logger.info("opening post", { target: target.name, url });

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });

  await readingPause(rng);
  await scrollLikeHuman(page, rng);
  await moveMouseLikeHuman(page, rng);

  const healthBefore = await detectAccountHealth(page);
  if (healthBefore) {
    logger.warn("account health problem before commenting", { status: healthBefore.status, reason: healthBefore.reason });
    return {
      posted: false,
      commentText: comment,
      replyText: null,
      evidencePath: null,
      health: healthBefore,
      notes
    };
  }

  await target.openComposer(page, logger);

  if (dryRun) {
    // A dry run drives the real browser and the real typing path, then stops
    // before submitting anything to the outside world.
    await typeLikeHuman(page, target.commentBox, comment, rng);
    const typed = await readComposerText(page, target.commentBox);
    notes.push("dry run: comment typed but not submitted");
    logger.info("dry run finished", { typedChars: typed.length });

    return {
      posted: false,
      commentText: comment,
      replyText: null,
      evidencePath: await captureEvidence(context, page, "dry-run"),
      health: null,
      notes
    };
  }

  if (phase === "full") {
    try {
      await typeLikeHuman(page, target.commentBox, comment, rng);

      const attachmentWarning = await attachImage(target, context);
      if (attachmentWarning) notes.push(attachmentWarning);

      await readingPause(rng, 0.6);
      await submitText(page, target.submit, target.commentBox, logger, "comment");

      const published = await verifyPublished(page, comment);
      if (!published) {
        throw new Error(
          "Comment was submitted but never appeared in the DOM — the platform likely rejected it (check the account)."
        );
      }
      logger.info("comment published", { taskId: task.taskId });
    } catch (error) {
      // A wall discovered mid-flow is an account problem, not a task problem:
      // classify it here so the worker can report account health and the operator
      // gets the real reason instead of a Playwright timeout.
      const health = await detectAccountHealth(page);
      if (health) {
        logger.warn("account health problem during commenting", { status: health.status, reason: health.reason });
        return {
          posted: false,
          commentText: comment,
          replyText: null,
          evidencePath: await captureEvidence(context, page, "health"),
          health,
          notes
        };
      }
      throw error;
    }
  }

  const replyText = buildReplyText(task);
  let replyPosted = false;

  /*
   * Who posts the affiliate link reply:
   *   - single mode: the same account, right after its own comment;
   *   - seeding_2_accounts: NOT this run. The tier-2 account answers from its own
   *     profile (phase "reply-only"), which is the whole point of 2-tier seeding —
   *     two personas agreeing in public, not one account talking to itself.
   */
  const shouldPostReply = phase === "reply-only" || task.executionMode === "single";

  if (!shouldPostReply) {
    notes.push("2-tier task: the affiliate link reply is left to the tier-2 account");
  } else if (replyText) {
    for (let attempt = 1; attempt <= REPLY_ATTEMPTS && !replyPosted; attempt += 1) {
      try {
        await readingPause(rng, 0.8);
        await target.openReplyComposer?.(page, logger);
        await target.openComposer(page, logger);
        await typeLikeHuman(page, target.replyBox, replyText, rng);
        await submitText(page, target.replySubmit, target.replyBox, logger, "reply");
        replyPosted = await verifyPublished(page, replyText);

        if (!replyPosted) {
          logger.warn("reply did not appear", { attempt });
        }
      } catch (error) {
        logger.warn("reply attempt failed", { attempt, error: String(error) });
      }
    }

    if (!replyPosted) {
      notes.push(
        phase === "reply-only"
          ? "affiliate link reply failed — the tier-2 account did not answer the comment"
          : "comment published, affiliate link reply failed — fix by hand, do not re-approve this task"
      );
    }
  } else {
    notes.push("no Sub_ID on this task, so no affiliate link reply was posted");
  }

  const evidencePath = await captureEvidence(context, page, phase === "reply-only" ? "reply" : "posted");
  const healthAfter = await detectAccountHealth(page);

  return {
    posted: phase === "reply-only" ? replyPosted : true,
    commentText: comment,
    replyText: replyPosted ? replyText : null,
    evidencePath,
    health: healthAfter,
    notes
  };
}

export async function submitText(
  page: Page,
  strategy: "enter" | string,
  composerSelector: string,
  logger: ExecutionContext["logger"],
  what: string
): Promise<void> {
  if (strategy === "enter") {
    await page.locator(composerSelector).first().press("Enter");
    return;
  }

  const button = page.locator(strategy).first();
  if (!(await button.isVisible({ timeout: 5_000 }).catch(() => false))) {
    logger.warn(`${what} submit button not visible, falling back to Enter`);
    await page.locator(composerSelector).first().press("Enter");
    return;
  }

  await button.click();
}

/**
 * Confirms the text really rendered. Facebook's composer clears on submit even
 * when the comment is dropped server-side, so the DOM is the only proof.
 */
export async function verifyPublished(page: Page, text: string): Promise<boolean> {
  const snippet = normalize(text).slice(0, 48);
  if (snippet.length === 0) return false;

  try {
    await page.getByText(snippet, { exact: false }).first().waitFor({
      state: "visible",
      timeout: VERIFY_TIMEOUT_MS
    });
    return true;
  } catch {
    return false;
  }
}

async function readComposerText(page: Page, selector: string): Promise<string> {
  return page.locator(selector).first().innerText().catch(() => "");
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** The reply carries the tracked affiliate link so the order can be attributed. */
function buildReplyText(task: { product: { trackedAffiliateUrl: string } | null; comment: string | null }): string | null {
  if (!task.product) return null;

  return `Mình để link sản phẩm ở đây cho bạn nào cần nhé: ${task.product.trackedAffiliateUrl}`;
}

/**
 * Attaches the real buyer photo. Returns a warning instead of throwing: a dead
 * marketplace CDN URL must not cost the whole comment opportunity — the operator
 * sees the note and can re-approve with a different photo.
 */
async function attachImage(target: CommentTarget, context: ExecutionContext): Promise<string | null> {
  const { task, page, logger } = context;
  if (!target.fileInput || !task.attachImage) return null;

  try {
    const attachment = await downloadAttachment(task.attachImage);
    try {
      await page.locator(target.fileInput).first().setInputFiles(attachment.path);
      await sleep(1_500);
      logger.debug("attached review image", { path: attachment.path });
      return null;
    } finally {
      await attachment.dispose();
    }
  } catch (error) {
    logger.warn("could not attach the review image", { error: String(error) });
    return `posted without the buyer photo (${String(error)})`;
  }
}

export async function captureEvidence(
  context: ExecutionContext,
  page: Page,
  label: string
): Promise<string | null> {
  return captureScreenshot(
    { evidenceDir: context.evidenceDir, namePrefix: context.task.taskId, logger: context.logger },
    page,
    label
  );
}
