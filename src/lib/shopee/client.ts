import { createHash } from "node:crypto";

import type { ShopeeConfig } from "@/lib/shopee/config";

/**
 * Shopee Affiliate GraphQL client.
 *
 * The API is stateless: every request carries
 *
 *   Authorization: SHA256 Credential={appId}, Timestamp={unixSeconds}, Signature={sig}
 *
 * where `sig = hex(SHA256(appId + timestamp + body + secret))` and `body` is the exact
 * JSON string that is sent. There is no separator and no HMAC key, despite some
 * secondary sources calling it "HMAC-SHA256" — docs/SHOPEE_API.md §3 records that the
 * formula is the verified part, not the name.
 *
 * Two consequences shape this module:
 *   - the body is serialised **once** and both signed and sent, so the bytes cannot
 *     drift between signing and transport;
 *   - errors are typed by Shopee's `extensions.code` (10020/10030/10035), because
 *     those three need completely different handling: fix the clock/secret, back off,
 *     or stop and request access.
 */

export type ShopeeTransportRequest = {
  endpoint: string;
  body: string;
  headers: Record<string, string>;
  timeoutMs: number;
};

export type ShopeeTransportResponse = {
  status: number;
  /** Raw text, so a non-JSON body produces a useful error instead of a parse crash. */
  text: string;
};

/** Injectable so tests never touch the network. */
export type ShopeeTransport = (request: ShopeeTransportRequest) => Promise<ShopeeTransportResponse>;

export class ShopeeError extends Error {
  constructor(
    message: string,
    readonly code: number | null = null
  ) {
    super(message);
    this.name = "ShopeeError";
  }
}

/** 10020 — signature / timestamp / credential wrong, or the App is disabled. */
export class ShopeeAuthError extends ShopeeError {
  constructor(message: string, code: number | null = 10020) {
    super(message, code);
    this.name = "ShopeeAuthError";
  }
}

/** 10030 or HTTP 429 — the run must stop and resume on the next cron tick. */
export class ShopeeRateLimitError extends ShopeeError {
  constructor(message: string, code: number | null = 10030) {
    super(message, code);
    this.name = "ShopeeRateLimitError";
  }
}

/** 10035 — the publisher has not been granted Open API access yet. */
export class ShopeeAccessError extends ShopeeError {
  constructor(message: string, code: number | null = 10035) {
    super(message, code);
    this.name = "ShopeeAccessError";
  }
}

/** 10000 / 5xx / network — retryable with backoff. */
export class ShopeeTransientError extends ShopeeError {
  constructor(message: string, code: number | null = null) {
    super(message, code);
    this.name = "ShopeeTransientError";
  }
}

/** Anything else: a query bug, bad params, an unknown failure. Do not retry. */
export class ShopeeRequestError extends ShopeeError {
  constructor(message: string, code: number | null = null) {
    super(message, code);
    this.name = "ShopeeRequestError";
  }
}

/**
 * `hex(SHA256(appId + timestampSeconds + body + secret))`.
 *
 * Exported separately from the client because it is the one piece worth testing
 * against a fixed vector.
 */
export function signShopeeRequest(input: {
  appId: string;
  timestampSeconds: number;
  body: string;
  secret: string;
}): string {
  return createHash("sha256")
    .update(`${input.appId}${input.timestampSeconds}${input.body}${input.secret}`, "utf8")
    .digest("hex");
}

/** The exact header the API expects. */
export function buildAuthorizationHeader(input: {
  appId: string;
  timestampSeconds: number;
  signature: string;
}): string {
  return `SHA256 Credential=${input.appId}, Timestamp=${input.timestampSeconds}, Signature=${input.signature}`;
}

type GraphQLErrorShape = {
  message?: string;
  extensions?: { code?: number } | null;
};

function classify(code: number | null, message: string): ShopeeError {
  switch (code) {
    case 10020:
      return new ShopeeAuthError(
        `Shopee rejected the signature/timestamp/credential (10020). Check the server clock and SHOPEE_AFFILIATE_APP_SECRET. ${message}`,
        code
      );
    case 10030:
      return new ShopeeRateLimitError(`Shopee rate limit reached (10030). Stop this run. ${message}`, code);
    case 10035:
      return new ShopeeAccessError(
        `This publisher does not have Shopee Affiliate Open API access yet (10035). Request it from the affiliate dashboard. ${message}`,
        code
      );
    case 10000:
      return new ShopeeTransientError(`Shopee system error (10000). ${message}`, code);
    case 11000:
    case 11001:
    case 11002:
      return new ShopeeRequestError(`Shopee business/params error (${code}). ${message}`, code);
    case 10010:
      return new ShopeeRequestError(`Shopee could not parse the query (10010). ${message}`, code);
    default:
      return new ShopeeRequestError(
        code === null ? message : `Shopee error ${code}: ${message}`,
        code
      );
  }
}

function readErrorCode(errors: GraphQLErrorShape[]): number | null {
  for (const error of errors) {
    const code = error.extensions?.code;
    if (typeof code === "number") return code;
  }
  return null;
}

export type ShopeeClientOptions = {
  transport?: ShopeeTransport;
  /** Injectable clock (milliseconds). Tests pass a fixed instant. */
  now?: () => number;
};

export class ShopeeClient {
  private readonly transport: ShopeeTransport;
  private readonly now: () => number;

  constructor(
    private readonly config: ShopeeConfig,
    options: ShopeeClientOptions = {}
  ) {
    this.transport = options.transport ?? defaultTransport;
    this.now = options.now ?? Date.now;
  }

  /**
   * Runs one GraphQL operation and returns `data`.
   *
   * `data` and `errors` can arrive together; any error means the payload is
   * incomplete, so callers never see a partial result.
   */
  async query<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const body = variables ? JSON.stringify({ query, variables }) : JSON.stringify({ query });
    const timestampSeconds = Math.floor(this.now() / 1000);
    const signature = signShopeeRequest({
      appId: this.config.appId,
      timestampSeconds,
      body,
      secret: this.config.secret
    });

    const response = await this.transport({
      endpoint: this.config.endpoint,
      body,
      headers: {
        "content-type": "application/json",
        authorization: buildAuthorizationHeader({
          appId: this.config.appId,
          timestampSeconds,
          signature
        })
      },
      timeoutMs: this.config.timeoutMs
    });

    if (response.status === 429) {
      throw new ShopeeRateLimitError("Shopee returned HTTP 429. Stop this run.", 10030);
    }
    if (response.status >= 500) {
      throw new ShopeeTransientError(`Shopee returned HTTP ${response.status}.`, null);
    }
    if (response.status === 401 || response.status === 403) {
      throw new ShopeeAuthError(
        `Shopee returned HTTP ${response.status} — credential rejected or not permitted.`
      );
    }

    let parsed: { data?: T; errors?: GraphQLErrorShape[] };
    try {
      parsed = JSON.parse(response.text) as typeof parsed;
    } catch {
      throw new ShopeeRequestError(
        `Shopee returned HTTP ${response.status} with a non-JSON body: ${response.text.slice(0, 200)}`
      );
    }

    const errors = parsed.errors ?? [];
    if (errors.length > 0) {
      const message = errors[0]?.message ?? "no message";
      throw classify(readErrorCode(errors), message);
    }

    if (parsed.data === undefined) {
      throw new ShopeeRequestError("Shopee returned neither data nor errors.");
    }

    return parsed.data;
  }
}

const defaultTransport: ShopeeTransport = async ({ endpoint, body, headers, timeoutMs }) => {
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs)
  });

  return { status: response.status, text: await response.text() };
};
