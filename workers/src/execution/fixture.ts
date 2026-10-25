import type { ClaimedAccount, ClaimedTask } from "../api.js";
import type { CommentTarget } from "./types.js";

/**
 * Local harness target: a static page that mirrors the parts of a Facebook post
 * the worker touches (a composer, a hidden file input, a submit button, a comment
 * list, and a reply box). It exists so the whole execution path — typing cadence,
 * attachment, submit, DOM verification, evidence screenshot, health detection —
 * can be exercised against a real browser without posting anything in public.
 *
 *   EXECUTOR=fixture FIXTURE_URL=file:///.../workers/fixtures/comment-page.html
 *
 * The fixture also simulates a checkpoint wall when opened with `?checkpoint=1`,
 * which is how the health-reporting path is verified.
 */
export const fixtureTarget: CommentTarget = {
  name: "fixture",
  commentBox: "#comment-box",
  replyBox: "#reply-box",
  fileInput: "#comment-file",
  submit: "#comment-submit",
  replySubmit: "#reply-submit",

  async openComposer() {
    // The fixture renders the main composer up front — nothing to reveal.
  },

  async openReplyComposer(page, logger) {
    // Same shape as Facebook: the reply box only exists after clicking "Phản hồi"
    // under a comment. Newest comments are first in the DOM, so `.first()` is the
    // comment the primary account just posted.
    const trigger = page.locator(".reply-open").first();
    if (await trigger.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await trigger.click();
      logger.debug("clicked the fixture reply trigger");
      return;
    }

    logger.warn("no comment to reply to in the fixture page");
  },

  resolveUrl(task: ClaimedTask, fixtureUrl: string, actingAccount: ClaimedAccount) {
    // Radar comments land on the group post, which the fixture seeds at a stable
    // path; `as=` identifies the acting account, and a task URL containing
    // "checkpoint" makes the fixture render the verification wall instead.
    const separator = fixtureUrl.includes("?") ? "&" : "?";
    const checkpoint = task.postUrl.includes("checkpoint") ? "checkpoint=1&" : "";
    const as = encodeURIComponent(actingAccount.name);
    return `${fixtureUrl}/post/group${separator}${checkpoint}as=${as}`;
  }
};
