import type { Metadata } from "next";
import Link from "next/link";
import {
  BotIcon,
  BoxesIcon,
  ClockIcon,
  RadarIcon,
  SendIcon,
  ShieldCheckIcon,
  UsersIcon
} from "lucide-react";

import { PageHeader } from "@/components/patterns/page-header";
import { Card } from "@/components/ui/card";
import { getOpsSnapshot } from "@/lib/data/ops";
import { CRON_ENTRIES, deriveFreshness, formatVietnamTime, nextCronRun, type OpsTone } from "@/lib/ops/status";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Bảng điều hành" };

const toneRing: Record<OpsTone, string> = {
  ok: "border-emerald-500/40 shadow-[0_0_24px_-12px_rgba(16,185,129,0.8)]",
  warn: "border-amber-500/40 shadow-[0_0_24px_-12px_rgba(245,158,11,0.8)]",
  idle: "border-border",
  down: "border-red-500/50 shadow-[0_0_24px_-12px_rgba(239,68,68,0.9)]"
};

const toneDot: Record<OpsTone, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  idle: "bg-muted-foreground",
  down: "bg-red-500"
};

const toneText: Record<OpsTone, string> = {
  ok: "text-emerald-500",
  warn: "text-amber-500",
  idle: "text-muted-foreground",
  down: "text-red-500"
};

function Room({
  title,
  subtitle,
  tone,
  label,
  detail,
  value,
  icon: Icon,
  href
}: {
  title: string;
  subtitle: string;
  tone: OpsTone;
  label: string;
  detail: string;
  value: string;
  icon: typeof RadarIcon;
  href?: string;
}) {
  const body = (
    <Card
      className={cn(
        "h-full gap-3 border bg-[radial-gradient(circle_at_20%_0%,rgba(99,102,241,0.10),transparent_60%)] px-4 py-4 transition-colors",
        toneRing[tone],
        href && "hover:border-indigo-500/60"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-muted-foreground text-xs">{subtitle}</p>
        </div>
        <Icon className={cn("size-4 shrink-0", toneText[tone])} />
      </div>

      <p className="text-2xl font-semibold tabular-nums">{value}</p>

      <div className="flex items-center gap-2 text-xs">
        <span className={cn("size-1.5 rounded-full", toneDot[tone])} />
        <span className={cn("font-medium", toneText[tone])}>{label}</span>
        <span className="text-muted-foreground">· {detail}</span>
      </div>
    </Card>
  );

  return href ? <Link href={href}>{body}</Link> : body;
}

export default async function OpsPage() {
  const snapshot = await getOpsSnapshot();
  const now = new Date();

  const radar = deriveFreshness({
    lastActivityAt: snapshot.targets.lastScannedAt,
    now,
    staleAfterMins: 90,
    emptyLabel: "chưa group nào được quét"
  });
  const deals = deriveFreshness({
    lastActivityAt: snapshot.dealt.lastDealtAt,
    now,
    staleAfterMins: 60 * 26,
    emptyLabel: "chưa đăng deal nào trong 7 ngày"
  });
  const queueFresh = deriveFreshness({
    lastActivityAt: snapshot.tasks.lastCreatedAt,
    now,
    staleAfterMins: 60 * 26,
    emptyLabel: "chưa có comment nào được tạo"
  });
  const warm = deriveFreshness({
    lastActivityAt: snapshot.accounts.lastWarmedAt,
    now,
    staleAfterMins: 60 * 26,
    emptyLabel: "acc chưa được warming lần nào"
  });

  const productTone: OpsTone =
    snapshot.products.active === 0 ? "down" : snapshot.products.missingEmbedding > 0 ? "warn" : "ok";
  const targetTone: OpsTone = snapshot.targets.active === 0 ? "down" : "ok";
  const accountTone: OpsTone = snapshot.accounts.active === 0 ? "down" : "ok";
  const queueTone: OpsTone = snapshot.tasks.pendingApproval > 0 ? "warn" : "idle";

  const kpis = [
    { label: "Sản phẩm", value: snapshot.products.active, tone: productTone },
    { label: "Nhóm theo dõi", value: snapshot.targets.active, tone: targetTone },
    { label: "Tài khoản", value: snapshot.accounts.active, tone: accountTone },
    { label: "Chờ duyệt", value: snapshot.tasks.pendingApproval, tone: queueTone },
    { label: "Đang chạy", value: snapshot.tasks.running, tone: "idle" as OpsTone },
    { label: "Bài đã chấm", value: snapshot.captures.total, tone: "ok" as OpsTone }
  ];

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Bảng điều hành"
        description="Trạng thái thật của từng khâu: radar quét nhóm, sản phẩm, hàng đợi duyệt và lịch chạy trên VPS."
      />

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 sm:gap-3">
        {kpis.map((kpi) => (
          <Card key={kpi.label} className="gap-1 px-3 py-3">
            <p className="text-muted-foreground text-[11px] sm:text-xs">{kpi.label}</p>
            <p className={cn("text-xl font-semibold tabular-nums sm:text-2xl", toneText[kpi.tone])}>
              {kpi.value}
            </p>
          </Card>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Room
          title="Radar"
          subtitle={`${snapshot.targets.active}/${snapshot.targets.total} nhóm đang bật`}
          tone={radar.tone}
          label={radar.label}
          detail={radar.detail}
          value={`${snapshot.captures.total} bài`}
          icon={RadarIcon}
          href="/radar"
        />
        <Room
          title="Kênh deal"
          subtitle={`${snapshot.dealt.count7d} sản phẩm đăng trong 7 ngày`}
          tone={deals.tone}
          label={deals.label}
          detail={deals.detail}
          value={`${snapshot.dealt.count7d} deal`}
          icon={SendIcon}
          href="/queue"
        />
        <Room
          title="Sản phẩm"
          subtitle={
            snapshot.products.missingEmbedding > 0
              ? `${snapshot.products.missingEmbedding} món thiếu embedding`
              : "tất cả đã có embedding"
          }
          tone={productTone}
          label={productTone === "ok" ? "sẵn sàng ghép" : productTone === "warn" ? "thiếu embedding" : "trống"}
          detail={snapshot.products.lastCreatedAt ? "vừa cập nhật" : "chưa có sản phẩm"}
          value={`${snapshot.products.active} món`}
          icon={BoxesIcon}
          href="/products"
        />
        <Room
          title="Hàng đợi duyệt"
          subtitle={`${snapshot.tasks.queued} đang chờ · ${snapshot.tasks.running} đang chạy`}
          tone={queueTone}
          label={snapshot.tasks.pendingApproval > 0 ? "cần duyệt" : "trống"}
          detail={queueFresh.detail}
          value={`${snapshot.tasks.pendingApproval} chờ`}
          icon={ShieldCheckIcon}
          href="/queue"
        />
        <Room
          title="Tài khoản"
          subtitle={`${snapshot.accounts.total} profile trong BitBrowser`}
          tone={accountTone}
          label={warm.label}
          detail={warm.detail}
          value={`${snapshot.accounts.active} active`}
          icon={UsersIcon}
          href="/accounts"
        />
        <Room
          title="Chất lượng ghép"
          subtitle="điểm AI cao nhất trong 200 bài gần nhất"
          tone={snapshot.captures.bestScore !== null && snapshot.captures.bestScore >= 0.6 ? "ok" : "warn"}
          label={snapshot.captures.bestScore === null ? "chưa có dữ liệu" : `cao nhất ${snapshot.captures.bestScore.toFixed(2)}`}
          detail={`ngưỡng duyệt 0.60`}
          value={`${snapshot.captures.total} bài`}
          icon={BotIcon}
        />
      </div>

      <Card className="gap-3 px-4 py-4">
        <div className="flex items-center gap-2">
          <ClockIcon className="size-4 text-indigo-400" />
          <p className="text-sm font-semibold">Lịch chạy trên VPS (giờ Việt Nam)</p>
        </div>
        <div className="divide-border divide-y">
          {CRON_ENTRIES.map((entry) => {
            const next = nextCronRun(entry, now);
            return (
              <div key={entry.name} className="flex items-center justify-between gap-3 py-2 text-xs">
                <div className="min-w-0">
                  <p className="truncate font-medium">{entry.label}</p>
                  <p className="text-muted-foreground truncate font-mono">{entry.path}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-semibold tabular-nums">{formatVietnamTime(next)}</p>
                  <p className="text-muted-foreground">
                    {entry.cadence.kind === "every"
                      ? `mỗi ${entry.cadence.minutes} phút`
                      : entry.cadence.kind === "hourly"
                        ? "mỗi giờ"
                        : `${entry.cadence.hours.length} lần/ngày`}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
