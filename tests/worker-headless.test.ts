import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../workers/src/config";
import { LocalProfileProvider } from "../workers/src/providers/local";

/**
 * A VPS has no display. Before this, the persistent provider hardcoded
 * `headless: false`, so a container without X would fail at launch — the tests below
 * pin the contract that fixed it.
 */

function withEnv<T>(values: Record<string, string | undefined>, run: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const BASE = { WORKER_API_TOKEN: "test-token", BROWSER_HEADLESS: undefined, ANTIDETECT_PROVIDER: undefined };

test("the worker defaults to headless, so a server can launch it", () => {
  withEnv(BASE, () => {
    const config = loadConfig();
    assert.equal(config.browserHeadless, true);
  });
});

test("BROWSER_HEADLESS=false is still available for a desktop run", () => {
  withEnv({ ...BASE, BROWSER_HEADLESS: "false" }, () => {
    assert.equal(loadConfig().browserHeadless, false);
  });
});

test("the local provider carries the headless flag into the session", async () => {
  const provider = new LocalProfileProvider("./.profiles-test", "", true);
  const session = await provider.openProfile({
    profileId: "demo-account",
    proxy: null,
    logger: { debug() {}, info() {}, warn() {}, error() {}, child() { return this; } } as never
  });

  assert.equal(session.kind, "persistent");
  assert.equal(session.kind === "persistent" ? session.headless : null, true);

  await session.close();
});

test("GPM's local API defaults to the documented port", () => {
  withEnv({ ...BASE, GPM_API_URL: undefined }, () => {
    assert.equal(loadConfig().gpmApiUrl, "http://127.0.0.1:9495");
  });
});
