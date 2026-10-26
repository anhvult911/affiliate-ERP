import assert from "node:assert/strict";
import test from "node:test";

import { assertPostingAllowed } from "../workers/src/config";

const LOCAL_REAL = {
  dryRun: false,
  provider: "local" as const,
  executor: "facebook" as const,
  allowLocalPosting: false
};

test("a real post with the local provider is refused by default", () => {
  assert.throws(
    () => assertPostingAllowed(LOCAL_REAL),
    /Refusing to post for real with ANTIDETECT_PROVIDER=local/
  );
});

test("ALLOW_LOCAL_POSTING=true is the explicit opt-in", () => {
  assert.doesNotThrow(() => assertPostingAllowed({ ...LOCAL_REAL, allowLocalPosting: true }));
});

test("dry-run never needs the opt-in", () => {
  assert.doesNotThrow(() => assertPostingAllowed({ ...LOCAL_REAL, dryRun: true }));
});

test("the fixture executor is exempt — it posts to a local page", () => {
  assert.doesNotThrow(() => assertPostingAllowed({ ...LOCAL_REAL, executor: "fixture" }));
});

test("a fingerprint provider may post for real", () => {
  assert.doesNotThrow(() => assertPostingAllowed({ ...LOCAL_REAL, provider: "gpm" }));
  assert.doesNotThrow(() => assertPostingAllowed({ ...LOCAL_REAL, provider: "genlogin" }));
});

test("the error message says what to do about it", () => {
  const error = (() => {
    try {
      assertPostingAllowed(LOCAL_REAL);
      return null;
    } catch (caught) {
      return caught as Error;
    }
  })();

  assert.ok(error);
  assert.match(error.message, /ALLOW_LOCAL_POSTING=true/);
  assert.match(error.message, /gpm\/genlogin|fingerprint/);
});
