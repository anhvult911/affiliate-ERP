import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";

import type { Logger } from "../logger.js";

/**
 * Antidetect provider abstraction.
 *
 * The database only stores a generic `browser_profile_id`, so the worker stays
 * vendor-neutral: GPM-Login and Genlogin both expose a local HTTP API that starts
 * a profile and hands back a CDP websocket, while the `local` provider drives a
 * plain persistent Chromium profile (used for dry runs and the fixture harness).
 */
export type BrowserSession =
  | {
      kind: "cdp";
      /** Websocket endpoint of the antidetect browser (CDP). */
      wsEndpoint: string;
      close(): Promise<void>;
    }
  | {
      kind: "persistent";
      /** Chromium user-data directory for a plain profile. */
      userDataDir: string;
      proxy: string | null;
      /**
       * Playwright browser channel: "chrome" uses the machine's real Chrome (best
       * fingerprint); empty uses Playwright's bundled Chromium, which is what a
       * container without a system Chrome has.
       */
      channel: string | null;
      /**
       * Default true. A server has no display, so a headed browser dies there; the
       * antidetect providers are unaffected because they connect over CDP to a browser
       * that GPM/GenLogin started itself.
       */
      headless: boolean;
      close(): Promise<void>;
    };

export type OpenProfileOptions = {
  profileId: string;
  proxy: string | null;
  logger: Logger;
};

export interface AntidetectProvider {
  readonly name: string;
  openProfile(options: OpenProfileOptions): Promise<BrowserSession>;
}

export type RunningBrowser = {
  browser: Browser;
  context: BrowserContext;
  close(): Promise<void>;
};

/**
 * Turns a session into a live Playwright browser. Both branches end up with a
 * context whose pages the executor drives; only the transport differs.
 */
export async function launchBrowser(session: BrowserSession, logger: Logger): Promise<RunningBrowser> {
  if (session.kind === "cdp") {
    const browser = await chromium.connectOverCDP(session.wsEndpoint, { timeout: 30_000 });
    const context = browser.contexts()[0] ?? (await browser.newContext());

    return {
      browser,
      context,
      close: async () => {
        // Disconnecting must not kill the antidetect browser; the provider owns
        // its lifecycle and closes the profile explicitly.
        await browser.close();
        await session.close();
      }
    };
  }

  const context = await chromium.launchPersistentContext(session.userDataDir, {
    // The operator's real Chrome, not Playwright's bundled Chromium: its build
    // string, fonts and WebGL renderer are the ones the host actually has, so the
    // profile looks like a normal browser instead of a testing binary.
    ...(session.channel ? { channel: session.channel } : {}),
    headless: session.headless,
    viewport: null,
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    proxy: session.proxy ? parseProxy(session.proxy) : undefined,
    args: [
      // Removes navigator.webdriver — the single clearest automation signal.
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-infobars"
    ],
    ignoreDefaultArgs: ["--enable-automation"]
  });

  const browser = context.browser();
  if (!browser) throw new Error("Persistent context has no browser handle.");

  logger.debug("launched persistent profile", { userDataDir: session.userDataDir });

  return {
    browser,
    context,
    close: async () => {
      await context.close();
      await session.close();
    }
  };
}

/** `host:port:user:pass` or `host:port` → Playwright proxy settings. */
export function parseProxy(raw: string): { server: string; username?: string; password?: string; bypass: string } {
  const parts = raw.split(":");
  const [host, port, username, password] = parts;

  if (!host || !port) {
    throw new Error(`Proxy must look like host:port[:user:pass], got "${raw}"`);
  }

  return {
    server: `http://${host}:${port}`,
    // Loopback must never go through the account's proxy: it is how the worker
    // reaches local tooling (and the fixture harness), and a dead proxy would
    // otherwise turn every local call into a timeout.
    bypass: "127.0.0.1,localhost,[::1]",
    ...(username ? { username } : {}),
    ...(password ? { password } : {})
  };
}

export async function firstPage(context: BrowserContext): Promise<Page> {
  const existing = context.pages()[0];
  return existing ?? (await context.newPage());
}
