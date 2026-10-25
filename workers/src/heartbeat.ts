import { hostname } from "node:os";

import type { WorkerApi } from "./api.js";
import type { WorkerConfig } from "./config.js";
import type { Logger } from "./logger.js";

/**
 * Heartbeat loop.
 *
 * Independent of the claim loop on purpose: a claim cycle can take a minute for a
 * 2-tier task, and a heartbeat that only fires between tasks would report a
 * healthy worker as dead. `/api/cron/health` watches these timestamps.
 */
export function startHeartbeat(api: WorkerApi, config: WorkerConfig, logger: Logger): () => void {
  const mode = [config.executor, config.warmingEnabled ? "warming" : null, config.dryRun ? "dry-run" : null]
    .filter((part): part is string => Boolean(part))
    .join("+");

  const beat = async () => {
    try {
      await api.heartbeat({ host: hostname(), mode });
      logger.debug("heartbeat sent", { mode });
    } catch (error) {
      // A failed heartbeat must not stop the worker; the other side will alert.
      logger.warn("heartbeat failed", { error: error instanceof Error ? error.message : String(error) });
    }
  };

  void beat();
  const timer = setInterval(() => void beat(), config.heartbeatIntervalMs);

  return () => clearInterval(timer);
}
