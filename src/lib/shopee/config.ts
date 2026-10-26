/**
 * Shopee Affiliate Open API configuration.
 *
 * Two rules from docs/SHOPEE_API.md §3 that shape this module:
 *
 * 1. The credential is a per-publisher App ID + Secret pair used to sign every
 *    request. There is no OAuth token to refresh, so a missing or malformed pair is
 *    a configuration error that must fail before any request is built — a silent
 *    fallback would surface as an opaque `10020` from Shopee.
 * 2. The secret must never reach a log, a Telegram alert or an error message. Every
 *    error this module throws names the *variable*, never the value.
 */

/** Regional GraphQL endpoints. Vietnam is the only one this deployment uses. */
export const SHOPEE_ENDPOINTS = {
  vn: "https://open-api.affiliate.shopee.vn/graphql",
  br: "https://open-api.affiliate.shopee.com.br/graphql",
  sg: "https://open-api.affiliate.shopee.sg/graphql",
  my: "https://open-api.affiliate.shopee.com.my/graphql",
  id: "https://open-api.affiliate.shopee.co.id/graphql",
  th: "https://open-api.affiliate.shopee.co.th/graphql",
  ph: "https://open-api.affiliate.shopee.ph/graphql",
  tw: "https://open-api.affiliate.shopee.tw/graphql"
} as const;

export type ShopeeRegion = keyof typeof SHOPEE_ENDPOINTS;

export type ShopeeConfig = {
  /** Numeric App ID from the affiliate dashboard → Open API. */
  appId: string;
  /** App Secret. Never log this field. */
  secret: string;
  endpoint: string;
  /** Per-request timeout; Shopee reports are slow, offers are not. */
  timeoutMs: number;
  /** Hard ceiling of requests one cron run may make (see T-SHOPEE-13). */
  maxRequestsPerRun: number;
};

export class ShopeeNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(
      `Shopee Affiliate API is not configured: set ${missing.join(", ")}. ` +
        "Credentials come from the affiliate dashboard → Open API; access must be granted first " +
        "(error 10035 means the request is not enabled yet)."
    );
    this.name = "ShopeeNotConfiguredError";
  }
}

const DEFAULT_REGION: ShopeeRegion = "vn";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REQUESTS = 20;

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function resolveEndpoint(): string {
  const explicit = process.env.SHOPEE_AFFILIATE_ENDPOINT?.trim();
  if (explicit) return explicit;

  const region = (process.env.SHOPEE_AFFILIATE_REGION?.trim().toLowerCase() ?? DEFAULT_REGION) as ShopeeRegion;
  return SHOPEE_ENDPOINTS[region] ?? SHOPEE_ENDPOINTS[DEFAULT_REGION];
}

export function isShopeeConfigured(): boolean {
  return Boolean(
    process.env.SHOPEE_AFFILIATE_APP_ID?.trim() && process.env.SHOPEE_AFFILIATE_APP_SECRET?.trim()
  );
}

/**
 * Reads the configuration or throws. Callers that run on a schedule should call
 * `isShopeeConfigured()` first so an unconfigured deployment stays quiet instead of
 * filling the logs with the same error every cycle.
 */
export function readShopeeConfig(): ShopeeConfig {
  const appId = process.env.SHOPEE_AFFILIATE_APP_ID?.trim() ?? "";
  const secret = process.env.SHOPEE_AFFILIATE_APP_SECRET?.trim() ?? "";

  const missing: string[] = [];
  if (!appId) missing.push("SHOPEE_AFFILIATE_APP_ID");
  if (!secret) missing.push("SHOPEE_AFFILIATE_APP_SECRET");
  if (missing.length > 0) throw new ShopeeNotConfiguredError(missing);

  if (!/^\d+$/.test(appId)) {
    throw new ShopeeNotConfiguredError(["SHOPEE_AFFILIATE_APP_ID (must be the numeric App ID)"]);
  }

  return {
    appId,
    secret,
    endpoint: resolveEndpoint(),
    timeoutMs: readPositiveInt("SHOPEE_AFFILIATE_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
    maxRequestsPerRun: readPositiveInt("SHOPEE_MAX_REQUESTS_PER_RUN", DEFAULT_MAX_REQUESTS)
  };
}

/** Safe representation for logs: the App ID is not a secret, the secret never appears. */
export function describeShopeeConfig(config: ShopeeConfig): Record<string, string | number> {
  return {
    appId: config.appId,
    endpoint: config.endpoint,
    timeoutMs: config.timeoutMs,
    maxRequestsPerRun: config.maxRequestsPerRun
  };
}
