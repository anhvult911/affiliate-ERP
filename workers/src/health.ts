import { createServer, type Server } from "node:http";

import type { Logger } from "./logger.js";

/**
 * Liveness endpoint for the worker container (docs/TASKS.md P3-1).
 *
 * The application already had `/api/cron/health`, but that answers a different
 * question: "did this worker check in recently?". Docker needs the narrower one — "is
 * this process alive right now?" — and it must not depend on the app being reachable,
 * otherwise a worker cannot start before the app does.
 *
 * Unauthenticated by design: it exposes a boolean and a version string, nothing about
 * the farm. It binds to 127.0.0.1 by default so it is not reachable from outside the
 * container unless someone opts in.
 */

export type HealthPayload = { ok: true; version: string; uptimeSeconds: number };

export type HealthResponse = { status: number; body: HealthPayload | { ok: false; error: string } };

/** Pure request → response mapping, so the contract is testable without a socket. */
export function handleHealthRequest(input: {
  method: string | undefined;
  url: string | undefined;
  version: string;
  startedAt: number;
  now?: number;
}): HealthResponse {
  const path = (input.url ?? "/").split("?")[0] ?? "/";

  if (path !== "/health") {
    return { status: 404, body: { ok: false, error: "not found" } };
  }

  if (input.method !== "GET" && input.method !== "HEAD") {
    return { status: 405, body: { ok: false, error: "method not allowed" } };
  }

  const now = input.now ?? Date.now();

  return {
    status: 200,
    body: {
      ok: true,
      version: input.version,
      uptimeSeconds: Math.max(0, Math.round((now - input.startedAt) / 1000))
    }
  };
}

export type HealthServer = { port: number; close: () => Promise<void> };

/**
 * Starts the endpoint. `port: 0` asks the OS for a free port (used by tests).
 * Returns null when the port is disabled, so the caller does not have to branch.
 */
export async function startHealthServer(input: {
  port: number;
  version: string;
  logger: Logger;
}): Promise<HealthServer | null> {
  // Negative disables the endpoint; 0 asks the OS for a free port (tests).
  if (input.port < 0) return null;

  const startedAt = Date.now();

  const server: Server = createServer((request, response) => {
    const result = handleHealthRequest({
      method: request.method,
      url: request.url,
      version: input.version,
      startedAt
    });

    const payload = JSON.stringify(result.body);
    response.writeHead(result.status, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload),
      "cache-control": "no-store"
    });
    // HEAD must not carry a body.
    response.end(request.method === "HEAD" ? undefined : payload);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : input.port;

  input.logger.info("health endpoint listening", { port });

  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      })
  };
}
