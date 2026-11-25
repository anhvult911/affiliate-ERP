/**
 * Delivery state for the paid workbook.
 *
 * The full .xlsx is a paid artefact and is deliberately NOT in this public
 * repository. The authenticated operator route streams it from an absolute path
 * configured outside git.
 *
 * Payment proof is a real row in `lead_receipts` (`kind = 'template'`,
 * `amount_vnd > 0`), not `leads.status`. Status is not proof of cash and is not
 * guaranteed to change when a receipt is recorded. Consent is a separate marker
 * in the existing lead notes, so receipt + consent are both required.
 */
export const SHOP_PROFIT_CONSENT_MARKER = "[shop-profit:consent:v1]";

export type ShopProfitReceiptLike = {
  kind: string;
  amount_vnd: number;
};

/** Only one template product is sold here, so one positive template receipt is enough. */
export function hasShopProfitTemplateReceipt(receipts: readonly ShopProfitReceiptLike[]) {
  return receipts.some(
    (receipt) =>
      receipt.kind === "template" &&
      Number.isFinite(Number(receipt.amount_vnd)) &&
      Number(receipt.amount_vnd) > 0
  );
}

export function hasShopProfitConsent(notes: string | null | undefined) {
  return (notes ?? "").includes(SHOP_PROFIT_CONSENT_MARKER);
}

export function appendShopProfitConsent(
  existingNotes: string | null | undefined,
  now: Date = new Date()
) {
  const current = (existingNotes ?? "").trim();
  if (current.includes(SHOP_PROFIT_CONSENT_MARKER)) return current;

  const markerLine = `${SHOP_PROFIT_CONSENT_MARKER} ${now.toISOString()} — operator xác nhận khách đồng ý nhận file qua tin nhắn.`;
  const combined = current ? `${current}\n${markerLine}` : markerLine;

  // notes is capped at 4.000 chars; keep the newest end so the consent marker
  // cannot be truncated away.
  return combined.length <= 4000 ? combined : combined.slice(-4000);
}
