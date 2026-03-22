/* ------------------------------------------------------------------ */
/*  Shared enums and TypeScript interfaces for the wallet system      */
/* ------------------------------------------------------------------ */

/** The 9 hierarchical user levels — lower number = higher authority */
export enum RoleLevel {
  ADMIN = 1,
  ADMIN_PARTNER = 2,
  WHITE_LABEL = 3,
  STATE_HEAD = 4,
  SUPER_DISTRIBUTOR = 5,
  MASTER_DISTRIBUTOR = 6,
  DISTRIBUTOR = 7,
  RETAILER = 8,
  SHOPKEEPER = 9,
}

/** Human-readable role names keyed by level */
export const ROLE_NAMES: Record<number, string> = {
  [RoleLevel.ADMIN]: "ADMIN",
  [RoleLevel.ADMIN_PARTNER]: "ADMIN_PARTNER",
  [RoleLevel.WHITE_LABEL]: "WHITE_LABEL",
  [RoleLevel.STATE_HEAD]: "STATE_HEAD",
  [RoleLevel.SUPER_DISTRIBUTOR]: "SUPER_DISTRIBUTOR",
  [RoleLevel.MASTER_DISTRIBUTOR]: "MASTER_DISTRIBUTOR",
  [RoleLevel.DISTRIBUTOR]: "DISTRIBUTOR",
  [RoleLevel.RETAILER]: "RETAILER",
  [RoleLevel.SHOPKEEPER]: "SHOPKEEPER",
};

/** Wallet transaction direction */
export enum TransactionType {
  CREDIT = "credit",
  DEBIT = "debit",
}

/** What triggered a wallet transaction */
export enum ReferenceType {
  PAYIN = "payin",
  PAYOUT = "payout",
  COMMISSION = "commission",
  ADJUSTMENT = "adjustment",
}

/** Overall status for transactions, payins, payouts */
export enum TxnStatus {
  PENDING = "pending",
  PROCESSING = "processing",
  SUCCESS = "success",
  FAILED = "failed",
}

/** Invitation lifecycle */
export enum InviteStatus {
  PENDING = "pending",
  ACCEPTED = "accepted",
  EXPIRED = "expired",
}

/** Which wallet a balance / payout belongs to */
export enum WalletType {
  MAIN = "main",
  COMMISSION = "commission",
}

/** Payout-specific statuses (superset of TxnStatus) */
export enum PayoutStatus {
  PENDING = "pending",
  APPROVED = "approved",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed",
  REJECTED = "rejected",
}

/** OTP delivery channel */
export enum OtpType {
  EMAIL = "email",
  SMS = "sms",
}

/** OTP use-case */
export enum OtpPurpose {
  LOGIN = "login",
  MPIN_RESET = "mpin_reset",
}

/* ------------------------------------------------------------------ */
/*  Row-level interfaces (match the DB columns after migration)       */
/* ------------------------------------------------------------------ */

export interface WalletRole {
  id: number;
  name: string;
  level: number;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface WalletUser {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  mobile_number: string;
  gender: string | null;
  date_of_birth: string | null;
  address_1: string | null;
  address_2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  pan_card_number: string | null;
  aadhar_card_number: string | null;
  name_on_aadhar: string | null;
  bank_account_number: string | null;
  ifsc_code: string | null;
  role_id: number;
  parent_id: string | null;
  mpin: string | null;
  password: string | null;
  deposit_limit: number;
  withdraw_daily_limit: number;
  file_urls: string[] | null;
  is_active: boolean;
  is_verified: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Wallet {
  id: string;
  user_id: string;
  balance: number;
  type: WalletType;
  created_at: Date;
  updated_at: Date;
}

export interface WalletTransaction {
  id: string;
  wallet_id: string;
  user_id: string;
  type: TransactionType;
  amount: number;
  balance_before: number;
  balance_after: number;
  description: string | null;
  reference_id: string | null;
  reference_type: ReferenceType;
  status: TxnStatus;
  created_at: Date;
}

/** JWT payload embedded in every authenticated request */
export interface JwtPayload {
  userId: string;
  email: string;
  roleLevel: number;
  roleName: string;
}
