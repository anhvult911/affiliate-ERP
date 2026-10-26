import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_GEMINI_MODEL,
  readEmbeddingModel,
  readGeminiModel
} from "@/lib/ai/gemini";

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

test("unset variables fall back to the defaults", () => {
  withEnv({ GEMINI_MODEL: undefined, GEMINI_EMBEDDING_MODEL: undefined }, () => {
    assert.equal(readGeminiModel(), DEFAULT_GEMINI_MODEL);
    assert.equal(readEmbeddingModel(), DEFAULT_EMBEDDING_MODEL);
  });
});

test("a retired generation model is rejected with the replacement named", () => {
  withEnv({ GEMINI_MODEL: "gemini-2.5-flash" }, () => {
    assert.throws(() => readGeminiModel(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /GEMINI_MODEL="gemini-2\.5-flash"/);
      assert.match(error.message, /retired/);
      assert.ok(error.message.includes(DEFAULT_GEMINI_MODEL));
      return true;
    });
  });
});

test("a retired embedding model is rejected", () => {
  withEnv({ GEMINI_EMBEDDING_MODEL: "text-embedding-004" }, () => {
    assert.throws(() => readEmbeddingModel(), /text-embedding-004.*retired/s);
  });
});

test("a current model passes through untouched", () => {
  withEnv({ GEMINI_MODEL: "gemini-3.8-flash", GEMINI_EMBEDDING_MODEL: "gemini-embedding-001" }, () => {
    assert.equal(readGeminiModel(), "gemini-3.8-flash");
    assert.equal(readEmbeddingModel(), "gemini-embedding-001");
  });
});
