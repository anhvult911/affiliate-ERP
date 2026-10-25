import type { AntidetectProvider, BrowserSession, OpenProfileOptions } from "./types.js";
import { findWebsocketEndpoint } from "./gpm.js";

/**
 * Genlogin local API adapter.
 *
 * Same tolerant approach as the GPM adapter: start the profile, then scan the
 * response for a websocket endpoint rather than assuming one field name, because
 * Genlogin's local API has changed shape between releases.
 */
export class GenloginProvider implements AntidetectProvider {
  readonly name = "genlogin";

  constructor(private readonly apiUrl: string) {}

  async openProfile({ profileId, logger }: OpenProfileOptions): Promise<BrowserSession> {
    const body = await this.postJson(
      `${this.apiUrl}/api/v1/profiles/start/${encodeURIComponent(profileId)}`,
      { winSize: 1280 },
      logger,
      "start"
    );

    const wsEndpoint = findWebsocketEndpoint(body);
    if (!wsEndpoint) {
      logger.error("Genlogin did not return a websocket endpoint", {
        profileId,
        response: JSON.stringify(body).slice(0, 400)
      });
      throw new Error(
        `Genlogin started profile ${profileId} but no ws:// endpoint was found in the response. ` +
          "Check the Genlogin version's response shape (see the logged body)."
      );
    }

    logger.debug("Genlogin profile started", { profileId, wsEndpoint });

    return {
      kind: "cdp",
      wsEndpoint,
      close: async () => {
        await this.postJson(
          `${this.apiUrl}/api/v1/profiles/close/${encodeURIComponent(profileId)}`,
          {},
          logger,
          "close"
        ).catch((error: unknown) => {
          logger.warn("Genlogin profile close failed", { profileId, error: String(error) });
        });
      }
    };
  }

  private async postJson(
    url: string,
    payload: Record<string, unknown>,
    logger: OpenProfileOptions["logger"],
    action: string
  ): Promise<unknown> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000)
    });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `Genlogin ${action} failed with HTTP ${response.status}. Is Genlogin running at ${this.apiUrl}? ${text.slice(0, 200)}`
      );
    }

    try {
      return text.length > 0 ? JSON.parse(text) : null;
    } catch {
      logger.warn("Genlogin returned non-JSON", { action, body: text.slice(0, 200) });
      return null;
    }
  }
}
