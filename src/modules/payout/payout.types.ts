/** POST /api/wallet/payouts/request */
export interface RequestPayoutBody {
  amount: number;
  /** Override bank details for this payout (otherwise uses profile defaults) */
  bankAccountNumber?: string;
  ifscCode?: string;
  accountHolderName?: string;
}

/** PUT /api/wallet/payouts/:id/reject */
export interface RejectPayoutBody {
  reason: string;
}
