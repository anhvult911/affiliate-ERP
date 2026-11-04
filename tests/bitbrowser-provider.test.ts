import assert from "node:assert/strict";
import test from "node:test";

import { BitBrowserProvider } from "../workers/src/providers/bitbrowser.js";
import type { Logger } from "../workers/src/logger.js";

const API = "http://127.0.0.1:54345";

function silentLogger(): Logger {
  const noop = () => undefined;
  return { debug: noop, info: noop, warn: noop, error: noop } as unknown as Logger;
}

type Call = { url: string; method: string; body: unknown; headers: Record<string, string> };

/** Installs a fetch stub that answers each URL from `routes` and records calls. */
async function withFetch<T>(
  routes: Record<string, unknown>,
  run: (calls: Call[]) => Promise<T>
): Promise<T> {
  const original = globalThis.fetch;
  const calls: Call[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>
    });

    const key = Object.keys(routes).find((candidate) => url.startsWith(candidate));
    if (!key) throw new TypeError(`fetch failed: ${url}`);

    return new Response(JSON.stringify(routes[key]), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;

  try {
    return await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

test("opens a BitBrowser profile and returns the CDP websocket", async () => {
  await withFetch(
    {
      [`${API}/browser/open`]: {
        success: true,
        data: { ws: "ws://127.0.0.1:50106/devtools/browser/abc", http: "127.0.0.1:50106", coreVersion: "104" }
      }
    },
    async (calls) => {
      const provider = new BitBrowserProvider(API);
      const session = await provider.openProfile({ profileId: "profile-1", proxy: null, logger: silentLogger() });

      assert.equal(session.kind, "cdp");
      assert.equal(session.kind === "cdp" ? session.wsEndpoint : null, "ws://127.0.0.1:50106/devtools/browser/abc");
      assert.equal(calls[0]?.url, `${API}/browser/open`);
      assert.equal(calls[0]?.method, "POST");
      assert.deepEqual(calls[0]?.body, { id: "profile-1" });
    }
  );
});

test("close() posts /browser/close with the profile id", async () => {
  await withFetch(
    {
      [`${API}/browser/open`]: { success: true, data: { ws: "ws://127.0.0.1:1/devtools/browser/x" } },
      [`${API}/browser/close`]: { success: true }
    },
    async (calls) => {
      const session = await new BitBrowserProvider(API).openProfile({
        profileId: "profile-2",
        proxy: null,
        logger: silentLogger()
      });
      await session.close();

      const closeCall = calls.find((call) => call.url.endsWith("/browser/close"));
      assert.ok(closeCall, "close endpoint must be called");
      assert.deepEqual(closeCall?.body, { id: "profile-2" });
    }
  );
});

test("falls back to /json/version when the response only carries an http address", async () => {
  await withFetch(
    {
      [`${API}/browser/open`]: { success: true, data: { http: "127.0.0.1:60123" } },
      "http://127.0.0.1:60123/json/version": {
        webSocketDebuggerUrl: "ws://127.0.0.1:60123/devtools/browser/from-version"
      }
    },
    async () => {
      const session = await new BitBrowserProvider(API).openProfile({
        profileId: "profile-3",
        proxy: null,
        logger: silentLogger()
      });
      assert.equal(session.kind === "cdp" ? session.wsEndpoint : null, "ws://127.0.0.1:60123/devtools/browser/from-version");
    }
  );
});

test("sends the x-api-key header only when a Local API token is configured", async () => {
  const routes = {
    [`${API}/browser/open`]: { success: true, data: { ws: "ws://127.0.0.1:1/devtools/browser/y" } }
  };

  await withFetch(routes, async (calls) => {
    await new BitBrowserProvider(API, "token-abc").openProfile({
      profileId: "profile-4",
      proxy: null,
      logger: silentLogger()
    });
    assert.equal(calls[0]?.headers["x-api-key"], "token-abc");
  });

  await withFetch(routes, async (calls) => {
    await new BitBrowserProvider(API).openProfile({ profileId: "profile-5", proxy: null, logger: silentLogger() });
    assert.equal(calls[0]?.headers["x-api-key"], undefined);
  });
});

test("a success:false response surfaces the client message", async () => {
  await withFetch(
    { [`${API}/browser/open`]: { success: false, msg: "profile not found" } },
    async () => {
      await assert.rejects(
        () => new BitBrowserProvider(API).openProfile({ profileId: "missing", proxy: null, logger: silentLogger() }),
        /profile not found/
      );
    }
  );
});

test("an unreachable local server names the client and the configured URL", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => new BitBrowserProvider(API).openProfile({ profileId: "p", proxy: null, logger: silentLogger() }),
      /Is the BitBrowser client running/
    );
  } finally {
    globalThis.fetch = original;
  }
});
