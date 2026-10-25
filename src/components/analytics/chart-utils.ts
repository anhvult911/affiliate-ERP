import { formatVnd } from "@/lib/format";

/**
 * Shared recharts styling. Colours come from the CSS chart tokens so the charts
 * follow the light/dark theme without a JS theme provider (and without a
 * server/client colour mismatch).
 */
export const CHART_TOOLTIP_STYLE = {
  backgroundColor: "var(--popover)",
  borderColor: "var(--border)",
  borderRadius: "0.5rem",
  color: "var(--popover-foreground)",
  fontSize: 12
} as const;

export const CHART_TOOLTIP_LABEL_STYLE = {
  color: "var(--muted-foreground)"
} as const;

export const CHART_AXIS_TICK = {
  fontSize: 11,
  fill: "var(--muted-foreground)"
} as const;

/** Axis labels stay compact so a 360px chart keeps room for the plot. */
export function axisVnd(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(Math.round(value));
}

/** Tooltip values are full VND amounts; recharts may hand back an array for ranges. */
export function tooltipVnd(value: unknown): string {
  const first = Array.isArray(value) ? value[0] : value;
  const parsed = Number(first);
  return formatVnd(Number.isFinite(parsed) ? parsed : 0);
}
