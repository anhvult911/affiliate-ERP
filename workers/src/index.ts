import type { Page } from "playwright";

import { WorkerApi, type ClaimedAccount, type ClaimedTask, type ScanAccount, type TaskReport, type WarmingReport, type WarmingSlot } from "./api.js";
import { loadConfig, shouldClaimTasks, type WorkerConfig } from "./config.js";
import { resolveTarget, runCommentFlow, type CommentTarget } from "./execution/index.js";
import { resolveWarmingTarget, runWarmingSlot, type WarmingOutcome } from "./execution/warming.js";
import { resolveProfileTarget, runProfileSetup } from "./execution/profile-setup.js";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { startHeartbeat } from "./heartbeat.js";
import { createRng, sleep, type Rng } from "./humanize.js";
import { startHealthServer } from "./health.js";
import { createLogger, type Logger } from "./logger.js";
import { assertProxyReachable } from "./proxy-check.js";
import { firstPage, launchBrowser, resolveProvider, type AntidetectProvider } from "./providers/index.js";
import { resolveRadarTarget } from "./radar/targets.js";
import { runRadarCycle } from "./radar/scanner.js";

/**
 * The execution worker.
 *
 *   claim (atomic, server-side) → open the account's antidetect profile → run the
 *   comment flow → report the outcome (including account health)
 *
 * Design notes that matter in production:
 *   - one task at a time per process: accounts are the scarce resource, and
 *     parallel posts from one profile is exactly what gets an account flagged;
 *   - every failure path reports back, otherwise the task sits in `running` until
 *     the 15-minute lease expires;
 *   - `DRY_RUN=true` (default) drives the real browser and typing but submits
 *     nothing.
 */

type Deps = {
  config: WorkerConfig;
  api: WorkerApi;
  provider: AntidetectProvider;
  target: CommentTarget;
  logger: Logger;
  rng: Rng;
  fixtureUrl: string;
};

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({
    worker: config.workerName,
    version: config.workerVersion,
    dryRun: config.dryRun,
    provider: config.provider,
    executor: config.executor
  });

  // The fixture harness is self-contained: if no URL is given, serve the page.
  let fixture: FixtureServer | null = null;
  let fixtureUrl = config.fixtureUrl;
  if (config.executor === "fixture" && fixtureUrl.length === 0) {
    fixture = await startFixtureServer(logger);
    fixtureUrl = fixture.url;
  }

  const deps: Deps = {
    config,
    api: new WorkerApi(config),
    provider: resolveProvider(config),
    target: resolveTarget(config.executor),
    logger,
    rng: createRng(config.randomSeed),
    fixtureUrl
  };

  if (config.ignoreProxy) {
    logger.warn("IGNORE_PROXY is on — every account will browse from the host IP", {
      hint: "Only correct when the accounts really do live on this connection."
    });
  }

  logger.info("worker ready", {
    appUrl: config.appUrl,
    pollIntervalMs: config.pollIntervalMs,
    maxPerClaim: config.maxPerClaim,
    fixtureUrl: fixtureUrl || undefined,
    randomSeed: config.randomSeed ?? "unseeded"
  });

  let running = true;
  const stop = (signal: string) => {
    if (!running) return;
    running = false;
    logger.info("shutdown requested — finishing the current task", { signal });
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  // Registered before the first claim so /api/cron/health knows this process
  // exists; a worker that dies is then detected by the missing beat, not by an
  // empty queue.
  // Liveness for the container runtime; independent of the app being reachable.
  const health = await startHealthServer({
    port: config.healthPort,
    version: config.workerVersion,
    logger
  }).catch((error: unknown) => {
    logger.warn("health endpoint failed to start", {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  });

  const stopHeartbeat = startHeartbeat(deps.api, config, logger);

  // Decided once, not per loop iteration: this is an operating mode, and logging it
  // every poll would bury the interesting lines.
  const claimsTasks = shouldClaimTasks(config);
  if (!claimsTasks) {
    logger.warn("not claiming tasks", {
      reason: config.warmingOnly
        ? "warming-only run"
        : "dry run with the fixture executor (set DRY_RUN_CLAIMS=true to exercise the queue)"
    });
  }

  try {
    do {
      let didWork = false;

      if (claimsTasks) {
        const tasks = await claimTasks(deps);

        if (tasks.length === 0) {
          logger.debug("no queued tasks");
        } else {
          didWork = true;
          for (const task of tasks) {
            if (!running) {
              logger.info("stopping with tasks still claimed", { taskId: task.taskId });
              break;
            }
            await executeTask(task, deps);
          }
        }
      }

      if (config.radarEnabled && running) {
        didWork = (await runRadar(deps)) || didWork;
      }

      if (config.warmingEnabled && running) {
        didWork = (await runWarmingCycle(deps)) || didWork;
      }

      if (config.runOnce) break;
      // Idle cycles wait; a productive one loops straight back for more.
      if (!didWork) await sleep(config.pollIntervalMs);
    } while (running);
  } finally {
    stopHeartbeat();
    await health?.close();
    await fixture?.stop();
  }

  logger.info("worker stopped");
}

async function claimTasks(deps: Deps): Promise<ClaimedTask[]> {
  try {
    const tasks = await deps.api.claim(deps.config.maxPerClaim);
    if (tasks.length > 0) deps.logger.info("claimed tasks", { count: tasks.length });
    return tasks;
  } catch (error) {
    // A dead API is not a crash: log and keep polling.
    deps.logger.error("claim failed", { error: describe(error) });
    return [];
  }
}

async function executeTask(task: ClaimedTask, deps: Deps): Promise<void> {
  const log = deps.logger.child({ taskId: task.taskId, attempt: task.attempt, mode: task.executionMode });

  // Captured into consts so the narrowing survives into the flow closures.
  const account = task.account;
  const secondary = task.secondaryAccount;

  if (!account) {
    await report(deps, task, { status: "failed", error: "The task has no assigned account." }, log);
    return;
  }
  const profileId = resolveProfileId(account, deps.config);
  if (!profileId) {
    await report(deps, task, { status: "failed", error: "The assigned account has no browser profile id." }, log);
    return;
  }
  if (!task.comment) {
    await report(deps, task, { status: "failed", error: "Task has no approved comment text." }, log);
    return;
  }
  if (!task.product) {
    await report(deps, task, { status: "failed", error: "Task has no matched product, so there is no affiliate link." }, log);
    return;
  }

  try {
    const outcome = await withProfile(
      { profileId, proxyIp: account.proxy_ip, label: account.name },
      deps,
      log,
      (page) =>
        runCommentFlow(deps.target, {
          task,
          actingAccount: account,
          page,
        rng: deps.rng,
        logger: log,
        dryRun: deps.config.dryRun,
        evidenceDir: deps.config.evidenceDir,
        fixtureUrl: deps.fixtureUrl
      })
    );

    log.info("flow finished", {
      posted: outcome.posted,
      replied: outcome.replyText !== null,
      evidence: outcome.evidencePath ?? undefined,
      notes: outcome.notes.length > 0 ? outcome.notes : undefined
    });

    if (outcome.health) {
      await report(
        deps,
        task,
        {
          status: "failed",
          error: `${outcome.health.status}: ${outcome.health.reason}`,
          accountStatus: outcome.health.status,
          cooldownMinutes: outcome.health.cooldownMinutes
        },
        log
      );
      return;
    }

    if (deps.config.dryRun) {
      await report(deps, task, { status: "failed", error: "Dry run: nothing was posted." }, log);
      return;
    }

    if (!outcome.posted) {
      await report(deps, task, { status: "failed", error: outcome.notes.join("; ") || "Nothing was posted." }, log);
      return;
    }

    // Non-fatal observations travel with the success report, so "completed with a
    // missing affiliate link" is visible in the queue instead of only in the log.
    const note = outcome.notes.length > 0 ? outcome.notes.join("; ") : null;

    // 2-tier: the link reply is posted by the second account, from its own profile.
    const secondaryProfileId = secondary ? resolveProfileId(secondary, deps.config) : null;

    if (task.executionMode === "seeding_2_accounts" && secondary && secondaryProfileId) {
      const replyOutcome = await withProfile(
        { profileId: secondaryProfileId, proxyIp: secondary.proxy_ip, label: secondary.name },
        deps,
        log,
        (page) =>
          runCommentFlow(
            deps.target,
            {
              task,
              actingAccount: secondary,
              page,
              rng: deps.rng,
              logger: log.child({ account: secondary.name }),
              dryRun: false,
              evidenceDir: deps.config.evidenceDir,
              fixtureUrl: deps.fixtureUrl
            },
            "reply-only"
          )
      );

      log.info("tier-2 reply finished", { replied: replyOutcome.posted, notes: replyOutcome.notes });

      if (replyOutcome.health) {
        await report(
          deps,
          task,
          {
            status: "failed",
            error: `Tier-2 account problem: ${replyOutcome.health.status}: ${replyOutcome.health.reason}`,
            accountStatus: replyOutcome.health.status,
            cooldownMinutes: replyOutcome.health.cooldownMinutes
          },
          log
        );
        return;
      }
    } else if (task.executionMode === "seeding_2_accounts") {
      log.warn("2-tier task has no usable tier-2 account — the link reply was not posted");
    }

    await report(deps, task, { status: "completed", executedAt: new Date().toISOString(), note }, log);
  } catch (error) {
    await report(deps, task, { status: "failed", error: describe(error) }, log);
  }
}

/**
 * Radar scan. Uses one of the farm's accounts to browse the watchlist — the same
 * account pool, because the scraper must look like a normal member reading a feed,
 * not a datacenter IP hammering group URLs.
 */
async function runRadar(deps: Deps): Promise<boolean> {
  const account = await pickScanAccount(deps);
  if (!account) return false;
  if (!resolveProfileId(account, deps.config)) {
    deps.logger.warn("radar: the chosen account has no browser profile id");
    return false;
  }

  const cycle = await runRadarCycle({
    api: deps.api,
    config: deps.config,
    logger: deps.logger,
    rng: deps.rng,
    target: resolveRadarTarget(deps.config.executor),
    fixtureUrl: deps.fixtureUrl,
    withPage: (scanAccount, log, run) =>
      withProfile(
        {
          profileId: resolveProfileId(scanAccount, deps.config) as string,
          proxyIp: scanAccount.proxy_ip,
          label: scanAccount.name
        },
        deps,
        log,
        run
      ),
    pickScanAccount: async () => account
  });

  if (cycle.scannedSources > 0) {
    deps.logger.info("radar cycle finished", cycle);
  }

  return cycle.postsSeen > 0 || cycle.queued > 0;
}

/** Highest-trust active account with a browser profile — the safest scanner. */
async function pickScanAccount(deps: Deps): Promise<ScanAccount | null> {
  try {
    const [account] = await deps.api.scanAccounts(1);
    return account ?? null;
  } catch (error) {
    deps.logger.warn("radar: could not pick a scan account", { error: describe(error) });
    return null;
  }
}

/**
 * Persona warming. Separate from task execution on purpose: warming publishes
 * ordinary content on the accounts' own timelines and cross-warms between
 * accounts, with no affiliate link anywhere.
 *
 * Returns true when there was work, so the main loop knows whether to wait.
 */
async function runWarmingCycle(deps: Deps): Promise<boolean> {
  let slots: WarmingSlot[];
  try {
    slots = await deps.api.dueWarming();
  } catch (error) {
    deps.logger.error("warming lookup failed", { error: describe(error) });
    return false;
  }

  if (slots.length === 0) {
    deps.logger.debug("no warming due");
    return false;
  }

  deps.logger.info("warming slots due", { count: slots.length });

  for (const slot of slots) {
    if (!deps.config.warmingOnly && !deps.config.warmingEnabled) break;

    const log = deps.logger.child({
      account: slot.accountName,
      kind: slot.kind,
      scheduledAt: slot.scheduledAt,
      target: slot.targetAccountName ?? undefined
    });

    try {
      const outcome = await warmingOnce(slot, deps, log);

      if (deps.config.dryRun) {
        log.info("warming dry run finished", { notes: outcome.notes, evidence: outcome.evidencePath ?? undefined });
        continue;
      }

      if (outcome.health) {
        await reportWarming(deps, slot, {
          status: "failed",
          error: `${outcome.health.status}: ${outcome.health.reason}`,
          accountStatus: outcome.health.status,
          cooldownMinutes: outcome.health.cooldownMinutes,
          ...assetFlags(slot, outcome)
        }, log);
        continue;
      }

      if (!outcome.posted) {
        await reportWarming(
          deps,
          slot,
          {
            status: "failed",
            // The report API caps `error` at 2000 chars; a verbose failure (several
            // selector warnings) otherwise produces a rejected report and the run
            // is lost instead of recorded.
            error: (outcome.notes.join("; ") || "Nothing was published.").slice(0, 1900),
            ...assetFlags(slot, outcome)
          },
          log
        );
        continue;
      }

      await reportWarming(deps, slot, {
        status: "completed",
        content: outcome.content,
        postUrl: outcome.postUrl,
        targetAccountId: slot.targetAccountId,
        targetPostUrl: slot.targetPostUrl,
        executedAt: new Date().toISOString(),
        ...assetFlags(slot, outcome)
      }, log);

      log.info("warming recorded", {
        postUrl: outcome.postUrl ?? undefined,
        notes: outcome.notes.length > 0 ? outcome.notes : undefined
      });
    } catch (error) {
      await reportWarming(deps, slot, { status: "failed", error: describe(error) }, log);
    }
  }

  return true;
}

async function warmingOnce(slot: WarmingSlot, deps: Deps, log: Logger): Promise<WarmingOutcome> {
  if (slot.kind === "profile_setup") {
    // Profile dressing is not a text post: it uploads files and edits the intro,
    // so it runs through its own target instead of the composer flow.
    return runProfileSetupAsWarming(slot, deps, log);
  }

  if (deps.config.provider !== "local" && !slot.browserProfileId) {
    throw new Error(`Account ${slot.accountName} has no browser profile id — warming cannot open it.`);
  }

  const target = resolveWarmingTarget(deps.config.executor, slot.kind);

  return withProfile(
    {
      profileId:
        deps.config.provider === "local" ? slot.accountId : (slot.browserProfileId as string),
      proxyIp: slot.proxyIp,
      label: slot.accountName
    },
    deps,
    log,
    (page) =>
      runWarmingSlot(target, {
        slot,
        page,
        rng: deps.rng,
        logger: log,
        dryRun: deps.config.dryRun,
        evidenceDir: deps.config.evidenceDir,
        fixtureUrl: deps.fixtureUrl
      })
  );
}

async function runProfileSetupAsWarming(
  slot: WarmingSlot,
  deps: Deps,
  log: Logger
): Promise<WarmingOutcome> {
  const outcome = await withProfile(
    {
      profileId:
        deps.config.provider === "local" ? slot.accountId : (slot.browserProfileId as string),
      proxyIp: slot.proxyIp,
      label: slot.accountName
    },
    deps,
    log,
    (page) =>
      runProfileSetup(resolveProfileTarget(deps.config.executor), {
        slot,
        page,
        rng: deps.rng,
        logger: log,
        dryRun: deps.config.dryRun,
        evidenceDir: deps.config.evidenceDir,
        fixtureUrl: deps.fixtureUrl,
        assetsDir: deps.config.assetsDir
      })
  );

  return {
    posted: outcome.posted,
    content: outcome.content,
    postUrl: null,
    evidencePath: outcome.evidencePath,
    health: outcome.health,
    notes: outcome.notes,
    avatarSet: outcome.avatarSet,
    coverSet: outcome.coverSet,
    bioSet: outcome.bioSet
  };
}

/**
 * What a profile_setup run actually changed, on success *and* failure.
 *
 * A run that uploaded the avatar and then failed on the bio still changed the
 * avatar; dropping the flags on failure made the dashboard disagree with the
 * profile a visitor sees.
 */
function assetFlags(
  slot: WarmingSlot,
  outcome: WarmingOutcome
): { avatarSet?: boolean; coverSet?: boolean; bioSet?: boolean } {
  return slot.kind === "profile_setup"
    ? {
        avatarSet: outcome.avatarSet ?? false,
        coverSet: outcome.coverSet ?? false,
        bioSet: outcome.bioSet ?? false
      }
    : {};
}

async function reportWarming(
  deps: Deps,
  slot: WarmingSlot,
  body: Omit<WarmingReport, "accountId" | "kind">,
  log: Logger
): Promise<void> {
  try {
    const result = await deps.api.reportWarming({
      accountId: slot.accountId,
      kind: slot.kind,
      ...body,
      // Fixture runs must stay visibly rehearsal in the audit trail.
      sandbox: deps.config.executor === "fixture"
    });
    log.info("warming reported", { status: body.status, accountStatus: body.accountStatus, trustScore: result.trustScore ?? undefined });
  } catch (error) {
    // Warming is not lease-protected like a claimed task: a failed report means the
    // slot stays open and will be retried on the next cycle.
    log.error("warming report failed", { error: describe(error) });
  }
}

/**
 * Which profile to open for an account.
 *
 * Antidetect providers own the id (it lives in `browser_profile_id`). The local
 * provider owns its own directories, so it keys them by the account id — that is
 * what lets a freshly imported account run before anyone creates a GPM profile.
 */
function resolveProfileId(account: ClaimedAccount | ScanAccount, config: WorkerConfig): string | null {
  return config.provider === "local" ? account.id : account.browser_profile_id;
}

/** What the worker needs to open a browser session, for any account. */
type ProfileRef = { profileId: string; proxyIp: string | null; label: string };

/** Opens the account's profile, hands a page to `run`, and always tears it down. */
async function withProfile<T>(
  profile: ProfileRef,
  deps: Deps,
  log: Logger,
  run: (page: Page) => Promise<T>
): Promise<T> {
  if (!profile.profileId) throw new Error(`${profile.label} has no browser profile id.`);

  // The fixture harness drives a local page, so the account's proxy is not used
  // (and the seeded demo proxy is not reachable). Real targets always go through
  // the proxy — and only after it proved reachable.
  const useProxy =
    !deps.config.ignoreProxy && deps.config.executor !== "fixture" && Boolean(profile.proxyIp);

  if (useProxy && profile.proxyIp) {
    await assertProxyReachable(profile.proxyIp);
  }

  const session = await deps.provider.openProfile({
    profileId: profile.profileId,
    proxy: useProxy ? profile.proxyIp : null,
    logger: log
  });

  const browser = await launchBrowser(session, log);
  try {
    const page = await firstPage(browser.context);
    return await run(page);
  } finally {
    await browser.close().catch((error: unknown) => {
      log.warn("closing the browser failed", { error: describe(error) });
    });
  }
}

async function report(
  deps: Deps,
  task: ClaimedTask,
  body: Omit<TaskReport, "worker">,
  log: Logger
): Promise<void> {
  try {
    await deps.api.report(task.taskId, body);
    log.info("reported", { status: body.status, accountStatus: body.accountStatus });
  } catch (error) {
    // The task stays `running` and the queue's lease will reclaim it — but say so
    // loudly, because a silent report failure looks like a hung worker.
    log.error("report failed — the task will wait for the lease", { error: describe(error) });
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

main().catch((error: unknown) => {
  console.error(`worker crashed: ${describe(error)}`);
  process.exitCode = 1;
});
