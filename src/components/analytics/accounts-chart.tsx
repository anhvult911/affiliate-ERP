"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import type { PerformanceSlice } from "@/lib/data/analytics";

import {
  axisVnd,
  CHART_AXIS_TICK,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
  tooltipVnd
} from "./chart-utils";

/** Top accounts by revenue — one row per account, so horizontal bars scale. */
export function TopAccountsChart({ data }: { data: PerformanceSlice[] }) {
  return (
    <div className="h-56 w-full sm:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 12, left: 0, bottom: 0 }}
          barCategoryGap={10}
        >
          <CartesianGrid horizontal={false} strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            type="number"
            tickFormatter={axisVnd}
            tickLine={false}
            axisLine={false}
            tick={CHART_AXIS_TICK}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={92}
            tickLine={false}
            axisLine={false}
            tick={CHART_AXIS_TICK}
            tickFormatter={(value: string) =>
              value.length > 12 ? `${value.slice(0, 11)}…` : value
            }
          />
          <Tooltip
            formatter={tooltipVnd}
            labelFormatter={(label) => String(label)}
            contentStyle={CHART_TOOLTIP_STYLE}
            labelStyle={CHART_TOOLTIP_LABEL_STYLE}
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
          />
          <Bar
            dataKey="revenue"
            name="Revenue"
            fill="var(--chart-4)"
            radius={[0, 4, 4, 0]}
            maxBarSize={22}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
