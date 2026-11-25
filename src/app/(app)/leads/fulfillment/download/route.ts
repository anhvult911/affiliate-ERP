import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";

import {
  getShopProfitFulfillmentLead,
  type ShopProfitFulfillmentLead
} from "@/lib/data/shop-profit";
import { readFullWorkbook } from "@/lib/shop-profit/full-workbook-file";
import {
  hasShopProfitConsent,
  hasShopProfitTemplateReceipt
} from "@/lib/shop-profit/fulfillment";
import { getSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Authenticated operator delivery of the paid workbook.
 *
 * Gate order (all required):
 *   1. middleware + `getSupabaseUser()` (session)
 *   2. a positive `kind='template'` row in `lead_receipts` for this lead
 *   3. explicit consent marker in the lead notes
 *
 * `leads.status` is intentionally not part of the gate: it is not proof of cash
 * and may not change when a receipt is recorded.
 *
 * The file itself is read from an absolute operator-configured path and is not
 * part of the public web root.
 */
export async function GET(request: NextRequest) {
  let user: User | null;
  try {
    user = await getSupabaseUser();
  } catch {
    return new NextResponse("Chưa cấu hình Supabase trên server.", { status: 503 });
  }

  if (!user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", "/leads/fulfillment");
    return NextResponse.redirect(loginUrl);
  }

  const leadId = request.nextUrl.searchParams.get("lead")?.trim() ?? "";
  if (!UUID_PATTERN.test(leadId)) {
    return new NextResponse("Thiếu hoặc sai mã lead.", { status: 400 });
  }

  let fulfillment: ShopProfitFulfillmentLead | null = null;
  try {
    fulfillment = await getShopProfitFulfillmentLead(leadId);
  } catch {
    return new NextResponse("Không đọc được dữ liệu giao file. Vui lòng thử lại.", {
      status: 503,
      headers: { "Cache-Control": "no-store" }
    });
  }
  if (!fulfillment) {
    return new NextResponse(
      "Lead này chưa có phiếu thu template thật hoặc bạn không có quyền truy cập.",
      { status: 403 }
    );
  }

  if (!hasShopProfitTemplateReceipt(fulfillment.templateReceipts)) {
    return new NextResponse("Chưa có phiếu thu template thật cho lead này.", { status: 403 });
  }

  if (!hasShopProfitConsent(fulfillment.lead.notes)) {
    return new NextResponse(
      "Chưa ghi nhận khách đồng ý nhận file. Hãy xác nhận với khách và ghi nhận trong CRM trước khi giao.",
      { status: 403 }
    );
  }

  const file = await readFullWorkbook();
  if (!file.ok) {
    return new NextResponse(
      "File bản đầy đủ chưa sẵn sàng trên server. Operator cần kiểm tra cấu hình file riêng tư.",
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="Sheet-tinh-lai-thuc-nhan-ban-day-du.xlsx"',
      "Content-Length": String(file.data.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Workbook-SHA256": file.sha256
    }
  });
}
