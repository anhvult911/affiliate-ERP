/** Phase 2 integration boundary only. No payment endpoint, subscription state or billing UI in Phase 1. */
export interface SubscriptionPaymentHandler {
  onVerifiedPayment(event: {
    userId: string;
    provider: string;
    transactionId: string;
    amountVnd: number;
    paidAt: string;
  }): Promise<void>;
}
