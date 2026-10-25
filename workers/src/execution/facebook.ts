import type { Page } from "playwright";

import type { ClaimedTask } from "../api.js";
import type { Logger } from "../logger.js";
import type { CommentTarget } from "./types.js";

/**
 * Facebook target.
 *
 * Selectors live here and only here, because they are the part that breaks when
 * Facebook ships a redesign. Both English and Vietnamese UI labels are matched —
 * the seeded accounts run a Vietnamese interface.
 *
 * Submit uses Enter rather than the "Post" button: the button's aria-label is
 * ambiguous in the DOM (menu items share it), while Enter is both what a human
 * does and deterministic.
 */
export const FACEBOOK_COMMENT_BOX = [
  'div[role="textbox"][contenteditable="true"][aria-label*="Write a comment" i]',
  'div[role="textbox"][contenteditable="true"][aria-label*="Viết bình luận" i]',
  'div[role="textbox"][contenteditable="true"][aria-label*="comment" i]',
  'div[contenteditable="true"][data-lexical-editor="true"]'
].join(", ");

const COMMENT_BOX_SELECTORS = FACEBOOK_COMMENT_BOX;

const REPLY_BOX_SELECTORS = [
  'div[role="textbox"][contenteditable="true"][aria-label*="Write a reply" i]',
  'div[role="textbox"][contenteditable="true"][aria-label*="Viết trả lời" i]',
  'div[role="textbox"][contenteditable="true"][aria-label*="reply" i]',
  'div[role="textbox"][contenteditable="true"][aria-label*="Trả lời" i]'
].join(", ");

const REPLY_TRIGGERS = [
  'div[role="button"]:has-text("Reply")',
  'div[role="button"]:has-text("Phản hồi")',
  'div[role="button"]:has-text("Trả lời")',
  'span:has-text("Reply")',
  'span:has-text("Phản hồi")'
].join(", ");

const COMPOSER_PLACEHOLDERS = [
  'div[role="button"]:has-text("Write a comment")',
  'div[role="button"]:has-text("Viết bình luận")',
  'div[aria-label*="Write a comment" i]',
  'div[aria-label*="Viết bình luận" i]'
].join(", ");

export const facebookTarget: CommentTarget = {
  name: "facebook",
  commentBox: COMMENT_BOX_SELECTORS,
  replyBox: REPLY_BOX_SELECTORS,
  fileInput: 'input[type="file"][accept*="image" i]',
  submit: "enter",
  replySubmit: "enter",

  async openComposer(page: Page, logger: Logger) {
    if (await anyVisible(page, COMMENT_BOX_SELECTORS)) return;

    const placeholder = page.locator(COMPOSER_PLACEHOLDERS).first();
    if (await placeholder.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await placeholder.click();
      logger.debug("clicked the comment placeholder");
    }
  },

  async openReplyComposer(page: Page, logger: Logger) {
    if (await anyVisible(page, REPLY_BOX_SELECTORS)) return;

    // The reply box appears only after clicking Reply under the comment we just
    // posted, so target the last one (ours is newest).
    const trigger = page.locator(REPLY_TRIGGERS).last();
    if (await trigger.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await trigger.click();
      logger.debug("clicked the reply trigger");
      return;
    }

    logger.warn("no reply trigger found — the affiliate link reply may be skipped");
  },

  resolveUrl(task: ClaimedTask) {
    return task.postUrl;
  }
};

async function anyVisible(page: Page, selector: string): Promise<boolean> {
  return page
    .locator(selector)
    .first()
    .isVisible({ timeout: 3_000 })
    .catch(() => false);
}
