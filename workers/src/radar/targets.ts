import type { Page } from "playwright";

import type { Logger } from "../logger.js";
import type { RadarSource } from "../api.js";

/**
 * Post extraction for the radar.
 *
 * A "scraped post" is deliberately minimal — permalink plus the text and images
 * the AI needs to judge intent. Everything else (author, likes) is noise for
 * matching and would only make the payload bigger.
 */
export type ScrapedPost = {
  postUrl: string;
  content: string;
  images: string[];
};

export type RadarTarget = {
  readonly name: string;
  /** URL the scraper opens for a source. */
  sourceUrl(source: RadarSource, fixtureUrl: string): string;
  /** Extract posts currently visible on the page. */
  extract(page: Page, source: RadarSource, logger: Logger): Promise<ScrapedPost[]>;
};

/**
 * Facebook group / fanpage / KOL wall.
 *
 * Selectors live here only. Permalinks are normalised to an absolute URL, and
 * tracking parameters are stripped by the app on ingest, so the same post
 * captured twice is deduplicated.
 */
const POST_LINK_SELECTORS = [
  'a[href*="/posts/"]',
  'a[href*="story_fbid"]',
  'a[href*="/permalink/"]',
  'a[href*="?fbid="]'
].join(", ");

const POST_TEXT_SELECTORS = [
  'div[data-ad-preview="message"]',
  'div[data-ad-comet-preview="message"]',
  'div[role="article"] div[dir="auto"]'
].join(", ");

export const facebookRadarTarget: RadarTarget = {
  name: "facebook",

  sourceUrl(source) {
    return source.url;
  },

  async extract(page, source, logger) {
    const seen = new Map<string, ScrapedPost>();

    const links = page.locator(POST_LINK_SELECTORS);
    const count = Math.min(await links.count(), 40);

    for (let index = 0; index < count; index += 1) {
      const link = links.nth(index);
      const href = await link.getAttribute("href").catch(() => null);
      if (!href) continue;

      let absolute: string;
      try {
        absolute = new URL(href, source.url).toString();
      } catch {
        continue;
      }

      if (!/\/posts\/|story_fbid|permalink|fbid=/.test(absolute)) continue;
      if (seen.has(absolute)) continue;

      // The article ancestor holds both the text and the images of this post.
      const article = link.locator('xpath=ancestor::div[@role="article"][1]');

      const content = await article
        .locator(POST_TEXT_SELECTORS)
        .first()
        .innerText({ timeout: 2_000 })
        .catch(() => "");

      const images = await article
        .locator('img[src^="https"]')
        .evaluateAll((nodes) =>
          nodes
            .map((node) => node.getAttribute("src"))
            .filter((src): src is string => typeof src === "string" && src.length > 0 && !src.includes("emoji"))
        )
        .catch(() => [] as string[]);

      if (content.trim().length === 0 && images.length === 0) continue;

      seen.set(absolute, {
        postUrl: absolute,
        content: content.trim().slice(0, 4000),
        images: [...new Set(images)].slice(0, 4)
      });
    }

    logger.debug("scraped posts", { source: source.name, found: seen.size });
    return [...seen.values()];
  }
};

const FIXTURE_POST_SELECTORS = {
  link: 'a[href^="/post/"]',
  text: ".text",
  images: "img[src^='http']"
};

/**
 * Local harness: reads the fixture's own feed page.
 *
 * Verified shape matters more than realism here — the point is to exercise the
 * whole path (open page → extract → ingest → queue) without touching Facebook.
 */
export const fixtureRadarTarget: RadarTarget = {
  name: "fixture",

  sourceUrl(_source, fixtureUrl) {
    return `${fixtureUrl}/timeline`;
  },

  async extract(page, source, logger) {
    // The fixture fills the feed from /state after load.
    await page.waitForSelector(".post", { timeout: 10_000 }).catch(() => {});

    const posts = await page.evaluate(
      (selectors) => {
        const anchors = [...document.querySelectorAll(selectors.link)] as HTMLAnchorElement[];
        return anchors.map((anchor) => {
          const card = anchor.closest(".post") ?? anchor.parentElement;
          const text = card?.querySelector(selectors.text)?.textContent ?? "";
          const images = [...(card?.querySelectorAll(selectors.images) ?? [])]
            .map((img) => (img as HTMLImageElement).src)
            .filter(Boolean);

          return { href: anchor.getAttribute("href") ?? "", text: text.trim(), images };
        });
      },
      FIXTURE_POST_SELECTORS
    );

    const seen = new Map<string, ScrapedPost>();
    for (const post of posts) {
      if (!post.href) continue;
      const absolute = new URL(post.href, page.url()).toString();
      if (seen.has(absolute)) continue;
      if (post.text.length === 0) continue;

      seen.set(absolute, { postUrl: absolute, content: post.text, images: post.images.slice(0, 2) });
    }

    logger.debug("scraped fixture posts", { source: source.name, found: seen.size });
    return [...seen.values()];
  }
};

export function resolveRadarTarget(executor: "facebook" | "fixture"): RadarTarget {
  return executor === "fixture" ? fixtureRadarTarget : facebookRadarTarget;
}
