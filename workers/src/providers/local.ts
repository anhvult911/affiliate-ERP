import { mkdir, open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { AntidetectProvider, BrowserSession, OpenProfileOptions } from "./types.js";

/**
 * Persistent profile on the operator's own machine — no antidetect fingerprinting.
 *
 * It is a real Chrome user-data directory per account, so cookies and warm-up
 * history survive between runs. What it does *not* do is give each account a
 * different canvas/WebGL/audio signature: accounts on the same machine share the
 * host's genuine fingerprint. That is acceptable for a handful of accounts and
 * becomes a liability once several personas run from one box, which is exactly
 * when a fingerprint-masking provider (GPM-Login/Genlogin) earns its price.
 */
export class LocalProfileProvider implements AntidetectProvider {
  readonly name = "local";

  constructor(
    private readonly profileRoot: string,
    /** Empty string = Playwright's bundled Chromium (containers, CI). */
    private readonly channel: string = "chrome"
  ) {}

  async openProfile({ profileId, proxy, logger }: OpenProfileOptions): Promise<BrowserSession> {
    const userDataDir = resolve(this.profileRoot, sanitize(profileId));
    await mkdir(userDataDir, { recursive: true });

    // Two Chromium processes on one user-data directory corrupt it (and look like a
    // stolen session to the site). The lock makes that impossible and the stale
    // window means a crashed worker cannot lock an account forever.
    const release = await acquireLock(userDataDir, logger);

    return {
      kind: "persistent",
      userDataDir,
      proxy,
      channel: this.channel || null,
      close: async () => {
        // Chromium keeps the profile on disk on purpose: cookies and warm-up
        // history are what make the next run look continuous.
        await release();
      }
    };
  }
}

function sanitize(profileId: string): string {
  return profileId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

const LOCK_STALE_MS = 30 * 60 * 1000;

async function acquireLock(userDataDir: string, logger: OpenProfileOptions["logger"]): Promise<() => Promise<void>> {
  const lockPath = resolve(userDataDir, ".worker.lock");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, at: new Date().toISOString() }),
        "utf8"
      );
      await handle.close();

      return async () => {
        await unlink(lockPath).catch(() => {});
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;

      if (attempt === 1) throw new Error(`Profile ${userDataDir} is locked by another worker.`);

      const stale = await isStale(lockPath);
      if (!stale) {
        const owner = await readFile(lockPath, "utf8").catch(() => "unknown");
        throw new Error(
          `Profile ${userDataDir} is already open (lock: ${owner.trim()}). ` +
            "Close the other worker, or delete .worker.lock if that process crashed more than 30 minutes ago."
        );
      }

      logger.warn("removing a stale profile lock", { userDataDir });
      await writeFile(lockPath, "", "utf8").catch(() => {});
      await unlink(lockPath).catch(() => {});
    }
  }

  throw new Error(`Could not lock ${userDataDir}.`);
}

async function isStale(lockPath: string): Promise<boolean> {
  try {
    const info = await stat(lockPath);
    return Date.now() - info.mtimeMs > LOCK_STALE_MS;
  } catch {
    return true;
  }
}
