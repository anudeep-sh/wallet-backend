/** Query params for GET /api/wallet/wallet/transactions */
export interface TransactionQuery {
  page?: string;
  limit?: string;
  type?: 'credit' | 'debit';
  referenceType?: 'payin' | 'payout' | 'commission' | 'adjustment';
  fromDate?: string;
  toDate?: string;
}
