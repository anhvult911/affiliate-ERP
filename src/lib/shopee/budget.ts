import { readShopeeConfig } from "@/lib/shopee/config";

/**
 * Per-run request budget for the Shopee jobs (docs/TASKS.md T-SHOPEE-10 / T-SHOPEE-13).
 *
 * Shopee does not publish its rate limit, only the `10030` code, so the safe design is
 * to bound every run explicitly: a run may make at most `SHOPEE_MAX_REQUESTS_PER_RUN`
 * calls and then stops, leaving the remainder for the next cron tick. That is what
 * keeps a 30-minute schedule from turning into a hot loop when a page fails.
 *
 * Kept separate from the HTTP client so the budget can be asserted without a transport.
 */

export class RequestBudgetExceededError extends Error {
  constructor(limit: number) {
    super(
      `Shopee request budget exhausted for this run (${limit} calls). ` +
        "The next cron tick continues from the watermark; raise SHOPEE_MAX_REQUESTS_PER_RUN only with a real limit in hand."
    );
    this.name = "RequestBudgetExceededError";
  }
}

export type RequestBudget = {
  /** Throws when the ceiling is reached; call before each request. */
  spend(): void;
  readonly used: number;
  readonly limit: number;
  readonly remaining: number;
};

export function createRequestBudget(limit: number): RequestBudget {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`Request budget must be a positive integer, got ${limit}.`);
  }

  let used = 0;

  return {
    spend() {
      if (used >= limit) throw new RequestBudgetExceededError(limit);
      used += 1;
    },
    get used() {
      return used;
    },
    get limit() {
      return limit;
    },
    get remaining() {
      return limit - used;
    }
  };
}

/**
 * Recommended cadence, with the reason attached so a future change has to argue with
 * it. `path` is the cron route once the job exists — T-SHOPEE-07/08 add the conversion
 * and validated routes, T-SHOPEE-04 the product sync.
 */
export const SHOPEE_JOBS = [
  {
    job: "conversions",
    path: "/api/cron/shopee/conversions",
    everyMinutes: 60,
    maxRequestsPerRun: 20,
    reason:
      "Reports lag behind the sale; hourly is enough to keep attribution tight without polling harder than the limit allows."
  },
  {
    job: "products",
    path: "/api/cron/shopee/products",
    everyMinutes: 360,
    maxRequestsPerRun: 10,
    reason: "Offer catalogues change slowly; 6 hours keeps commission rates fresh with a handful of calls."
  },
  {
    job: "validated",
    path: "/api/cron/shopee/validated",
    everyMinutes: 1_440,
    maxRequestsPerRun: 10,
    reason: "Shopee settles billing daily; one pull per day is enough to move conversions to settled."
  }
] as const;

export type ShopeeJob = (typeof SHOPEE_JOBS)[number];

export function shopeeJob(job: ShopeeJob["job"]): ShopeeJob {
  const found = SHOPEE_JOBS.find((entry) => entry.job === job);
  if (!found) throw new Error(`Unknown Shopee job "${job}".`);
  return found;
}

/** Budget for a run of `job`, honouring the configured ceiling if it is lower. */
export function budgetForRun(job: ShopeeJob["job"]): RequestBudget {
  const configured = readShopeeConfig().maxRequestsPerRun;
  return createRequestBudget(Math.min(configured, shopeeJob(job).maxRequestsPerRun));
}
