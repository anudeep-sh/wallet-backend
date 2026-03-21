/** POST /api/wallet/payins/initiate */
export interface InitiatePayinBody {
  amount: number;
  paymentFor?: string;
}

/** Payin status values stored in the DB */
export enum PayinStatus {
  INITIATED = "initiated",
  SUCCESS = "success",
  FAILED = "failed",
  EXPIRED = "expired",
}
