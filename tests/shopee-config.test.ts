import assert from "node:assert/strict";
import test from "node:test";

import {
  describeShopeeConfig,
  isShopeeConfigured,
  readShopeeConfig,
  ShopeeNotConfiguredError
} from "@/lib/shopee/config";

const SECRET = "test-secret-value";

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

const BASE = {
  SHOPEE_AFFILIATE_APP_ID: undefined,
  SHOPEE_AFFILIATE_APP_SECRET: undefined,
  SHOPEE_AFFILIATE_REGION: undefined,
  SHOPEE_AFFILIATE_ENDPOINT: undefined,
  SHOPEE_AFFILIATE_TIMEOUT_MS: undefined,
  SHOPEE_MAX_REQUESTS_PER_RUN: undefined
};

test("missing credentials fail before any request is built", () => {
  withEnv({ ...BASE }, () => {
    assert.equal(isShopeeConfigured(), false);
    assert.throws(() => readShopeeConfig(), (error: unknown) => {
      assert.ok(error instanceof ShopeeNotConfiguredError);
      assert.match(error.message, /SHOPEE_AFFILIATE_APP_ID/);
      assert.match(error.message, /SHOPEE_AFFILIATE_APP_SECRET/);
      return true;
    });
  });
});

test("a non-numeric App ID is rejected instead of being signed", () => {
  withEnv({ ...BASE, SHOPEE_AFFILIATE_APP_ID: "abc", SHOPEE_AFFILIATE_APP_SECRET: SECRET }, () => {
    assert.throws(() => readShopeeConfig(), /numeric App ID/);
  });
});

test("the configured values are read, region defaults to VN", () => {
  withEnv({ ...BASE, SHOPEE_AFFILIATE_APP_ID: "1234567890", SHOPEE_AFFILIATE_APP_SECRET: SECRET }, () => {
    const config = readShopeeConfig();
    assert.equal(config.appId, "1234567890");
    assert.equal(config.endpoint, "https://open-api.affiliate.shopee.vn/graphql");
    assert.equal(config.timeoutMs, 15_000);
    assert.equal(config.maxRequestsPerRun, 20);
  });
});

test("region and an explicit endpoint override the default", () => {
  withEnv(
    { ...BASE, SHOPEE_AFFILIATE_APP_ID: "1", SHOPEE_AFFILIATE_APP_SECRET: SECRET, SHOPEE_AFFILIATE_REGION: "th" },
    () => {
      assert.equal(readShopeeConfig().endpoint, "https://open-api.affiliate.shopee.co.th/graphql");
    }
  );

  withEnv(
    {
      ...BASE,
      SHOPEE_AFFILIATE_APP_ID: "1",
      SHOPEE_AFFILIATE_APP_SECRET: SECRET,
      SHOPEE_AFFILIATE_ENDPOINT: "https://example.test/graphql"
    },
    () => {
      assert.equal(readShopeeConfig().endpoint, "https://example.test/graphql");
    }
  );
});

test("the described config never contains the secret", () => {
  withEnv({ ...BASE, SHOPEE_AFFILIATE_APP_ID: "1234567890", SHOPEE_AFFILIATE_APP_SECRET: SECRET }, () => {
    const described = JSON.stringify(describeShopeeConfig(readShopeeConfig()));
    assert.ok(!described.includes(SECRET));
    assert.match(described, /1234567890/);
  });
});
