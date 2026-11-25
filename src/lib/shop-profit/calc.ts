/**
 * Deterministic profit maths for the "Sheet tính lãi thực nhận sau phí sàn và
 * hoàn đơn" product.
 *
 * Deliberately contains NO default marketplace rates. Every fee percentage is
 * supplied by the operator from the seller centre / payout statement, because
 * rates differ by marketplace, category, shop and campaign. The web calculator
 * and the generated workbook both call the same formulas, so the browser and
 * the spreadsheet can never drift apart.
 */

export const SHOP_PROFIT_NAME = "Sheet tính lãi thực nhận sau phí sàn và hoàn đơn";
export const SHOP_PROFIT_VERSION = "1.0.0";
export const SHOP_PROFIT_TRIAL_PRICE_VND = 249_000;

export type ShopProfitOrderInput = {
  /** Units ordered. */
  quantity: number;
  /** Selling price per unit. */
  unitPrice: number;
  /** Cost of goods per unit. */
  unitCost: number;
  /** Shipping collected from the buyer. */
  buyerShipping: number;
  /** Outbound shipping the seller pays. */
  sellerShipping: number;
  /** Seller-funded discount / shop voucher. */
  shopDiscount: number;
  /** Marketplace commission percentage, e.g. 5 for 5%. */
  platformFeeRatePct: number;
  /** Fixed marketplace fee per order. */
  platformFixedFee: number;
  /** Payment-gateway fee percentage, e.g. 2 for 2%. */
  paymentFeeRatePct: number;
  /** Fixed payment-gateway fee per order. */
  paymentFixedFee: number;
  /** Affiliate commission percentage, e.g. 4 for 4%. */
  affiliateRatePct: number;
  /** Units returned (0..quantity). Partial returns are supported. */
  returnedQuantity: number;
  /** Cash refunded to the buyer, including any shipping refund. */
  refundAmount: number;
  /** Return shipping the seller pays. */
  returnShipping: number;
  /** Marketplace fee actually refunded by the marketplace. */
  platformFeeRefund: number;
  /** Payment fee actually refunded by the payment provider. */
  paymentFeeRefund: number;
  /** Cost of returned goods that cannot be resold. */
  damagedReturnCost: number;
  packagingCost: number;
  adCost: number;
  otherCost: number;
};

export type ShopProfitOrderResult = {
  grossRevenue: number;
  netRevenue: number;
  feeBase: number;
  platformFee: number;
  paymentFee: number;
  affiliateCommission: number;
  sellerShipping: number;
  returnShipping: number;
  expectedPayout: number;
  remainingQuantity: number;
  returnedQuantity: number;
  cogs: number;
  totalCosts: number;
  profit: number;
  /** Profit / gross revenue, in percentage points. */
  marginPct: number;
  /** Profit / total costs, in percentage points. */
  roiPct: number;
};

/** All zero, including every fee rate: the product never guesses a rate. */
export const EMPTY_ORDER_INPUT: ShopProfitOrderInput = {
  quantity: 0,
  unitPrice: 0,
  unitCost: 0,
  buyerShipping: 0,
  sellerShipping: 0,
  shopDiscount: 0,
  platformFeeRatePct: 0,
  platformFixedFee: 0,
  paymentFeeRatePct: 0,
  paymentFixedFee: 0,
  affiliateRatePct: 0,
  returnedQuantity: 0,
  refundAmount: 0,
  returnShipping: 0,
  platformFeeRefund: 0,
  paymentFeeRefund: 0,
  damagedReturnCost: 0,
  packagingCost: 0,
  adCost: 0,
  otherCost: 0
};

function nonNegative(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}


/** Normalises partial/foreign input before every calculation. */
export function normalizeOrderInput(
  input: Partial<ShopProfitOrderInput> | null | undefined
): ShopProfitOrderInput {
  const quantity = Math.floor(nonNegative(input?.quantity));
  const returnedQuantity = Math.min(Math.floor(nonNegative(input?.returnedQuantity)), quantity);

  return {
    quantity,
    unitPrice: nonNegative(input?.unitPrice),
    unitCost: nonNegative(input?.unitCost),
    buyerShipping: nonNegative(input?.buyerShipping),
    sellerShipping: nonNegative(input?.sellerShipping),
    shopDiscount: nonNegative(input?.shopDiscount),
    platformFeeRatePct: nonNegative(input?.platformFeeRatePct),
    platformFixedFee: nonNegative(input?.platformFixedFee),
    paymentFeeRatePct: nonNegative(input?.paymentFeeRatePct),
    paymentFixedFee: nonNegative(input?.paymentFixedFee),
    affiliateRatePct: nonNegative(input?.affiliateRatePct),
    returnedQuantity,
    refundAmount: nonNegative(input?.refundAmount),
    returnShipping: nonNegative(input?.returnShipping),
    platformFeeRefund: nonNegative(input?.platformFeeRefund),
    paymentFeeRefund: nonNegative(input?.paymentFeeRefund),
    damagedReturnCost: nonNegative(input?.damagedReturnCost),
    packagingCost: nonNegative(input?.packagingCost),
    adCost: nonNegative(input?.adCost),
    otherCost: nonNegative(input?.otherCost)
  };
}

/**
 * The canonical formula. Keep this in lockstep with `src/lib/shop-profit/workbook.ts`;
 * tests assert concrete numbers for no-return, partial-return and full-return cases.
 */
export function calculateOrder(
  rawInput: Partial<ShopProfitOrderInput> | null | undefined
): ShopProfitOrderResult {
  const input = normalizeOrderInput(rawInput);

  const grossRevenue = input.unitPrice * input.quantity + input.buyerShipping;
  const netRevenue = grossRevenue - input.shopDiscount - input.refundAmount;
  const feeBase = Math.max(0, netRevenue);

  const platformFee = Math.max(
    0,
    (feeBase * input.platformFeeRatePct) / 100 + input.platformFixedFee - input.platformFeeRefund
  );
  const paymentFee = Math.max(
    0,
    (feeBase * input.paymentFeeRatePct) / 100 + input.paymentFixedFee - input.paymentFeeRefund
  );
  const affiliateCommission = Math.max(0, (feeBase * input.affiliateRatePct) / 100);

  const expectedPayout =
    netRevenue -
    platformFee -
    paymentFee -
    affiliateCommission -
    input.sellerShipping -
    input.returnShipping;

  const remainingQuantity = Math.max(0, input.quantity - input.returnedQuantity);
  const cogs = input.unitCost * remainingQuantity + input.damagedReturnCost;
  const totalCosts = cogs + input.packagingCost + input.adCost + input.otherCost;
  const profit = expectedPayout - totalCosts;

  return {
    grossRevenue,
    netRevenue,
    feeBase,
    platformFee,
    paymentFee,
    affiliateCommission,
    sellerShipping: input.sellerShipping,
    returnShipping: input.returnShipping,
    expectedPayout,
    remainingQuantity,
    returnedQuantity: input.returnedQuantity,
    cogs,
    totalCosts,
    profit,
    marginPct: grossRevenue === 0 ? 0 : (profit / grossRevenue) * 100,
    roiPct: totalCosts === 0 ? 0 : (profit / totalCosts) * 100
  };
}

/* Bulk-entry and payout-reconciliation logic is paid product code and lives in
 * the operator-private generator outside this public repository. */
