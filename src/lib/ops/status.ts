/**
 * Status model for the ops board.
 *
 * The board is only useful if every number on it is real, so this module holds the *rules*
 * (what counts as fresh, what a cron's next run is) separately from the queries and the page.
 * That split is what makes the rules testable: a "green" light that lies is worse than no board.
 */

export type OpsTone = "ok" | "warn" | "idle" | "down";

export type OpsStatus = {
  tone: OpsTone;
  label: string;
  detail: string;
};

/**
 * Freshness of a pipeline stage.
 *
 * `staleAfterMins` is the stage's own cadence (a 10-minute health check and a twice-daily poster
 * cannot share one threshold), so the caller always states it.
 */
export function deriveFreshness(args: {
  lastActivityAt: string | null;
  now: Date;
  staleAfterMins: number;
  emptyLabel: string;
}): OpsStatus {
  if (!args.lastActivityAt) {
    return { tone: "idle", label: "chưa chạy", detail: args.emptyLabel };
  }

  const last = new Date(args.lastActivityAt);
  if (Number.isNaN(last.getTime())) {
    return { tone: "idle", label: "chưa rõ", detail: "timestamp không đọc được" };
  }

  const minutes = (args.now.getTime() - last.getTime()) / 60_000;

  // A stage that ran in the future means clock skew between server and worker; say so instead
  // of pretending everything is fine.
  if (minutes < -5) {
    return { tone: "warn", label: "lệch giờ", detail: "timestamp ở tương lai" };
  }

  if (minutes <= args.staleAfterMins) {
    return { tone: "ok", label: "đang chạy", detail: `${Math.round(minutes)} phút trước` };
  }

  return {
    tone: "warn",
    label: "quá hạn",
    detail: `${formatAge(minutes)} trước (hạn ${formatAge(args.staleAfterMins)})`
  };
}

export function formatAge(minutes: number): string {
  if (minutes < 1) return "vừa xong";
  // Hours only once rounding cannot hide the difference: a 90-minute threshold rendered as
  // "2 giờ" reads like the stage is allowed to be twice as stale as it is.
  if (minutes < 180) return `${Math.round(minutes)} phút`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} giờ`;
  return `${Math.round(minutes / (60 * 24))} ngày`;
}

/** One entry per line in /etc/cron.d/affiliate-erp (installed by scripts/install-cron.sh). */
export type CronEntry = {
  name: string;
  label: string;
  path: string;
  cadence:
    | { kind: "every"; minutes: number }
    | { kind: "hourly"; minute: number }
    | { kind: "daily"; minute: number; hours: number[] };
};

export const CRON_ENTRIES: CronEntry[] = [
  { name: "health", label: "Canh worker", path: "/api/cron/health", cadence: { kind: "every", minutes: 10 } },
  { name: "reconcile", label: "Gán lại đơn lỡ", path: "/api/cron/reconcile", cadence: { kind: "every", minutes: 30 } },
  { name: "shopee-products", label: "Đồng bộ sản phẩm Shopee", path: "/api/cron/shopee/products", cadence: { kind: "daily", minute: 0, hours: [0, 6, 12, 18] } },
  { name: "shopee-conversions", label: "Đồng bộ đơn hàng Shopee", path: "/api/cron/shopee/conversions", cadence: { kind: "hourly", minute: 0 } },
  { name: "shopee-validated", label: "Đối soát Shopee", path: "/api/cron/shopee/validated", cadence: { kind: "daily", minute: 0, hours: [18] } },
  { name: "deal-poster", label: "Đăng deal lên kênh", path: "/api/cron/deal-poster", cadence: { kind: "daily", minute: 30, hours: [4, 13] } }
];

/**
 * Next UTC occurrence of a cron entry.
 *
 * The box runs these in UTC while the operator reads them in Vietnam time, so the board shows
 * both — a "11:30" that silently means 18:30 local is how posts get blamed on the wrong hour.
 */
export function nextCronRun(entry: CronEntry, now: Date): Date {
  const cadence = entry.cadence;

  if (cadence.kind === "every") {
    const ms = cadence.minutes * 60_000;
    const sinceEpoch = now.getTime();
    const next = Math.ceil(sinceEpoch / ms) * ms;
    return new Date(next);
  }

  if (cadence.kind === "hourly") {
    const next = new Date(now);
    next.setUTCSeconds(0, 0);
    next.setUTCMinutes(cadence.minute);
    if (next.getTime() <= now.getTime()) next.setUTCHours(next.getUTCHours() + 1);
    return next;
  }

  const candidates = cadence.hours
    .map((hour) => {
      const d = new Date(now);
      d.setUTCSeconds(0, 0);
      d.setUTCHours(hour, cadence.minute, 0, 0);
      return d;
    })
    .sort((a, b) => a.getTime() - b.getTime());

  const upcoming = candidates.find((d) => d.getTime() > now.getTime());
  if (upcoming) return upcoming;

  // Wrap to the first hour tomorrow.
  const first = candidates[0];
  if (!first) {
    const fallback = new Date(now);
    fallback.setUTCDate(fallback.getUTCDate() + 1);
    fallback.setUTCHours(0, 0, 0, 0);
    return fallback;
  }
  const tomorrow = new Date(first);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return tomorrow;
}

/** Vietnam is UTC+7 year round (no DST), so the label needs no timezone database. */
export function formatVietnamTime(date: Date): string {
  const vn = new Date(date.getTime() + 7 * 3_600_000);
  const hh = String(vn.getUTCHours()).padStart(2, "0");
  const mm = String(vn.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
