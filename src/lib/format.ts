import { formatDistanceToNowStrict } from "date-fns";
import { vi } from "date-fns/locale";

const vnd = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0
});

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function formatVnd(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return vnd.format(value);
}

export function formatCompactVnd(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${compact.format(value)}₫`;
}

export function formatPercent(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(digits)}%`;
}

/** Renders a 0..1 match probability as a percentage badge. */
export function formatMatchScore(score: number | null | undefined) {
  if (score === null || score === undefined) return "—";
  return `${Math.round(score * 100)}%`;
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function formatRelative(value: string | null | undefined) {
  if (!value) return "—";
  return formatDistanceToNowStrict(new Date(value), { locale: vi, addSuffix: true });
}

export function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US").format(value);
}

/** Drops protocol/www/trailing slash so a URL fits on a mobile card. */
export function formatHostname(url: string | null | undefined) {
  if (!url) return "—";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
