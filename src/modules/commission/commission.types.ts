/** PUT /api/wallet/commissions/config — batch set default rates */
export interface SetCommissionConfigBody {
  /**
   * Array of rate entries.  Each entry says:
   * "When a user at level `transactionRoleLevel` does a payin,
   *  an ancestor at level `beneficiaryRoleLevel` earns `percentage`%."
   */
  rates: Array<{
    transactionRoleLevel: number;
    beneficiaryRoleLevel: number;
    percentage: number;
  }>;
}

/** PUT /api/wallet/commissions/overrides/:userId */
export interface SetOverrideBody {
  /** The specific ancestor who will earn commission */
  beneficiaryUserId: string;
  /** Commission percentage for that ancestor */
  percentage: number;
}

/** Computed commission for a single ancestor during a payin */
export interface CommissionEntry {
  toUserId: string;
  toRoleLevel: number;
  percentage: number;
  amount: number;
}
