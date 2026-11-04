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
        // A failed close must not mask a successful post — log and continue.
        await this.postJson("/browser/close", { id: profileId }, logger, "close").catch((error: unknown) => {
          logger.warn("BitBrowser profile close failed", { profileId, error: String(error) });
        });
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
    const direct = firstString(data, ["ws", "wsEndpoint", "webSocketDebuggerUrl"]) ?? findWebsocketEndpoint(data);
    if (direct) return direct;

    // Fallback: only an http debugger address came back → ask the browser itself.
    const httpAddress = firstString(data, ["http", "debuggerAddress", "httpEndpoint"]);
    if (httpAddress) {
      const versionUrl = `${httpAddress.startsWith("http") ? httpAddress : `http://${httpAddress}`}/json/version`;
      const version = await fetch(versionUrl, { signal: AbortSignal.timeout(15_000) })
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null);
      const fromVersion = isRecord(version) ? firstString(version, ["webSocketDebuggerUrl"]) : null;
      if (fromVersion) return fromVersion;
    }

    logger.error("BitBrowser did not return a websocket endpoint", {
      profileId,
      response: JSON.stringify(body).slice(0, 400)
    });
    throw invalidResponse(profileId, body);
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
