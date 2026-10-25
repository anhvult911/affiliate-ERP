"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import type { RevenuePoint } from "@/lib/data/analytics";

import {
  axisVnd,
  CHART_AXIS_TICK,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
  tooltipVnd
} from "./chart-utils";

export function RevenueChart({ data }: { data: RevenuePoint[] }) {
  // An area with one datum has no path; force a dot so an all-time window with
  // a single revenue day is still visible.
  const singlePoint = data.length === 1;

  return (
    <div className="h-56 w-full sm:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="analytics-revenue-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.35} />
              <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="date"
            tickFormatter={(value: string) => value.slice(5).replace("-", "/")}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
            tick={CHART_AXIS_TICK}
          />
          <YAxis
            tickFormatter={axisVnd}
            tickLine={false}
            axisLine={false}
            width={48}
            tick={CHART_AXIS_TICK}
          />
          <Tooltip
            formatter={tooltipVnd}
            labelFormatter={(label) => String(label)}
            contentStyle={CHART_TOOLTIP_STYLE}
            labelStyle={CHART_TOOLTIP_LABEL_STYLE}
            cursor={{ stroke: "var(--border)" }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area
            type="monotone"
            dataKey="revenue"
            name="Revenue"
            stroke="var(--chart-1)"
            fill="url(#analytics-revenue-fill)"
            strokeWidth={2}
            dot={singlePoint ? { r: 3, fill: "var(--chart-1)", stroke: "var(--chart-1)" } : false}
            activeDot={{ r: 3 }}
          />
          <Area
            type="monotone"
            dataKey="commission"
            name="Commission"
            stroke="var(--chart-2)"
            fill="var(--chart-2)"
            fillOpacity={0.08}
            strokeWidth={2}
            dot={singlePoint ? { r: 3, fill: "var(--chart-2)", stroke: "var(--chart-2)" } : false}
            activeDot={{ r: 3 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
