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

/**
 * One candidate read straight out of the DOM, before any normalisation.
 *
 * Split out so normalisation can be unit-tested without a browser: the parts that
 * actually break in production (relative permalinks, duplicate anchors, lazy
 * placeholder nodes) are pure string work.
 */
export type RawPostCandidate = {
  href: string | null;
  text: string;
  images: string[];
};

/**
 * Turns DOM candidates into posts the ingest endpoint can de-duplicate.
 *
 * `baseUrl` resolves relative hrefs; anything that is not a permalink is dropped.
 */
export function normaliseScrapedPosts(
  candidates: RawPostCandidate[],
  baseUrl: string
): ScrapedPost[] {
  const seen = new Map<string, ScrapedPost>();

  for (const candidate of candidates) {
    if (!candidate.href) continue;

    let absolute: string;
    try {
      absolute = new URL(candidate.href, baseUrl).toString();
    } catch {
      continue;
    }

    if (!/\/posts\/|story_fbid|permalink|fbid=/.test(absolute)) continue;
    if (seen.has(absolute)) continue;

    // Facebook renders image alt text and "Facebook" link labels into textContent.
    // They arrive concatenated ("FacebookFacebookFacebook"), so a \b boundary never
    // matches: only runs of two or more are stripped, leaving a genuine mention alone.
    const content = candidate.text
      .replace(/(?:Facebook\s*){2,}/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);
    const images = [...new Set(candidate.images)].slice(0, 4);

    if (content.length === 0 && images.length === 0) continue;

    seen.set(absolute, { postUrl: absolute, content, images });
  }

  return [...seen.values()];
}

export const facebookRadarTarget: RadarTarget = {
  name: "facebook",

  sourceUrl(source) {
    return source.url;
  },

  async extract(page, source, logger) {
    // Read the whole feed in one round-trip. Two things made the previous
    // element-by-element version useless against live Facebook:
    //   * `innerText` returns the loading skeleton ("Facebook Facebook ..."), not the
    //     post, because the feed hides text from the layout tree;
    //   * `div[role="article"]` is no longer the post container, so the ancestor climb
    //     landed on empty nodes.
    // `textContent` on each child of `div[role="feed"]` returns the real author, time
    // and body in one string.
    const candidates = await page.evaluate(
      ({ linkSelector }) => {
        const feed = document.querySelector('div[role="feed"]');
        const containers = feed
          ? Array.from(feed.children)
          : Array.from(document.querySelectorAll('div[role="article"]'));

        const out: RawPostCandidate[] = [];
        for (const node of containers) {
          const text = (node.textContent || "").replace(/\s+/g, " ").trim();
          // Virtualised feed renders empty wrappers for posts that are not loaded yet.
          if (text.length < 20) continue;

          const link = node.querySelector(linkSelector);
          const images = Array.from(node.querySelectorAll('img[src^="https"]'))
            .map((img) => img.getAttribute("src"))
            .filter((src): src is string => typeof src === "string" && src.length > 0 && !src.includes("emoji"));

          if (!link && images.length === 0) continue;
          out.push({ href: link?.getAttribute("href") ?? null, text, images });
        }
        return out;
      },
      { linkSelector: POST_LINK_SELECTORS }
    );

    const posts = normaliseScrapedPosts(candidates, source.url);
    logger.debug("scraped posts", { source: source.name, candidates: candidates.length, found: posts.length });
    return posts;
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
