import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  DownloadIcon,
  ExternalLinkIcon,
  FileSpreadsheetIcon,
  ReceiptTextIcon,
  ShieldCheckIcon
} from "lucide-react";

import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { ShopProfitConsentButton } from "@/components/shop-profit/consent-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listShopProfitFulfillmentLeads } from "@/lib/data/shop-profit";
import {
  formatDateTime,
  formatHostname,
  formatRelative,
  formatVnd
} from "@/lib/format";
import { leadStatusLabel } from "@/lib/leads/status";
import { inspectFullWorkbook } from "@/lib/shop-profit/full-workbook-file";
import { hasShopProfitConsent } from "@/lib/shop-profit/fulfillment";

export const metadata: Metadata = { title: "Giao file Shop Profit" };

/**
 * Operator-only delivery queue for the paid workbook.
 *
 * A lead appears here only because a real positive `kind='template'` receipt
 * exists in `lead_receipts`. `leads.status` is shown for context but is never
 * the payment gate. The download route repeats the receipt + consent checks.
 */
export default async function ShopProfitFulfillmentPage() {
  const [fulfillments, workbook] = await Promise.all([
    listShopProfitFulfillmentLeads(),
    inspectFullWorkbook()
  ]);

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Giao file Shop Profit"
        description="Hàng đợi giao bản đầy đủ “Sheet tính lãi thực nhận sau phí sàn và hoàn đơn” cho khách đã có phiếu thu template thật. Chỉ giao sau khi khách đồng ý nhận file; file trả phí không nằm trong đường dẫn công khai."
        actions={
          <Button asChild variant="outline" size="lg" className="w-full sm:w-auto">
            <Link href="/leads">
              <ExternalLinkIcon />
              Mở Lead Hunter
            </Link>
          </Button>
        }
      />

      <Card className={workbook.ready ? "border-success/40 bg-success/5" : "border-warning/40 bg-warning/5"}>
        <CardContent className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-start">
          <span
            className={
              workbook.ready
                ? "bg-success/15 text-success flex size-9 shrink-0 items-center justify-center rounded-md"
                : "bg-warning/15 text-warning flex size-9 shrink-0 items-center justify-center rounded-md"
            }
          >
            {workbook.ready ? <CheckCircle2Icon className="size-4" /> : <AlertTriangleIcon className="size-4" />}
          </span>
          <div className="min-w-0 space-y-1">
            <p className="font-medium">
              {workbook.ready
                ? "File bản đầy đủ đã sẵn sàng trên server."
                : "File bản đầy đủ chưa sẵn sàng trên server."}
            </p>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {workbook.ready
                ? "Route tải xuống kiểm tra phiên operator, phiếu thu template thật và dấu xác nhận đồng ý trong ghi chú lead. File được đọc từ đường dẫn tuyệt đối do operator cấu hình, không nằm trong thư mục public."
                : "Cần cấu hình SHOP_PROFIT_FULL_WORKBOOK_PATH trỏ tới file .xlsx riêng tư trên server (và tùy chọn SHOP_PROFIT_FULL_WORKBOOK_SHA256) trước khi giao. Không đặt file trả phí trong public/."}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ReceiptTextIcon className="size-4" />
            Cổng giao file
          </CardTitle>
          <CardDescription>
            Cả ba điều kiện dưới đây được kiểm tra lại ở route tải file, không chỉ ở giao diện.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="text-muted-foreground grid gap-2 text-sm leading-relaxed sm:grid-cols-3">
            <li className="rounded-lg border p-3">
              <span className="text-foreground font-medium">1. Phiếu thu thật</span>
              <br />
              Có dòng <code className="font-mono text-xs">lead_receipts</code> kind{" "}
              <code className="font-mono text-xs">template</code>, số tiền &gt; 0. Trạng thái lead
              không được dùng làm bằng chứng thanh toán.
            </li>
            <li className="rounded-lg border p-3">
              <span className="text-foreground font-medium">2. Khách đồng ý</span>
              <br />
              Khách đã đồng ý nhận file qua tin nhắn. Bấm “Ghi nhận khách đồng ý” để lưu dấu xác
              nhận vào ghi chú lead.
            </li>
            <li className="rounded-lg border p-3">
              <span className="text-foreground font-medium">3. Gửi file</span>
              <br />
              Tải .xlsx rồi gửi trực tiếp cho khách qua kênh hai bên đã trao đổi.
            </li>
          </ol>
        </CardContent>
      </Card>

      {fulfillments.length === 0 ? (
        <EmptyState
          icon={FileSpreadsheetIcon}
          title="Chưa có phiếu thu template"
          description="Khi operator ghi nhận một khoản thu loại “Template / file” cho lead, khách đó sẽ xuất hiện ở đây để giao bản đầy đủ."
          action={
            <Button asChild variant="outline">
              <Link href="/leads">Mở Lead Hunter</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {fulfillments.map(({ lead, templateReceipts, totalTemplateVnd, latestPaidAt }) => {
            const consented = hasShopProfitConsent(lead.notes);
            const canDownload = workbook.ready && consented;

            return (
              <Card key={lead.id}>
                <CardContent className="space-y-3 pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="success">
                      <ReceiptTextIcon />
                      Đã thu template {formatVnd(totalTemplateVnd)}
                    </Badge>
                    {consented ? (
                      <Badge variant="info">
                        <ShieldCheckIcon />
                        Đã ghi nhận đồng ý
                      </Badge>
                    ) : (
                      <Badge variant="warning">Chưa ghi nhận đồng ý</Badge>
                    )}
                    <Badge variant="muted">CRM: {leadStatusLabel(lead.status)}</Badge>
                    <span className="text-muted-foreground ml-auto text-xs">
                      Thu gần nhất {formatRelative(latestPaidAt)}
                    </span>
                  </div>

                  <div className="min-w-0 space-y-1">
                    <a
                      href={lead.post_url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex min-h-11 items-center gap-1 font-medium hover:underline"
                    >
                      <span className="truncate">
                        {lead.author_name || lead.group_name || "Lead không tên"}
                      </span>
                      <ExternalLinkIcon className="size-3.5 shrink-0" />
                    </a>
                    <p className="text-muted-foreground truncate text-xs">
                      {lead.group_name || "Không rõ nhóm"} · {formatHostname(lead.post_url)}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Tạo {formatDateTime(lead.created_at)}
                      {lead.last_contacted_at
                        ? ` · Liên hệ gần nhất ${formatDateTime(lead.last_contacted_at)}`
                        : ""}
                    </p>
                  </div>

                  <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                    <p className="font-medium">
                      {templateReceipts.length} phiếu thu template · tổng{" "}
                      {formatVnd(totalTemplateVnd)}
                    </p>
                    <ul className="text-muted-foreground mt-1 space-y-0.5 text-xs">
                      {templateReceipts.slice(0, 3).map((receipt) => (
                        <li key={receipt.id}>
                          {formatDateTime(receipt.paid_at)} · {formatVnd(receipt.amount_vnd)}
                          {receipt.note ? ` · ${receipt.note}` : ""}
                        </li>
                      ))}
                      {templateReceipts.length > 3 ? (
                        <li>+{templateReceipts.length - 3} phiếu thu khác</li>
                      ) : null}
                    </ul>
                  </div>

                  {lead.summary ? <p className="text-sm font-medium text-pretty">{lead.summary}</p> : null}

                  {lead.notes ? (
                    <details className="rounded-lg border">
                      <summary className="text-muted-foreground flex min-h-11 cursor-pointer items-center px-3 text-sm">
                        Xem ghi chú CRM
                      </summary>
                      <pre className="bg-muted/50 border-t p-3 font-sans text-xs break-words whitespace-pre-wrap">
                        {lead.notes}
                      </pre>
                    </details>
                  ) : null}

                  <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-end">
                    {consented ? (
                      <Button
                        asChild={canDownload}
                        disabled={!canDownload}
                        size="sm"
                        className="min-h-11"
                        title={
                          canDownload
                            ? "Tải file bản đầy đủ"
                            : "Cần cấu hình file riêng tư trên server trước khi giao"
                        }
                      >
                        {canDownload ? (
                          <a href={`/leads/fulfillment/download?lead=${lead.id}`}>
                            <DownloadIcon />
                            Tải bản đầy đủ cho khách này
                          </a>
                        ) : (
                          <span>
                            <DownloadIcon />
                            Tải bản đầy đủ (chưa sẵn sàng)
                          </span>
                        )}
                      </Button>
                    ) : (
                      <>
                        <ShopProfitConsentButton leadId={lead.id} />
                        <Button size="sm" variant="outline" disabled className="min-h-11">
                          <DownloadIcon />
                          Cần ghi nhận đồng ý trước
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
