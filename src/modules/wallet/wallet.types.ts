/** Query params for GET /api/wallet/wallet/transactions */
export interface TransactionQuery {
  page?: string;
  limit?: string;
  type?: "credit" | "debit";
  referenceType?: "payin" | "payout" | "commission" | "adjustment";
  walletType?: "main" | "commission";
  fromDate?: string;
  toDate?: string;
}
