import { findWebsocketEndpoint } from "./gpm.js";
import type { AntidetectProvider, BrowserSession, OpenProfileOptions } from "./types.js";

/**
 * BitBrowser local API adapter.
 *
 * BitBrowser ships a generous free tier (10 profiles with the full API), which makes
 * it the zero-cost stand-in for GPM/Genlogin. Its local server listens on
 * `http://127.0.0.1:54345` by default, but the port lives in the client config
 * (`localServerAddress`), so it is read from BITBROWSER_API_URL instead of being
 * hardcoded — a wrong port looks exactly like "BitBrowser is not running".
 *
 * Flow: POST /browser/open {id} → `data.ws` (CDP websocket) → Playwright
 * connectOverCDP. Some builds only return `data.http`; in that case the websocket
 * URL is fetched from that address's /json/version, which every Chromium exposes.
 */
export class BitBrowserProvider implements AntidetectProvider {
  readonly name = "bitbrowser";

  constructor(
    private readonly apiUrl: string,
    /** Optional token from Settings → Browser Settings → Local API (7.x). */
    private readonly apiKey: string | null = null
  ) {}

  async openProfile({ profileId, logger }: OpenProfileOptions): Promise<BrowserSession> {
    const body = await this.postJson("/browser/open", { id: profileId }, logger, "open");
    const wsEndpoint = await this.resolveWebsocket(body, logger, profileId);

    logger.debug("BitBrowser profile opened", { profileId, wsEndpoint });

    return {
      kind: "cdp",
      wsEndpoint,
      close: async () => {
        // A failed close must not mask a successful post, but it must be visible: a
        // profile left open eats one of the ten free slots until the client is restarted.
        const closed = await this.postJson("/browser/close", { id: profileId }, logger, "close").catch(
          (error: unknown) => {
            logger.warn("BitBrowser profile close failed", { profileId, error: String(error) });
            return null;
          }
        );

        if (isRecord(closed) && closed.success === false) {
          logger.warn("BitBrowser refused to close the profile — it may still be running", {
            profileId,
            message: String(closed.msg ?? closed.message ?? "no message")
          });
        }
      }
    };
  }

  private async resolveWebsocket(
    body: unknown,
    logger: OpenProfileOptions["logger"],
    profileId: string
  ): Promise<string> {
    if (!isRecord(body)) throw invalidResponse(profileId, body);

    if (body.success === false) {
      throw new Error(
        `BitBrowser refused to open profile ${profileId}: ${String(body.msg ?? body.message ?? "no message")}. ` +
          "Check that the profile id exists and the BitBrowser client is running."
      );
    }

    const data = isRecord(body.data) ? body.data : {};
    const direct =
      firstString(data, ["ws", "wsEndpoint", "webSocketDebuggerUrl"]) ?? findWebsocketEndpoint(data);
    if (direct) {
      const accepted = this.acceptWebsocket(direct, logger, profileId);
      if (accepted) return accepted;
    }

    // Fallback: only an http debugger address came back → ask the browser itself.
    // The address comes from a response body, so it is validated first: fetching it
    // blindly would let anything answering on the API port point the worker at an
    // internal address (metadata endpoints included) and hand it a websocket to drive.
    const httpAddress = firstString(data, ["http", "debuggerAddress", "httpEndpoint"]);
    if (httpAddress) {
      const debugUrl = this.debugUrl(httpAddress);
      if (debugUrl) {
        const version = await fetch(`${debugUrl.origin}/json/version`, {
          signal: AbortSignal.timeout(15_000)
        })
          .then((response) => (response.ok ? response.json() : null))
          .catch(() => null);
        const fromVersion = isRecord(version) ? firstString(version, ["webSocketDebuggerUrl"]) : null;
        const accepted = fromVersion ? this.acceptWebsocket(fromVersion, logger, profileId) : null;
        if (accepted) return accepted;
      } else {
        logger.warn("BitBrowser returned a non-loopback debugger address — ignoring it", {
          profileId,
          address: httpAddress
        });
      }
    }

    logger.error("BitBrowser did not return a websocket endpoint", {
      profileId,
      response: JSON.stringify(body).slice(0, 400)
    });
    throw invalidResponse(profileId, body);
  }

  /**
   * A debugger address is only trusted when it is loopback: BitBrowser always serves
   * its own profiles, and anything else means the API port is answering as someone else.
   */
  private debugUrl(address: string): URL | null {
    const withScheme = /^https?:\/\//i.test(address) ? address : `http://${address}`;
    try {
      const url = new URL(withScheme);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      return isLoopbackHost(url.hostname) ? url : null;
    } catch {
      return null;
    }
  }

  /** Accepts a CDP websocket only if it points at the API host or at loopback. */
  private acceptWebsocket(
    candidate: string,
    logger: OpenProfileOptions["logger"],
    profileId: string
  ): string | null {
    try {
      const url = new URL(candidate);
      if (url.protocol !== "ws:" && url.protocol !== "wss:") {
        logger.warn("BitBrowser returned a non-websocket endpoint — ignoring it", { profileId });
        return null;
      }

      const apiHost = new URL(this.apiUrl).hostname;
      if (!isLoopbackHost(url.hostname) && url.hostname !== apiHost) {
        logger.warn("BitBrowser returned a websocket for a foreign host — ignoring it", {
          profileId,
          host: url.hostname
        });
        return null;
      }

      return candidate;
    } catch {
      return null;
    }
  }

  private async postJson(
    path: string,
    payload: Record<string, unknown>,
    logger: OpenProfileOptions["logger"],
    action: string
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.apiUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { "x-api-key": this.apiKey } : {})
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60_000)
      });
    } catch (error) {
      // ECONNREFUSED is the normal failure when the desktop client is closed.
      throw new Error(
        `BitBrowser ${action} failed to reach ${this.apiUrl}${path}. Is the BitBrowser client running ` +
          `and does BITBROWSER_API_URL match its local API port? (${String(error)})`
      );
    }

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`BitBrowser ${action} failed with HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    try {
      return text.length > 0 ? JSON.parse(text) : null;
    } catch {
      logger.warn("BitBrowser returned non-JSON", { action, body: text.slice(0, 200) });
      return null;
    }
  }
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || host === "127.0.0.1" || host.startsWith("127.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns the first field that holds a non-empty string. */
function firstString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function invalidResponse(profileId: string, body: unknown): Error {
  return new Error(
    `BitBrowser opened profile ${profileId} but no ws:// endpoint was found in the response ` +
      `(${JSON.stringify(body).slice(0, 200)}). Log the raw body and adapt the field names.`
  );
}
