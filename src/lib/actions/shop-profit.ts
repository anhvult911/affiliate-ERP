"use server";

import { revalidatePath } from "next/cache";

import {
  listShopProfitTemplateReceipts,
  type ShopProfitReceipt
} from "@/lib/data/shop-profit";
import { LEAD_OWNER_ID } from "@/lib/leads/config";
import { fail, ok, type ActionResult } from "@/lib/result";
import {
  appendShopProfitConsent,
  hasShopProfitConsent,
  hasShopProfitTemplateReceipt
} from "@/lib/shop-profit/fulfillment";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Records the customer's consent in the existing CRM note field. The payment
 * gate is the same positive `kind='template'` receipt the download route uses;
 * `leads.status` is never treated as proof of cash.
 */
export async function recordShopProfitConsent(
  leadId: string
): Promise<ActionResult<{ alreadyRecorded: boolean }>> {
  if (!UUID_PATTERN.test(leadId)) return fail("Lead không hợp lệ.");

  const supabase = await createSupabaseServerClient();
  const { data: lead, error: readError } = await supabase
    .from("leads")
    .select("id, notes")
    .eq("id", leadId)
    .eq("user_id", LEAD_OWNER_ID)
    .maybeSingle();

  if (readError) return fail("Không đọc được lead. Vui lòng thử lại.");
  if (!lead) return fail("Lead không tồn tại hoặc bạn không có quyền truy cập.");

  let receipts: ShopProfitReceipt[];
  try {
    receipts = await listShopProfitTemplateReceipts(leadId);
  } catch {
    return fail("Không đọc được phiếu thu. Vui lòng thử lại.");
  }
  if (!hasShopProfitTemplateReceipt(receipts)) {
    return fail("Chưa có phiếu thu template thật cho lead này. Hãy ghi nhận thanh toán trước.");
  }
  if (hasShopProfitConsent(lead.notes)) return ok({ alreadyRecorded: true });

  const notes = appendShopProfitConsent(lead.notes);
  const { error: updateError } = await supabase
    .from("leads")
    .update({ notes })
    .eq("id", leadId)
    .eq("user_id", LEAD_OWNER_ID);

  if (updateError) return fail("Không lưu được xác nhận đồng ý. Vui lòng thử lại.");

  revalidatePath("/leads/fulfillment");
  revalidatePath("/leads");
  return ok({ alreadyRecorded: false });
}
