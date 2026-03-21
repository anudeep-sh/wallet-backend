/**
 * SLPE Payment Gateway — HTTP client wrapper.
 *
 * Credentials are hardcoded for testing.
 * In production, move these to environment variables or a vault.
 */
import { logger } from "../../utils/logger";
import type {
  CreateOrderRequest,
  CreateOrderResponse,
  OrderStatusResponse,
  CreatePayoutRequest,
  CreatePayoutResponse,
  PayoutStatusResponse,
  BankValidationRequest,
  BankValidationResponse,
  GatewayListResponse,
} from "./slpe.types";

const SLPE_BASE_URL = "https://api.slpe.in/api/v2";

const SLPE_ACCESS_TOKEN =
  "access_token_+sxImtj2v5m80PZ2/F+mXbQTmjpBKC6hXQb6oShNf4n+7de3KmWPkoREV0epba2QHtudSLNixOT9ldO+UlMhnA==";
const SLPE_API_KEY = "key_lq92rmsH7nCoH8VJXgXQriIBufLtCvhe";
const SLPE_API_SECRET = "secret_IRmN8qk1GLLs84OMhC4GYskzKVO1Wk9Q";
const SLPE_API_MODE: "test" | "live" = "live";

const SLPE_PAYIN_GATEWAY_ID = "17";
const SLPE_PAYOUT_GATEWAY_ID = "10";

const CALLBACK_BASE = process.env.SLPE_CALLBACK_BASE || "http://localhost:8080";

const FRONTEND_BASE = process.env.FRONTEND_URL || "http://localhost:3000";

const authHeaders: Record<string, string> = {
  "Content-Type": "application/json",
  "access-token": SLPE_ACCESS_TOKEN,
  "api-key": SLPE_API_KEY,
  "api-secret": SLPE_API_SECRET,
  "api-mode": SLPE_API_MODE,
};

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${SLPE_BASE_URL}${path}`;
  const opts: RequestInit = { method, headers: authHeaders };
  if (body) opts.body = JSON.stringify(body);

  logger.info("SLPE →", { method, url });

  const res = await fetch(url, opts);
  const data = await res.json();

  if (!res.ok) {
    logger.error("SLPE error", { url, status: res.status, data });
    throw new Error(
      `SLPE ${res.status}: ${data?.message || JSON.stringify(data)}`,
    );
  }

  logger.info("SLPE ←", { url, status: res.status });
  return data as T;
}

/* ------------------------------------------------------------------ */
/*  Exported methods                                                   */
/* ------------------------------------------------------------------ */

export const slpe = {
  /* Payment Gateway (Payin) */
  createOrder: (p: CreateOrderRequest) =>
    request<CreateOrderResponse>("POST", "/create-order", p),

  getOrderStatus: (orderId: string) =>
    request<OrderStatusResponse>("GET", `/order-status/${orderId}`),

  /* Payout */
  createPayout: (p: CreatePayoutRequest) =>
    request<CreatePayoutResponse>("POST", "/create-payout", p),

  getPayoutStatus: (payoutId: string) =>
    request<PayoutStatusResponse>("GET", `/payout-status/${payoutId}`),

  /* Bank Account Validation */
  validateBankAccount: (p: BankValidationRequest) =>
    request<BankValidationResponse>("POST", "/account-validation", p),

  /* Gateway List */
  getGatewayList: () => request<GatewayListResponse>("GET", "/gateway-list"),

  /* Helpers */
  getPayinCallbackUrl: () => `${CALLBACK_BASE}/api/wallet/payins/slpe-webhook`,

  getPayoutCallbackUrl: () =>
    `${CALLBACK_BASE}/api/wallet/payouts/slpe-webhook`,

  getPayinGatewayId: () => SLPE_PAYIN_GATEWAY_ID,
  getPayoutGatewayId: () => SLPE_PAYOUT_GATEWAY_ID,
  getFrontendBase: () => FRONTEND_BASE,
};
