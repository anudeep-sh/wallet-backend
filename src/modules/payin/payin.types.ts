/** POST /api/wallet/payins/initiate */
export interface InitiatePayinBody {
  /** Amount in INR (paise precision handled internally) */
  amount: number;
}

/** POST /api/wallet/payins/verify — client-side callback after Razorpay checkout */
export interface VerifyPayinBody {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

/** Razorpay webhook payload (payment.captured event) */
export interface RazorpayWebhookPayload {
  event: string;
  payload: {
    payment: {
      entity: {
        id: string;
        order_id: string;
        amount: number;
        status: string;
      };
    };
  };
}
