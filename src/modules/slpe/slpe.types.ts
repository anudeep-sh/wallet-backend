/* ------------------------------------------------------------------ */
/*  SLPE Payment Gateway — TypeScript types                           */
/*  Based on: https://docs.slpe.in  (Postman collection v2)           */
/* ------------------------------------------------------------------ */

export interface SlpeAuthHeaders {
  "Content-Type": "application/json";
  "access-token": string;
  "api-key": string;
  "api-secret": string;
  "api-mode": "test" | "live";
}

/* ------------------------------------------------------------------ */
/*  Create Order (Payin)                                               */
/* ------------------------------------------------------------------ */

export interface CreateOrderRequest {
  amount: number | string;
  call_back_url: string;
  redirection_url?: string;
  gateway_id: string;
  payment_link_expiry: string;
  payment_for: string;
  customer: {
    name: string;
    email: string;
    phone: string;
  };
  mode: {
    netbanking: boolean;
    card: boolean;
    upi: boolean;
    wallet: boolean;
  };
  notification?: {
    sms?: boolean;
    email?: boolean;
  };
}

export interface CreateOrderResponse {
  result: boolean;
  message: string;
  payment_url: string;
  order_id: string;
}

/* ------------------------------------------------------------------ */
/*  Order Status                                                       */
/* ------------------------------------------------------------------ */

export interface OrderStatusResponse {
  data: {
    pg_partner: string;
    pg_partner_id: number;
    order_id: string;
    order_data: {
      status: string;
      merchant_ref_id: string;
      transaction_id: string | null;
      amount: string;
      payment_for: string;
      date: string;
      mode: string;
      mode_data: Record<string, any>;
      expires_at: string;
      customer: { name: string; email: string; phone: string | null };
      callback_response: Record<string, any>;
    };
  };
  status: string;
  message: string;
  code: string;
}

/* ------------------------------------------------------------------ */
/*  Create Payout                                                      */
/* ------------------------------------------------------------------ */

export interface CreatePayoutRequest {
  amount: number;
  mode: "IMPS" | "NEFT";
  call_back_url: string;
  gateway_id: string;
  bank_account: {
    name: string;
    ifsc: string;
    bank_name: string;
    account_number: string;
  };
}

export interface CreatePayoutResponse {
  result: boolean;
  message: string;
  payout_id: string;
  status: string;
}

/* ------------------------------------------------------------------ */
/*  Payout Status                                                      */
/* ------------------------------------------------------------------ */

export interface PayoutStatusResponse {
  data: {
    pg_partner: string;
    pg_partner_id: number;
    payout_id: string;
    payout_data: {
      status: string;
      merchant_ref_id: string;
      amount: string;
      utr: string | null;
      date: string;
      mode: string;
      purpose: string;
      status_description: {
        reason: string | null;
        description: string | null;
        source: string | null;
      };
      bank_account: {
        beneficiary_name: string;
        beneficiary_acc_number: string;
        beneficiary_ifsc: string;
        beneficiary_bank_name: string;
      };
    };
  };
  status: string;
  message: string;
  code: string;
}

/* ------------------------------------------------------------------ */
/*  Bank Account Validation                                            */
/* ------------------------------------------------------------------ */

export interface BankValidationRequest {
  account_number: string;
  ifsc_code: string;
  name: string;
  phone: string;
}

export interface BankValidationResponse {
  result: boolean;
  message: string;
  data?: Record<string, any>;
}

/* ------------------------------------------------------------------ */
/*  Gateway List                                                       */
/* ------------------------------------------------------------------ */

export interface GatewayInfo {
  id: number;
  name: string;
  test_payin: boolean;
  test_payout: boolean;
  live_payin: boolean;
  live_payout: boolean;
}

export interface GatewayListResponse {
  data: GatewayInfo[];
  result: boolean;
  code: number;
}
