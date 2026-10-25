import type { AntidetectProvider, BrowserSession, OpenProfileOptions } from "./types.js";

/**
 * GPM-Login local API adapter.
 *
 * The exact response shape differs between GPM versions (`data.ws` in v3,
 * `data.websocket` / `data.remote_debugging_address` in others), so the endpoint
 * is discovered by scanning the response for a websocket URL instead of trusting
 * one field name. When nothing is found the raw body is logged, which is what you
 * need to adapt to a new version in one minute.
 */
export class GpmLoginProvider implements AntidetectProvider {
  readonly name = "gpm";

  constructor(private readonly apiUrl: string) {}

  async openProfile({ profileId, logger }: OpenProfileOptions): Promise<BrowserSession> {
    const startUrl = `${this.apiUrl}/api/v3/profiles/start/${encodeURIComponent(profileId)}?winScale=1`;
    const body = await this.getJson(startUrl, logger, "start");
    const wsEndpoint = findWebsocketEndpoint(body);

    if (!wsEndpoint) {
      logger.error("GPM did not return a websocket endpoint", { profileId, response: JSON.stringify(body).slice(0, 400) });
      throw new Error(
        `GPM-Login started profile ${profileId} but no ws:// endpoint was found in the response. ` +
          "Check the GPM version's response shape (see the logged body)."
      );
    }

    logger.debug("GPM profile started", { profileId, wsEndpoint });

    return {
      kind: "cdp",
      wsEndpoint,
      close: async () => {
        await this.getJson(
          `${this.apiUrl}/api/v3/profiles/close/${encodeURIComponent(profileId)}`,
          logger,
          "close"
        ).catch((error: unknown) => {
          // A failed close must not mask a successful post — log and continue.
          logger.warn("GPM profile close failed", { profileId, error: String(error) });
        });
      }
    };
  }

  private async getJson(url: string, logger: OpenProfileOptions["logger"], action: string): Promise<unknown> {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `GPM ${action} failed with HTTP ${response.status}. Is GPM-Login running at ${this.apiUrl}? ${text.slice(0, 200)}`
      );
    }

    try {
      return text.length > 0 ? JSON.parse(text) : null;
    } catch {
      logger.warn("GPM returned non-JSON", { action, body: text.slice(0, 200) });
      return null;
    }
  }
}

/** Depth-first scan for the first ws:// value in an arbitrary JSON body. */
export function findWebsocketEndpoint(value: unknown, depth = 0): string | null {
  if (depth > 6 || value === null) return null;

  if (typeof value === "string") {
    return value.startsWith("ws://") || value.startsWith("wss://") ? value : null;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findWebsocketEndpoint(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof value === "object") {
    for (const entry of Object.values(value)) {
      const found = findWebsocketEndpoint(entry, depth + 1);
      if (found) return found;
    }
  }

  return null;
}
