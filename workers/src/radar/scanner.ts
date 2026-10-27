import type { Page } from "playwright";

import type { ScanAccount, RadarSource, WorkerApi, RadarIngestResult } from "../api.js";
import type { WorkerConfig } from "../config.js";
import { detectAccountHealth } from "../account-health.js";
import { moveMouseLikeHuman, readingPause, scrollLikeHuman, sleep, type Rng } from "../humanize.js";
import type { Logger } from "../logger.js";
import { resolveRadarTarget, type RadarTarget } from "./targets.js";

/**
 * Radar scan cycle.
 *
 *   due sources → open each in the account's browser → extract posts → hand every
 *   post to /api/worker/radar/ingest (which de-duplicates, matches and queues)
 *
 * The scraper never decides whether a post is worth a comment: that is the app's
 * AI match. Keeping the decision server-side means threshold and prompt changes
 * apply immediately, without redeploying the process that drives browsers.
 */

export type RadarDeps = {
  api: WorkerApi;
  config: WorkerConfig;
  logger: Logger;
  rng: Rng;
  target: RadarTarget;
  fixtureUrl: string;
  /** Opens a page with the given account's browser; cleans up afterwards. */
  withPage: <T>(
    account: ScanAccount,
    log: Logger,
    run: (page: Page) => Promise<T>
  ) => Promise<T>;
  /** A usable account whose browser can be driven. */
  pickScanAccount: () => Promise<ScanAccount | null>;
};

export type RadarCycleResult = {
  scannedSources: number;
  postsSeen: number;
  queued: number;
  duplicates: number;
  belowThreshold: number;
  errors: number;
};

const MAX_POSTS_PER_SOURCE = 12;

export async function runRadarCycle(deps: RadarDeps): Promise<RadarCycleResult> {
  const result: RadarCycleResult = {
    scannedSources: 0,
    postsSeen: 0,
    queued: 0,
    duplicates: 0,
    belowThreshold: 0,
    errors: 0
  };

  const account = await deps.pickScanAccount();
  if (!account) {
    deps.logger.warn("radar scan skipped: no active account with a browser profile");
    return result;
  }

  const sources = await deps.api.radarSources(deps.config.radarSourcesPerCycle);
  if (sources.length === 0) {
    deps.logger.debug("radar: no sources due");
    return result;
  }

  deps.logger.info("radar: scanning", { sources: sources.length, account: account.name });

  for (const source of sources) {
    const log = deps.logger.child({ source: source.name, sourceId: source.id });

    try {
      const posts = await deps.withPage(account, log, async (page) => {
        await page.goto(deps.target.sourceUrl(source, deps.fixtureUrl), {
          waitUntil: "domcontentloaded",
          timeout: 60_000
        });

        // A person reads the feed before anything else; the same pauses also give
        // lazy-loaded posts time to appear.
        await readingPause(deps.rng);
        await scrollLikeHuman(page, deps.rng);
        await moveMouseLikeHuman(page, deps.rng);

        const health = await detectAccountHealth(page);
        if (health) throw new RadarHealthError(health.status, health.reason);

        return deps.target.extract(page, source, log);
      });

      result.scannedSources += 1;
      result.postsSeen += posts.length;

      for (const post of posts.slice(0, MAX_POSTS_PER_SOURCE)) {
        const outcome = await ingestPost(deps, source, post, log);
        if (!outcome) {
          result.errors += 1;
          continue;
        }

        if (outcome.duplicate) result.duplicates += 1;
        else if (outcome.belowThreshold) result.belowThreshold += 1;
        else if (outcome.created) result.queued += 1;

        await sleep(deps.rng() * 900 + 300);
      }

      // Even an empty or fully-duplicated scan advances the interval, otherwise
      // this source would hold the head of the due list forever.
      const recorded = await deps.api
        .radarScanned(source.id, posts.length, account.id)
        .catch((error: unknown) => {
          log.warn("radar: could not record the scan", {
            error: error instanceof Error ? error.message : String(error)
          });
          return null;
        });

      // The app alerts when the streak crosses its threshold; mirror it in the log so
      // a local run shows the same signal.
      if (recorded?.alerted) {
        log.error("radar: consecutive empty scans — selectors may have broken", {
          emptyStreak: recorded.emptyStreak
        });
      }

      log.info("radar: source scanned", { posts: posts.length });
    } catch (error) {
      result.errors += 1;

      if (error instanceof RadarHealthError) {
        log.warn("radar: account health problem, stopping the scan", {
          status: error.status,
          reason: error.reason
        });
        break; // the account needs a human; other sources would fail the same way
      }

      log.error("radar: source failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  return result;
}

class RadarHealthError extends Error {
  constructor(
    readonly status: "cooldown" | "checkpoint",
    readonly reason: string
  ) {
    super(`account ${status}: ${reason}`);
  }
}

/** The body sent to /api/worker/radar/ingest. Pure so the contract stays testable. */
export type RadarIngestRequest = Parameters<WorkerApi["radarIngest"]>[0];

export function buildIngestRequest(
  source: Pick<RadarSource, "id">,
  post: { postUrl: string; content: string; images: string[] },
  pinnedProductId: string | null
): RadarIngestRequest {
  return {
    sourceId: source.id,
    postUrl: post.postUrl,
    postContent: post.content,
    postImages: post.images,
    // A pinned product is how the pipeline works before GEMINI_API_KEY exists.
    ...(pinnedProductId ? { productId: pinnedProductId } : {}),
    // Ask the API for the draft in the same round-trip. The API only spends a Gemini call
    // on posts that cleared the match threshold (off-topic posts return earlier), and it
    // treats a failed draft as best-effort, so this cannot fail the ingest.
    draft: true
  };
}

async function ingestPost(
  deps: RadarDeps,
  source: RadarSource,
  post: { postUrl: string; content: string; images: string[] },
  log: Logger
): Promise<RadarIngestResult | null> {
  try {
    const outcome = await deps.api.radarIngest(
      buildIngestRequest(source, post, deps.config.radarPinnedProductId)
    );

    if (outcome.created) {
      log.info("radar: queued a post", { taskId: outcome.taskId, score: outcome.score });
    } else {
      log.debug("radar: post ignored", {
        duplicate: outcome.duplicate,
        belowThreshold: outcome.belowThreshold,
        score: outcome.score
      });
    }

    return outcome;
  } catch (error) {
    log.warn("radar: ingest failed", { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

export { resolveRadarTarget };
