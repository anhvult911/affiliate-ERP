import type { Page } from "playwright";

import { detectAccountHealth, type AccountHealthSignal } from "../account-health.js";
import type { WarmingSlot } from "../api.js";
import { captureScreenshot } from "../evidence.js";
import { moveMouseLikeHuman, readingPause, scrollLikeHuman, typeLikeHuman, type Rng } from "../humanize.js";
import type { Logger } from "../logger.js";
import { submitText, verifyPublished } from "./flow.js";
import { FACEBOOK_COMMENT_BOX } from "./facebook.js";

/**
 * Persona warming: the part that makes an account look alive before it is asked
 * to sell anything.
 *
 *   lifestyle_post → publish an ordinary post on the account's own timeline and
 *                    record its permalink, so another account can warm it
 *   cross_warm     → comment on another account's recent post
 *
 * Neither carries a link. That is the point: the affiliate link only appears in
 * the execution flow, on posts the radar matched.
 */

export type WarmingContext = {
  slot: WarmingSlot;
  page: Page;
  rng: Rng;
  logger: Logger;
  dryRun: boolean;
  evidenceDir: string;
  fixtureUrl: string;
};

export type WarmingOutcome = {
  posted: boolean;
  content: string;
  /** Lifestyle posts only: where the post landed. */
  postUrl: string | null;
  evidencePath: string | null;
  health: AccountHealthSignal | null;
  notes: string[];
  /** profile_setup only: which assets were actually applied. */
  avatarSet?: boolean;
  coverSet?: boolean;
  bioSet?: boolean;
};

type WarmingTarget = {
  readonly name: string;
  readonly composer: string;
  readonly submit: "enter" | string;
  /** Selector for the permalink of what was just published. */
  readonly permalink: string | null;
  resolveUrl(slot: WarmingSlot, fixtureUrl: string): string;
  openComposer(page: Page, logger: Logger): Promise<void>;
};

const FACEBOOK_TIMELINE_COMPOSER = [
  'div[role="button"]:has-text("Bạn đang nghĩ gì")',
  'div[role="button"]:has-text("What\'s on your mind")',
  'div[aria-label*="Bạn đang nghĩ gì" i]',
  'div[aria-label*="What\'s on your mind" i]'
].join(", ");

const FACEBOOK_TIMELINE_BOX = [
  'div[role="dialog"] div[role="textbox"][contenteditable="true"]',
  'div[role="dialog"] div[contenteditable="true"][data-lexical-editor="true"]'
].join(", ");

const FACEBOOK_TIMELINE_SUBMIT = [
  'div[role="dialog"] div[role="button"][aria-label*="Đăng" i]',
  'div[role="dialog"] div[role="button"][aria-label*="Post" i]'
].join(", ");

/** The post we just published is the newest story in the feed. */
const FACEBOOK_PERMALINK = [
  'a[href*="/posts/"]',
  'a[href*="story_fbid"]',
  'a[href*="/permalink/"]'
].join(", ");

export const facebookWarmingTarget: WarmingTarget = {
  name: "facebook",
  composer: FACEBOOK_TIMELINE_BOX,
  submit: FACEBOOK_TIMELINE_SUBMIT,
  permalink: FACEBOOK_PERMALINK,

  resolveUrl(slot) {
    return slot.kind === "cross_warm" && slot.targetPostUrl
      ? slot.targetPostUrl
      : "https://www.facebook.com/me";
  },

  async openComposer(page, logger) {
    if (await page.locator(FACEBOOK_TIMELINE_BOX).first().isVisible({ timeout: 3_000 }).catch(() => false)) return;

    const trigger = page.locator(FACEBOOK_TIMELINE_COMPOSER).first();
    if (await trigger.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await trigger.click();
      logger.debug("opened the timeline composer");
    }
  }
};

export const fixtureWarmingTarget: WarmingTarget = {
  name: "fixture",
  composer: "#post-box",
  submit: "#post-submit",
  permalink: 'a[href^="/post/"]',

  resolveUrl(slot, fixtureUrl) {
    const separator = fixtureUrl.includes("?") ? "&" : "?";
    const as = encodeURIComponent(slot.accountName);
    return slot.kind === "cross_warm" && slot.targetPostUrl
      ? `${slot.targetPostUrl}${slot.targetPostUrl.includes("?") ? "&" : "?"}as=${as}`
      : `${fixtureUrl}/timeline${separator}as=${as}`;
  },

  async openComposer() {
    // The fixture renders the composer up front.
  }
};

/** Cross-warm comments on the fixture live on the post page, same box as a comment. */
export const fixtureCrossWarmTarget: WarmingTarget = {
  ...fixtureWarmingTarget,
  composer: "#comment-box",
  submit: "#comment-submit",
  permalink: null
};

export const facebookCrossWarmTarget: WarmingTarget = {
  ...facebookWarmingTarget,
  composer: FACEBOOK_COMMENT_BOX,
  submit: "enter",
  permalink: null
};

export function resolveWarmingTarget(executor: "facebook" | "fixture", kind: WarmingSlot["kind"]): WarmingTarget {
  if (executor === "fixture") {
    return kind === "cross_warm" ? fixtureCrossWarmTarget : fixtureWarmingTarget;
  }

  return kind === "cross_warm" ? facebookCrossWarmTarget : facebookWarmingTarget;
}

export async function runWarmingSlot(target: WarmingTarget, context: WarmingContext): Promise<WarmingOutcome> {
  const { slot, page, rng, logger, dryRun } = context;
  const notes: string[] = [];
  const url = target.resolveUrl(slot, context.fixtureUrl);

  logger.info("warming slot starting", { kind: slot.kind, scheduledAt: slot.scheduledAt, url });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });

  await readingPause(rng);
  await scrollLikeHuman(page, rng);
  await moveMouseLikeHuman(page, rng);

  const healthBefore = await detectAccountHealth(page);
  if (healthBefore) {
    logger.warn("account health problem before warming", { status: healthBefore.status, reason: healthBefore.reason });
    return { posted: false, content: slot.content, postUrl: null, evidencePath: null, health: healthBefore, notes };
  }

  await target.openComposer(page, logger);

  if (dryRun) {
    await typeLikeHuman(page, target.composer, slot.content, rng);
    notes.push("dry run: warming content typed but not submitted");
    return {
      posted: false,
      content: slot.content,
      postUrl: null,
      evidencePath: await evidence(context, page, "dry-run"),
      health: null,
      notes
    };
  }

  try {
    await typeLikeHuman(page, target.composer, slot.content, rng);
    await readingPause(rng, 0.6);
    await submitText(page, target.submit, target.composer, logger, slot.kind === "cross_warm" ? "warm comment" : "post");

    const published = await verifyPublished(page, slot.content);
    if (!published) {
      throw new Error("Warming content was submitted but never appeared in the DOM.");
    }

    const postUrl = target.permalink ? await readPermalink(page, url) : null;
    if (target.permalink && !postUrl) {
      // Without the permalink nobody can warm this post later, so say so instead
      // of recording a run that looks complete.
      notes.push("permalink could not be read — this post will not be warmable by other accounts");
    }

    const evidencePath = await evidence(context, page, slot.kind === "cross_warm" ? "warm" : "post");
    const health = await detectAccountHealth(page);

    return { posted: true, content: slot.content, postUrl, evidencePath, health, notes };
  } catch (error) {
    const health = await detectAccountHealth(page);
    if (health) {
      logger.warn("account health problem during warming", { status: health.status, reason: health.reason });
      return { posted: false, content: slot.content, postUrl: null, evidencePath: await evidence(context, page, "health"), health, notes };
    }
    throw error;
  }
}

async function readPermalink(page: Page, baseUrl: string): Promise<string | null> {
  const link = page.locator('a[href*="/posts/"], a[href*="story_fbid"], a[href*="/permalink/"], a[href^="/post/"]').first();
  const href = await link.getAttribute("href", { timeout: 10_000 }).catch(() => null);
  if (!href) return null;

  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function evidence(context: WarmingContext, page: Page, label: string): Promise<string | null> {
  return captureScreenshot(
    { evidenceDir: context.evidenceDir, namePrefix: `warm-${context.slot.accountId}`, logger: context.logger },
    page,
    label
  );
}
