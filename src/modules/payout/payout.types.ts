/** POST /api/wallet/payouts/request */
export interface RequestPayoutBody {
  amount: number;
  bankAccountNumber?: string;
  ifscCode?: string;
  accountHolderName?: string;
  bankName?: string;
  payoutMode?: "IMPS" | "NEFT";
}

/** PUT /api/wallet/payouts/:id/reject */
export interface RejectPayoutBody {
  reason: string;
}
