import { readdir } from "node:fs/promises";
import { extname, resolve } from "node:path";

import type { Page } from "playwright";

import { detectAccountHealth, type AccountHealthSignal } from "../account-health.js";
import type { WarmingSlot } from "../api.js";
import { captureScreenshot } from "../evidence.js";
import { moveMouseLikeHuman, readingPause, scrollLikeHuman, type Rng } from "../humanize.js";
import type { Logger } from "../logger.js";

/**
 * Dressing a profile so a human who clicks it sees a person, not an empty shell.
 *
 * Three things matter in the first two seconds of a profile visit: the avatar, the
 * cover and the intro line. Warming posts alone leave all three blank — which is
 * exactly what a farm looks like.
 *
 * Assets come from the operator's own folder, one directory per persona:
 *
 *   assets/<persona>/avatar.jpg
 *   assets/<persona>/cover.jpg
 *
 * They are never generated: a synthetic face is worse than no face, because it is
 * both obviously fake and impossible to defend if Facebook asks.
 */

export type ProfileSetupContext = {
  slot: WarmingSlot;
  page: Page;
  rng: Rng;
  logger: Logger;
  dryRun: boolean;
  evidenceDir: string;
  fixtureUrl: string;
  assetsDir: string;
};

export type ProfileSetupOutcome = {
  posted: boolean;
  content: string;
  postUrl: null;
  evidencePath: string | null;
  health: AccountHealthSignal | null;
  notes: string[];
  avatarSet: boolean;
  coverSet: boolean;
  bioSet: boolean;
};

type AssetKind = "avatar" | "cover";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

/** First image for `<persona>/<kind>.*`, or null when the operator has not supplied one. */
export async function findAsset(
  assetsDir: string,
  persona: string,
  kind: AssetKind
): Promise<string | null> {
  const directory = resolve(assetsDir, sanitize(persona));

  const entries = await readdir(directory).catch(() => [] as string[]);
  const match = entries
    .filter((entry) => entry.toLowerCase().startsWith(`${kind}.`))
    .filter((entry) => IMAGE_EXTENSIONS.has(extname(entry).toLowerCase()))
    .sort()[0];

  return match ? resolve(directory, match) : null;
}

export interface ProfileSetupTarget {
  readonly name: string;
  profileUrl(fixtureUrl: string, accountName: string): string;
  applyAvatar(page: Page, file: string, logger: Logger): Promise<boolean>;
  applyCover(page: Page, file: string, logger: Logger): Promise<boolean>;
  applyBio(page: Page, bio: string, rng: Rng, logger: Logger): Promise<boolean>;
  /** Problems visible to a visitor (empty array = the profile looks dressed). */
  verify(
    page: Page,
    expected: { avatar: boolean; cover: boolean; bio: boolean; bioText: string }
  ): Promise<string[]>;
}

/* ------------------------------------------------------------------ fixture */

export const fixtureProfileTarget: ProfileSetupTarget = {
  name: "fixture",

  profileUrl(fixtureUrl, accountName) {
    return `${fixtureUrl}/profile?as=${encodeURIComponent(accountName)}`;
  },

  async applyAvatar(page, file) {
    await page.setInputFiles("#avatar-input", file);
    await page.waitForTimeout(1_200);
    return page.locator("#avatar-img").isVisible({ timeout: 3_000 }).catch(() => false);
  },

  async applyCover(page, file) {
    await page.setInputFiles("#cover-input", file);
    await page.waitForTimeout(1_200);
    return page.locator("#cover-img").isVisible({ timeout: 3_000 }).catch(() => false);
  },

  async applyBio(page, bio) {
    await page.fill("#bio-input", bio);
    await page.click("#bio-save");
    await page.waitForTimeout(800);
    return true;
  },

  async verify(page, expected) {
    const state = await page.evaluate(() => {
      const avatar = document.querySelector<HTMLImageElement>("#avatar-img");
      const cover = document.querySelector<HTMLImageElement>("#cover-img");
      return {
        avatar: Boolean(avatar?.getAttribute("src")),
        cover: Boolean(cover?.getAttribute("src")),
        bio: document.querySelector("#bio-text")?.textContent?.trim() ?? ""
      };
    });

    const problems: string[] = [];
    if (expected.avatar && !state.avatar) problems.push("avatar not visible after upload");
    if (expected.cover && !state.cover) problems.push("cover not visible after upload");
    if (expected.bioText && !state.bio.includes(expected.bioText.slice(0, 16))) problems.push("bio not visible");
    return problems;
  }
};

/* ----------------------------------------------------------------- facebook */

/**
 * Facebook profile editing.
 *
 * Selectors are the weak point, exactly like the comment flow: Facebook changes
 * them and they can only be confirmed against a live account. Each step fails
 * loudly with a screenshot instead of pretending the profile was dressed.
 */
export const facebookProfileTarget: ProfileSetupTarget = {
  name: "facebook",

  profileUrl() {
    return "https://www.facebook.com/me";
  },

  /**
   * Verified against the live profile:
   *
   *   avatar  → "Hành động với ảnh đại diện" → "Chọn ảnh đại diện" → "Tải ảnh lên"
   *   cover   → "Chỉnh sửa ảnh bìa"          → "Tải ảnh lên" (direct menu item)
   *
   * The cover menu also has "Chọn ảnh bìa", which only opens the album picker —
   * that was the earlier wrong turn.
   */
  async applyAvatar(page, file, logger) {
    const trigger = page.locator('div[role="button"][aria-label="Hành động với ảnh đại diện"]').first();

    if (!(await trigger.isVisible({ timeout: 10_000 }).catch(() => false))) {
      logger.warn("avatar trigger not found on the profile page");
      return false;
    }

    await trigger.click();
    await page.waitForTimeout(1_200);

    const chooserItem = page.getByText("Chọn ảnh đại diện", { exact: true }).first();
    if (!(await chooserItem.isVisible({ timeout: 5_000 }).catch(() => false))) {
      logger.warn("avatar menu item not found");
      return false;
    }
    await chooserItem.click();
    await page.waitForTimeout(1_800);

    const uploaded = await pickFile(page, file);
    if (!uploaded) {
      logger.warn("avatar upload control not found in the chooser");
      return false;
    }

    return saveDialog(page, logger, "avatar");
  },

  async applyCover(page, file, logger) {
    const trigger = page.locator('div[role="button"][aria-label="Chỉnh sửa ảnh bìa"]').first();

    if (!(await trigger.isVisible({ timeout: 10_000 }).catch(() => false))) {
      logger.warn("cover trigger not found on the profile page");
      return false;
    }

    await trigger.click();
    await page.waitForTimeout(1_200);

    // The menu opens "Tải ảnh lên" directly; "Chọn ảnh bìa" is the album picker.
    const uploaded = await pickFile(page, file);
    if (!uploaded) {
      logger.warn("cover upload menu item not found");
      return false;
    }

    // Verified live: the cover is applied by the upload itself — no crop dialog, no
    // save button. If a layout does show one, confirm it, but its absence is normal.
    await saveDialog(page, logger, "cover").catch(() => false);
    await page.waitForTimeout(2_500);
    return true;
  },

  async applyBio(page, bio, rng, logger) {
    // The About tab is where the intro line lives; the profile header button only
    // navigates there.
    await page.goto("https://www.facebook.com/profile.php?sk=about", {
      waitUntil: "domcontentloaded",
      timeout: 60_000
    });
    await readingPause(rng);

    // Facebook shows the pencil only while the bio row is hovered.
    const bioSection = page.locator('div:has(> *:text-is("Tiểu sử")), div:has-text("Tiểu sử")').last();
    await bioSection.hover({ timeout: 5_000 }).catch(() => {});

    const editIntro = page
      .locator(
        [
          'div[role="button"][aria-label*="Chỉnh sửa tiểu sử" i]',
          'div[role="button"][aria-label*="Chỉnh sửa chi tiết" i]',
          'div[role="button"]:has-text("Chỉnh sửa chi tiết")',
          'div[role="button"]:has-text("Chỉnh sửa tiểu sử")'
        ].join(", ")
      )
      .first();

    if (!(await editIntro.isVisible({ timeout: 8_000 }).catch(() => false))) {
      logger.warn("bio editor entry point not found on the About tab");
      return false;
    }

    await editIntro.click();
    await page.waitForTimeout(2_000);

    const box = page
      .locator('textarea[aria-label*="tiểu sử" i], textarea[aria-label*="bio" i], div[role="dialog"] textarea')
      .first();

    if (!(await box.isVisible({ timeout: 6_000 }).catch(() => false))) {
      logger.warn("bio textarea not found in the editor");
      return false;
    }

    await box.fill(bio);
    await page.waitForTimeout(400);
    return saveDialog(page, logger, "bio");
  },

  async verify(page, expected) {
    const text = (await page.locator('div[role="main"]').first().innerText({ timeout: 5_000 }).catch(() => "")) || "";
    const problems: string[] = [];
    // Only judge what this run actually tried to set: reporting "bio not visible"
    // for a step that was skipped turned a successful avatar+cover run into a
    // failure.
    if (expected.bio && !text.includes(expected.bioText.slice(0, 24))) {
      problems.push("bio not visible in the intro");
    }
    return problems;
  }
};

/**
 * Clicks the first upload control (a menu item, then falls back to a dialog button)
 * and hands the file to the resulting native chooser.
 */
async function pickFile(page: Page, file: string): Promise<boolean> {
  const candidates = [
    page.locator('[role="menuitem"]:has-text("Tải ảnh lên")').first(),
    page.getByText("Tải ảnh lên", { exact: true }).first(),
    page.locator('div[role="button"]:has-text("Tải ảnh lên")').first()
  ];

  for (const candidate of candidates) {
    if (!(await candidate.isVisible({ timeout: 3_000 }).catch(() => false))) continue;

    try {
      const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 8_000 }), candidate.click()]);
      await chooser.setFiles(file);
      await page.waitForTimeout(2_500);
      return true;
    } catch {
      // A hidden <input type=file> is the other shape of the same control.
      const hidden = page.locator('input[type="file"][accept*="image"]').first();
      if (await hidden.count()) {
        await hidden.setInputFiles(file).catch(() => {});
        await page.waitForTimeout(2_500);
        return true;
      }
    }
  }

  return false;
}

/** Saves whatever dialog the upload opened; a missing button means nothing was applied. */
async function saveDialog(page: Page, logger: Logger, what: string): Promise<boolean> {
  const save = page
    .locator('[role="dialog"] div[role="button"]:has-text("Lưu"), [role="dialog"] div[role="button"]:has-text("Save")')
    .first();

  if (!(await save.isVisible({ timeout: 10_000 }).catch(() => false))) {
    logger.warn(`${what} dialog has no save button`);
    return false;
  }

  await save.click();
  await page.waitForTimeout(3_000);
  return true;
}

export function resolveProfileTarget(executor: "facebook" | "fixture"): ProfileSetupTarget {
  return executor === "fixture" ? fixtureProfileTarget : facebookProfileTarget;
}

/** Runs the whole setup: avatar → cover → bio, then verifies what the visitor sees. */
export async function runProfileSetup(
  target: ProfileSetupTarget,
  context: ProfileSetupContext
): Promise<ProfileSetupOutcome> {
  const { slot, page, rng, logger, dryRun, assetsDir } = context;
  const notes: string[] = [];

  const url = target.profileUrl(context.fixtureUrl, slot.accountName);
  logger.info("profile setup starting", { persona: slot.personaType, url });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });

  await readingPause(rng);
  await scrollLikeHuman(page, rng);
  await moveMouseLikeHuman(page, rng);

  const healthBefore = await detectAccountHealth(page);
  if (healthBefore) {
    return {
      posted: false,
      content: slot.content,
      postUrl: null,
      evidencePath: null,
      health: healthBefore,
      notes: [`account ${healthBefore.status}: ${healthBefore.reason}`],
      avatarSet: false,
      coverSet: false,
      bioSet: false
    };
  }

  const [avatarFile, coverFile] = await Promise.all([
    findAsset(assetsDir, slot.personaType, "avatar"),
    findAsset(assetsDir, slot.personaType, "cover")
  ]);

  if (!avatarFile) notes.push(`no avatar image at assets/${slot.personaType}/avatar.*`);
  if (!coverFile) notes.push(`no cover image at assets/${slot.personaType}/cover.*`);

  if (!avatarFile && !coverFile) {
    return {
      posted: false,
      content: slot.content,
      postUrl: null,
      evidencePath: await evidence(context, page, "no-assets"),
      health: null,
      notes,
      avatarSet: false,
      coverSet: false,
      bioSet: false
    };
  }

  if (dryRun) {
    notes.push("dry run: profile assets located but nothing was uploaded");
    return {
      posted: false,
      content: slot.content,
      postUrl: null,
      evidencePath: await evidence(context, page, "dry-run"),
      health: null,
      notes,
      avatarSet: false,
      coverSet: false,
      bioSet: false
    };
  }

  let avatarSet = false;
  let coverSet = false;

  if (avatarFile) {
    avatarSet = await target.applyAvatar(page, avatarFile, logger).catch((error: unknown) => {
      notes.push(`avatar upload failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    });
    if (!avatarSet) notes.push("avatar was not set");
  }

  if (coverFile) {
    coverSet = await target.applyCover(page, coverFile, logger).catch((error: unknown) => {
      notes.push(`cover upload failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    });
    if (!coverSet) notes.push("cover was not set");
  }

  const bioSet = await target
    .applyBio(page, slot.content, rng, logger)
    .catch((error: unknown) => {
      notes.push(`bio failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    });
  if (!bioSet) notes.push("bio was not set");

  const problems = await target
    .verify(page, { avatar: avatarSet, cover: coverSet, bio: bioSet, bioText: slot.content })
    .catch((error: unknown) => [`verification failed: ${error instanceof Error ? error.message : String(error)}`]);
  notes.push(...problems);

  const health = await detectAccountHealth(page);

  // Avatar or cover is what makes the profile stop looking like a shell; the bio is
  // a nice-to-have because Facebook's editor is a moving target. A run that dressed
  // the photos still counts, and the readiness card reports the missing bio.
  const done = avatarSet || coverSet;

  return {
    posted: done && problems.length === 0,
    content: slot.content,
    postUrl: null,
    evidencePath: await evidence(context, page, "profile"),
    health,
    notes,
    avatarSet,
    coverSet,
    bioSet
  };
}

async function evidence(context: ProfileSetupContext, page: Page, label: string): Promise<string | null> {
  return captureScreenshot(
    {
      evidenceDir: context.evidenceDir,
      namePrefix: `profile-${context.slot.accountId.slice(0, 8)}`,
      logger: context.logger
    },
    page,
    label
  );
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}
