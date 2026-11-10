import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { mkdirSync } from "node:fs";

import { defaultEnvPaths, findRepoRoot, loadEnvFiles } from "../workers/src/env.js";

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

test("a directory named .env.local is skipped, not fatal", () => {
  const dir = makeProject({});
  mkdirSync(join(dir, ".env.local"), { recursive: true });

  try {
    assert.deepEqual(loadEnvFiles([join(dir, ".env.local")]), []);
  } finally {
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
  // Built with join() rather than POSIX literals: on Windows the same four candidates are
  // "\repo\.env.local", so a hardcoded "/repo/..." array asserted the separator, not the
  // behaviour. join() on the same input — not resolve(), which would prepend a drive letter
  // and make the expectation disagree with the code on Windows.
  const root = "/repo";
  assert.deepEqual(defaultEnvPaths("/repo"), [
    join(root, ".env.local"),
    join(root, ".env"),
    join(root, "workers", ".env.local"),
    join(root, "workers", ".env")
  ]);
});

test("running from workers/ still finds the root .env.local (pnpm --filter cwd)", () => {
  const dir = makeProject({});
  mkdirSync(join(dir, "workers"), { recursive: true });
  writeFileSync(join(dir, "pnpm-workspace.yaml"), "packages:\n  - workers\n");
  writeFileSync(join(dir, ".env.local"), "WORKER_API_TOKEN=from-root\n");
  writeFileSync(join(dir, "workers", "package.json"), '{"name":"affiliate-worker"}');

  try {
    assert.equal(findRepoRoot(join(dir, "workers")), dir);

    const paths = defaultEnvPaths(join(dir, "workers"));
    assert.equal(paths[0], join(dir, ".env.local"));

    delete process.env.WORKER_API_TOKEN;
    loadEnvFiles(paths);
    assert.equal(process.env.WORKER_API_TOKEN, "from-root");
  } finally {
    delete process.env.WORKER_API_TOKEN;
    rmSync(dir, { recursive: true, force: true });
  }
});
