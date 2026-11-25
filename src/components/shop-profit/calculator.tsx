"use client";

import { useMemo, useState } from "react";
import { CalculatorIcon, RotateCcwIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  EMPTY_ORDER_INPUT,
  calculateOrder,
  type ShopProfitOrderInput
} from "@/lib/shop-profit/calc";
import { formatPercent, formatVnd } from "@/lib/format";
import { cn } from "@/lib/utils";

type NumericKey = {
  [K in keyof ShopProfitOrderInput]: ShopProfitOrderInput[K] extends number ? K : never;
}[keyof ShopProfitOrderInput];

const INITIAL: ShopProfitOrderInput = { ...EMPTY_ORDER_INPUT, quantity: 1 };

function NumberField({
  id,
  label,
  hint,
  value,
  onChange,
  step = 1000,
  suffix
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  suffix?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min="0"
          step={step}
          value={value}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            onChange(Number.isFinite(parsed) ? Math.max(0, parsed) : 0);
          }}
          className={suffix ? "pr-10" : undefined}
        />
        {suffix ? (
          <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm">
            {suffix}
          </span>
        ) : null}
      </div>
      {hint ? <p className="text-muted-foreground text-xs leading-snug">{hint}</p> : null}
    </div>
  );
}

function ResultRow({
  label,
  value,
  strong = false,
  tone
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "default" | "success" | "destructive";
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b py-2 last:border-b-0">
      <span className={cn("text-sm", strong ? "font-semibold" : "text-muted-foreground")}>
        {label}
      </span>
      <span
        className={cn(
          "text-right font-mono text-sm tabular-nums",
          strong && "text-base font-semibold",
          tone === "success" && "text-success",
          tone === "destructive" && "text-destructive"
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function ShopProfitCalculator() {
  const [input, setInput] = useState<ShopProfitOrderInput>(INITIAL);
  const result = useMemo(() => calculateOrder(input), [input]);

  function update(key: NumericKey, value: number) {
    setInput((previous) => {
      const next = { ...previous, [key]: value };
      if (key === "quantity") {
        next.returnedQuantity = Math.min(next.returnedQuantity, value);
      }
      return next;
    });
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-muted/30">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalculatorIcon className="size-4" />
          Máy tính lãi 1 đơn — miễn phí
        </CardTitle>
        <CardDescription>
          Nhập đúng số của bạn. File không tự điền bất kỳ tỷ lệ phí nào: hãy chép % phí sàn và
          phí thanh toán từ Seller Center/sao kê.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">1. Đơn hàng</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <NumberField
              id="shop-profit-quantity"
              label="Số lượng"
              value={input.quantity}
              step={1}
              onChange={(value) => update("quantity", Math.floor(value))}
            />
            <NumberField
              id="shop-profit-price"
              label="Giá bán 1 SP"
              value={input.unitPrice}
              onChange={(value) => update("unitPrice", value)}
            />
            <NumberField
              id="shop-profit-cost"
              label="Giá vốn 1 SP"
              value={input.unitCost}
              onChange={(value) => update("unitCost", value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <NumberField
              id="shop-profit-buyer-shipping"
              label="Ship khách trả"
              value={input.buyerShipping}
              onChange={(value) => update("buyerShipping", value)}
            />
            <NumberField
              id="shop-profit-seller-shipping"
              label="Ship shop trả"
              value={input.sellerShipping}
              onChange={(value) => update("sellerShipping", value)}
            />
            <NumberField
              id="shop-profit-discount"
              label="Giảm giá shop"
              value={input.shopDiscount}
              onChange={(value) => update("shopDiscount", value)}
            />
          </div>
        </section>

        <section className="space-y-3 border-t pt-4">
          <h3 className="text-sm font-semibold">2. Phí sàn, thanh toán, affiliate</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <NumberField
              id="shop-profit-platform-rate"
              label="Phí sàn"
              value={input.platformFeeRatePct}
              step={0.1}
              suffix="%"
              onChange={(value) => update("platformFeeRatePct", value)}
            />
            <NumberField
              id="shop-profit-platform-fixed"
              label="Phí sàn cố định"
              value={input.platformFixedFee}
              onChange={(value) => update("platformFixedFee", value)}
            />
            <NumberField
              id="shop-profit-affiliate"
              label="Hoa hồng affiliate"
              value={input.affiliateRatePct}
              step={0.1}
              suffix="%"
              onChange={(value) => update("affiliateRatePct", value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <NumberField
              id="shop-profit-payment-rate"
              label="Phí thanh toán"
              value={input.paymentFeeRatePct}
              step={0.1}
              suffix="%"
              onChange={(value) => update("paymentFeeRatePct", value)}
            />
            <NumberField
              id="shop-profit-payment-fixed"
              label="Phí thanh toán cố định"
              value={input.paymentFixedFee}
              onChange={(value) => update("paymentFixedFee", value)}
            />
            <div className="rounded-md border border-dashed p-3 text-xs leading-relaxed text-muted-foreground">
              Không có mức phí mặc định. Để 0 nghĩa là chưa nhập, không phải phí thật.
            </div>
          </div>
        </section>

        <section className="space-y-3 border-t pt-4">
          <h3 className="text-sm font-semibold">3. Hoàn đơn</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <NumberField
              id="shop-profit-returned-quantity"
              label="Số lượng hoàn"
              value={input.returnedQuantity}
              step={1}
              hint="0 = không hoàn; có thể nhập hoàn một phần."
              onChange={(value) =>
                update("returnedQuantity", Math.min(Math.floor(value), input.quantity))
              }
            />
            <NumberField
              id="shop-profit-refund"
              label="Hoàn tiền cho khách"
              value={input.refundAmount}
              onChange={(value) => update("refundAmount", value)}
            />
            <NumberField
              id="shop-profit-return-shipping"
              label="Ship hoàn shop trả"
              value={input.returnShipping}
              onChange={(value) => update("returnShipping", value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <NumberField
              id="shop-profit-platform-refund"
              label="Phí sàn được hoàn"
              value={input.platformFeeRefund}
              onChange={(value) => update("platformFeeRefund", value)}
            />
            <NumberField
              id="shop-profit-payment-refund"
              label="Phí thanh toán được hoàn"
              value={input.paymentFeeRefund}
              onChange={(value) => update("paymentFeeRefund", value)}
            />
            <NumberField
              id="shop-profit-damaged-return"
              label="Giá vốn hàng hoàn hỏng"
              value={input.damagedReturnCost}
              onChange={(value) => update("damagedReturnCost", value)}
            />
          </div>
        </section>

        <section className="space-y-3 border-t pt-4">
          <h3 className="text-sm font-semibold">4. Chi phí khác</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <NumberField
              id="shop-profit-packaging"
              label="Đóng gói"
              value={input.packagingCost}
              onChange={(value) => update("packagingCost", value)}
            />
            <NumberField
              id="shop-profit-ad"
              label="Quảng cáo phân bổ"
              value={input.adCost}
              onChange={(value) => update("adCost", value)}
            />
            <NumberField
              id="shop-profit-other"
              label="Chi phí khác"
              value={input.otherCost}
              onChange={(value) => update("otherCost", value)}
            />
          </div>
        </section>

        <section className="border-t pt-4" aria-live="polite">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Kết quả</h3>
            <Badge variant={result.profit >= 0 ? "success" : "destructive"}>
              {result.profit >= 0 ? "Có lãi" : "Đang lỗ"}
            </Badge>
          </div>

          <div
            className={cn(
              "rounded-lg border p-4",
              result.profit >= 0 ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5"
            )}
          >
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Lãi thực nhận
            </p>
            <p
              className={cn(
                "mt-1 font-mono text-3xl font-semibold tabular-nums",
                result.profit >= 0 ? "text-success" : "text-destructive"
              )}
            >
              {formatVnd(result.profit)}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              Biên lãi {formatPercent(result.marginPct, 1)} · ROI {formatPercent(result.roiPct, 1)}
            </p>
          </div>

          <div className="mt-3 grid gap-x-8 gap-y-0 sm:grid-cols-2">
            <div>
              <ResultRow label="Doanh thu gộp" value={formatVnd(result.grossRevenue)} />
              <ResultRow label="Doanh thu thuần" value={formatVnd(result.netRevenue)} />
              <ResultRow label="Phí sàn" value={formatVnd(result.platformFee)} />
              <ResultRow label="Phí thanh toán" value={formatVnd(result.paymentFee)} />
              <ResultRow label="Hoa hồng affiliate" value={formatVnd(result.affiliateCommission)} />
            </div>
            <div>
              <ResultRow label="Dự kiến sàn trả shop" value={formatVnd(result.expectedPayout)} />
              <ResultRow label="Giá vốn còn lại" value={formatVnd(result.cogs)} />
              <ResultRow label="Tổng chi phí" value={formatVnd(result.totalCosts)} />
              <ResultRow
                label="Lãi thực nhận"
                value={formatVnd(result.profit)}
                strong
                tone={result.profit >= 0 ? "success" : "destructive"}
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs">
              Ước tính theo đúng số bạn nhập. Hãy đối chiếu sao kê thực tế trước khi ra quyết định.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setInput(INITIAL)}
              className="min-h-11"
            >
              <RotateCcwIcon />
              Đặt lại
            </Button>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
