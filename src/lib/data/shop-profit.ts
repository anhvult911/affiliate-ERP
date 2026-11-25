import type { Tables } from "@/lib/database.types";
import { LEAD_OWNER_ID } from "@/lib/leads/config";
import { hasShopProfitTemplateReceipt } from "@/lib/shop-profit/fulfillment";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ShopProfitLead = Tables<"leads">;
export type ShopProfitReceipt = Tables<"lead_receipts">;

export type ShopProfitFulfillmentLead = {
  lead: ShopProfitLead;
  templateReceipts: ShopProfitReceipt[];
  totalTemplateVnd: number;
  latestPaidAt: string;
};

/**
 * Paid workbook fulfilment starts from real receipts, not `leads.status`.
 * A lead qualifies only when at least one positive `kind = 'template'` receipt
 * exists. RLS is enforced by the cookie client; owner filters keep the Phase 1
 * tenant boundary identical to every other lead query.
 */
export async function listShopProfitFulfillmentLeads(
  limit = 100
): Promise<ShopProfitFulfillmentLead[]> {
  const supabase = await createSupabaseServerClient();
  const cappedLimit = Math.min(Math.max(limit, 1), 200);

  const { data: receiptRows, error: receiptError } = await supabase
    .from("lead_receipts")
    .select("*")
    .eq("user_id", LEAD_OWNER_ID)
    .eq("kind", "template")
    .gt("amount_vnd", 0)
    .order("paid_at", { ascending: false })
    .limit(cappedLimit * 5);

  if (receiptError) throw new Error(receiptError.message);
  const receipts = (receiptRows ?? []) as ShopProfitReceipt[];
  if (receipts.length === 0) return [];

  const byLead = new Map<string, ShopProfitReceipt[]>();
  for (const receipt of receipts) {
    const rows = byLead.get(receipt.lead_id);
    if (rows) rows.push(receipt);
    else byLead.set(receipt.lead_id, [receipt]);
  }

  const leadIds = [...byLead.keys()].slice(0, cappedLimit);
  const { data: leadRows, error: leadError } = await supabase
    .from("leads")
    .select("*")
    .eq("user_id", LEAD_OWNER_ID)
    .in("id", leadIds);

  if (leadError) throw new Error(leadError.message);

  const leads = (leadRows ?? []) as ShopProfitLead[];
  const result: ShopProfitFulfillmentLead[] = [];

  for (const lead of leads) {
    const leadReceipts = byLead.get(lead.id) ?? [];
    const latest = leadReceipts[0];
    if (!latest || !hasShopProfitTemplateReceipt(leadReceipts)) continue;
    result.push({
      lead,
      templateReceipts: leadReceipts,
      totalTemplateVnd: leadReceipts.reduce(
        (total, receipt) => total + Number(receipt.amount_vnd),
        0
      ),
      latestPaidAt: latest.paid_at
    });
  }

  return result.sort(
    (left, right) => Date.parse(right.latestPaidAt) - Date.parse(left.latestPaidAt)
  );
}

export async function getShopProfitFulfillmentLead(
  id: string
): Promise<ShopProfitFulfillmentLead | null> {
  const supabase = await createSupabaseServerClient();

  const { data: leadRow, error: leadError } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .eq("user_id", LEAD_OWNER_ID)
    .maybeSingle();

  if (leadError) throw new Error(leadError.message);
  if (!leadRow) return null;

  const receipts = await listShopProfitTemplateReceipts(id);
  if (receipts.length === 0) return null;

  return {
    lead: leadRow as ShopProfitLead,
    templateReceipts: receipts,
    totalTemplateVnd: receipts.reduce(
      (total, receipt) => total + Number(receipt.amount_vnd),
      0
    ),
    latestPaidAt: receipts[0]?.paid_at ?? ""
  };
}

/** Shared payment gate for the fulfilment list, consent action and download route. */
export async function listShopProfitTemplateReceipts(
  leadId: string
): Promise<ShopProfitReceipt[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("lead_receipts")
    .select("*")
    .eq("lead_id", leadId)
    .eq("user_id", LEAD_OWNER_ID)
    .eq("kind", "template")
    .gt("amount_vnd", 0)
    .order("paid_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as ShopProfitReceipt[];
}
