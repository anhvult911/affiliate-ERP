import { NextResponse } from "next/server";

import { buildFreeWorkbook } from "@/lib/shop-profit/free-workbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public free download: instructions + one-order calculator only. The paid
 * full workbook is never generated or stored under `public/`.
 */
export async function GET() {
  const workbook = buildFreeWorkbook();

  return new NextResponse(new Uint8Array(workbook), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="shop-profit-free-trial.xlsx"',
      "Content-Length": String(workbook.byteLength),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
