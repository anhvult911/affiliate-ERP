import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { isPlaceholderValue, loadScriptEnv, LOCAL_ENV_FILES, PRODUCTION_ENV_FILES } from "../scripts/lib/env";

function tempEnv(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "env-test-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content, "utf8");
  return dir;
}

test("file order is precedence: the first file wins", () => {
  const dir = tempEnv({ "a.env": "KEY=first\nONLY_A=1\n", "b.env": "KEY=second\nONLY_B=2\n" });
  const env: Record<string, string | undefined> = {};

  const result = loadScriptEnv([join(dir, "a.env"), join(dir, "b.env")], env);

  assert.equal(env.KEY, "first");
  assert.equal(env.ONLY_B, "2");
  assert.deepEqual(result.sources.get("KEY"), join(dir, "a.env"));
});

test("an explicit environment variable beats every file", () => {
  const dir = tempEnv({ "a.env": "KEY=file\n" });
  const env: Record<string, string | undefined> = { KEY: "shell" };

  loadScriptEnv([join(dir, "a.env")], env);

  assert.equal(env.KEY, "shell");
});

test("quotes, inline comments and blank lines are handled", () => {
  const dir = tempEnv({
    "a.env": ['# comment', '', 'A="quoted value"', "B=plain # trailing comment", "C='single'"].join("\n")
  });
  const env: Record<string, string | undefined> = {};

  loadScriptEnv([join(dir, "a.env")], env);

  assert.equal(env.A, "quoted value");
  assert.equal(env.B, "plain");
  assert.equal(env.C, "single");
});

test("missing files are skipped, not fatal", () => {
  const env: Record<string, string | undefined> = {};
  const result = loadScriptEnv([join(tmpdir(), "definitely-not-here.env")], env);
  assert.deepEqual(result.files, []);
});

test("the local profile prefers .env.local and the production profile the reverse", () => {
  assert.equal(LOCAL_ENV_FILES[0], ".env.local");
  assert.equal(PRODUCTION_ENV_FILES[0], ".env.production");
});

test("shipped placeholders are recognisable", () => {
  for (const value of [
    "your-gemini-api-key",
    "change-me-worker-bearer-token",
    "123456:replace-me",
    "replace-me",
    ""
  ]) {
    assert.equal(isPlaceholderValue(value), true, `${value} should be a placeholder`);
  }

  assert.equal(isPlaceholderValue("AQ.Ab8RN6KsgIUyXWtX"), false);
  assert.equal(isPlaceholderValue("435400241"), false);
});
