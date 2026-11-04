import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { defaultEnvPaths, loadEnvFiles } from "../workers/src/env.js";

function makeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "worker-env-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

test("loads .env.local so the worker sees BITBROWSER_API_KEY", () => {
  const dir = makeProject({ ".env.local": "BITBROWSER_API_KEY=from-file\nANTIDETECT_PROVIDER=bitbrowser\n" });
  delete process.env.BITBROWSER_API_KEY;
  delete process.env.ANTIDETECT_PROVIDER;

  try {
    const loaded = loadEnvFiles([join(dir, ".env.local")]);
    assert.equal(loaded.length, 1);
    assert.equal(process.env.BITBROWSER_API_KEY, "from-file");
    assert.equal(process.env.ANTIDETECT_PROVIDER, "bitbrowser");
  } finally {
    delete process.env.BITBROWSER_API_KEY;
    delete process.env.ANTIDETECT_PROVIDER;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a shell export wins over the file (Next.js precedence)", () => {
  const dir = makeProject({ ".env.local": "WORKER_NAME=from-file\n" });
  process.env.WORKER_NAME = "from-shell";

  try {
    loadEnvFiles([join(dir, ".env.local")]);
    assert.equal(process.env.WORKER_NAME, "from-shell");
  } finally {
    delete process.env.WORKER_NAME;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing files are skipped instead of throwing", () => {
  const dir = makeProject({});
  try {
    assert.deepEqual(loadEnvFiles([join(dir, ".env.local"), join(dir, "nope.env")]), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("default lookup covers the repo root and workers/ directories", () => {
  const paths = defaultEnvPaths("/repo");
  assert.deepEqual(paths, [
    "/repo/.env.local",
    "/repo/.env",
    "/repo/workers/.env.local",
    "/repo/workers/.env"
  ]);
});
