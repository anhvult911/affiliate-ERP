import type { WorkerConfig } from "./config.js";

/**
 * Client for the web app's worker API. The payload types mirror the shapes
 * returned by /api/worker/tasks/claim — keep them in step with
 * src/app/api/worker/tasks/claim/route.ts.
 */

export type ClaimedAccount = {
  id: string;
  name: string;
  persona_type: string;
  browser_profile_id: string | null;
  proxy_ip: string | null;
  status: string;
  trust_score: number;
  bio_link_url: string | null;
};

export type ClaimedProduct = {
  id: string;
  name: string;
  price: number | null;
  commission_rate: number | null;
  affiliate_short_link: string;
  reviewImages: string[];
  pros_cons_summary: string | null;
  trackedAffiliateUrl: string;
};

export type ClaimedTask = {
  taskId: string;
  executionMode: "single" | "seeding_2_accounts";
  subIdCode: string | null;
  postUrl: string;
  postContent: string | null;
  postImages: string[];
  comment: string | null;
  attachImage: string | null;
  attempt: number;
  claimWorker: string;
  account: ClaimedAccount | null;
  secondaryAccount: ClaimedAccount | null;
  product: ClaimedProduct | null;
};

export type TaskReport = {
  worker: string;
  status: "completed" | "failed";
  error?: string | null;
  executedAt?: string;
  /** Non-fatal observations the operator should still see. */
  note?: string | null;
  accountStatus?: "cooldown" | "checkpoint";
  cooldownMinutes?: number;
};

export type WarmingSlot = {
  accountId: string;
  accountName: string;
  personaType: string;
  /** What the worker needs to open the account's browser. */
  browserProfileId: string | null;
  proxyIp: string | null;
  kind: "lifestyle_post" | "cross_warm" | "profile_setup";
  scheduledAt: string;
  content: string;
  targetAccountId: string | null;
  targetAccountName: string | null;
  targetPostUrl: string | null;
};

export type WarmingReport = {
  accountId: string;
  kind: "lifestyle_post" | "cross_warm" | "profile_setup";
  /** profile_setup only: which assets were applied (bio travels as `content`). */
  avatarSet?: boolean;
  coverSet?: boolean;
  bioSet?: boolean;
  /** Set by the worker when it drove the local fixture rather than the platform. */
  sandbox?: boolean;
  status: "completed" | "failed";
  content?: string | null;
  postUrl?: string | null;
  targetAccountId?: string | null;
  targetPostUrl?: string | null;
  error?: string | null;
  executedAt?: string;
  accountStatus?: "cooldown" | "checkpoint";
  cooldownMinutes?: number;
};

export type AccountCredentials = {
  id: string;
  name: string;
  platform: string;
  identifier: string;
  password: string;
  totp: { code: string; secondsRemaining: number } | null;
  proxy: { host: string; port: number | null; username: string | null; password: string | null } | null;
};

export type ScanAccount = {
  id: string;
  name: string;
  browser_profile_id: string | null;
  proxy_ip: string | null;
};

export type RadarSource = {
  id: string;
  name: string;
  url: string;
  source_type: string;
  niche: string | null;
  scan_interval_mins: number;
  last_scanned_at: string | null;
};

export type RadarIngestResult = {
  ok: boolean;
  created: boolean;
  duplicate?: boolean;
  belowThreshold?: boolean;
  taskId?: string;
  score?: number;
  reason?: string;
  drafted?: boolean;
  error?: string;
};

export class WorkerApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "WorkerApiError";
  }
}

const REQUEST_TIMEOUT_MS = 30_000;

export class WorkerApi {
  constructor(private readonly config: WorkerConfig) {}

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.config.appUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.config.apiToken}`,
        "content-type": "application/json",
        ...(init.headers ?? {})
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    const text = await response.text();
    let body: unknown = null;
    try {
      body = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    if (!response.ok) {
      const message =
        typeof body === "object" && body !== null && "error" in body
          ? String(body.error)
          : `HTTP ${response.status}`;
      throw new WorkerApiError(message, response.status);
    }

    return body as T;
  }

  /** Atomically claims up to `limit` queued tasks (the app side uses SKIP LOCKED). */
  async claim(limit: number): Promise<ClaimedTask[]> {
    const body = await this.request<{ ok: boolean; tasks: ClaimedTask[] }>("/api/worker/tasks/claim", {
      method: "POST",
      body: JSON.stringify({ worker: this.config.workerName, limit })
    });

    return body.tasks ?? [];
  }

  async report(taskId: string, report: Omit<TaskReport, "worker">): Promise<void> {
    await this.request(`/api/worker/tasks/${taskId}/report`, {
      method: "POST",
      body: JSON.stringify({ worker: this.config.workerName, ...report })
    });
  }

  /**
   * Login material for one account: password, a TOTP code valid right now, and the
   * proxy parts. Use it to sign a profile in when it has no live session.
   */
  async credentials(accountId: string): Promise<AccountCredentials> {
    const body = await this.request<{ ok: boolean; account: AccountCredentials }>(
      `/api/worker/accounts/${accountId}/credentials`,
      { method: "GET" }
    );

    return body.account;
  }

  /** Accounts the radar may browse with (healthiest first). */
  async scanAccounts(limit: number): Promise<ScanAccount[]> {
    const body = await this.request<{ ok: boolean; accounts: ScanAccount[] }>(
      `/api/worker/accounts/scan?limit=${limit}`,
      { method: "GET" }
    );

    return body.accounts ?? [];
  }

  /** Watchlist entries whose scan interval has elapsed. */
  async radarSources(limit: number): Promise<RadarSource[]> {
    const body = await this.request<{ ok: boolean; sources: RadarSource[] }>(
      `/api/worker/radar/sources?limit=${limit}`,
      { method: "GET" }
    );

    return body.sources ?? [];
  }

  /**
   * Hands one scraped post to the app, which owns matching, de-duplication and
   * queueing. `productId` pins a product and skips the AI match (used when no
   * GEMINI_API_KEY is configured).
   */
  async radarIngest(input: {
    sourceId: string;
    postUrl: string;
    postContent: string;
    postImages: string[];
    productId?: string;
    draft?: boolean;
  }): Promise<RadarIngestResult> {
    return this.request<RadarIngestResult>("/api/worker/radar/ingest", {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  /** Marks a source scanned so an empty or fully-duplicated scan still advances. */
  async radarScanned(sourceId: string, postsSeen: number): Promise<void> {
    await this.request<{ ok: boolean }>("/api/worker/radar/scanned", {
      method: "POST",
      body: JSON.stringify({ sourceId, postsSeen })
    });
  }

  /** Registers this process with the app so /api/cron/health can notice it stopping. */
  async heartbeat(input: { host?: string; mode?: string }): Promise<void> {
    await this.request("/api/worker/heartbeat", {
      method: "POST",
      body: JSON.stringify({ worker: this.config.workerName, ...input })
    });
  }

  /** Persona-warming work that is due right now (schedule + cross-warm targeting). */
  async dueWarming(): Promise<WarmingSlot[]> {
    const body = await this.request<{ ok: boolean; slots: WarmingSlot[] }>("/api/worker/warming/due", {
      method: "GET"
    });

    return body.slots ?? [];
  }

  async reportWarming(report: WarmingReport): Promise<{ trustScore: number | null }> {
    return this.request<{ ok: boolean; trustScore: number | null }>("/api/worker/warming/report", {
      method: "POST",
      body: JSON.stringify(report)
    });
  }
}
