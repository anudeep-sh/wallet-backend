/**
 * Payin service — SLPE payment gateway integration.
 *
 * Flow:
 *   1. User calls /initiate → we create an SLPE order and return the payment URL
 *   2. User pays on the SLPE-hosted payment page
 *   3. Our poller checks status every 30 s for up to 10 min
 *   4. On "paid" status → calculate commissions, credit all wallets atomically
 *   5. (Backup) SLPE webhook also triggers processing
 */
import walletDb from "../../database/wallet-db";
import {
  BadRequestError,
  NotFoundError,
  UnprocessableError,
} from "../../lib/errors";
import { TransactionType, ReferenceType, TxnStatus } from "../../wallet-types";
import { calculateCommissions } from "../commission/commission.service";
import { slpe } from "../slpe/slpe.service";
import { PayinStatus } from "./payin.types";
import type { InitiatePayinBody } from "./payin.types";
import { logger } from "../../utils/logger";
import { normalizePhoneForSlpe } from "../../utils/phone-normalize";

const POLL_DURATION_MS = 10 * 60 * 1000; // 10 minutes
/** SLPE requires expiry ≥20 min from *their* clock; they interpret times in IST. */
const LINK_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes (SLPE minimum: 25 min)

/** Format as `YYYY-MM-DD HH:mm:ss` in Asia/Kolkata (IST) — must match SLPE server time. */
function formatPaymentLinkExpiryForSlpe(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

/* ------------------------------------------------------------------ */
/*  INITIATE PAYIN                                                     */
/* ------------------------------------------------------------------ */

export const initiatePayin = async (
  userId: string,
  body: InitiatePayinBody,
) => {
  if (!body.amount || body.amount <= 0)
    throw new BadRequestError("Amount must be positive");

  const user = await walletDb("w_users").where({ id: userId }).first();
  if (!user) throw new NotFoundError("User not found");

  if (user.deposit_limit > 0 && body.amount > Number(user.deposit_limit)) {
    throw new UnprocessableError(
      `Amount ${body.amount} exceeds your deposit limit of ${user.deposit_limit}`,
    );
  }

  const phoneForSlpe = normalizePhoneForSlpe(
    user.mobile_number,
    "Mobile number",
  );

  const now = new Date();
  const expiresAt = new Date(now.getTime() + LINK_EXPIRY_MS);
  const pollUntil = new Date(now.getTime() + POLL_DURATION_MS);

  /* Create a placeholder payin so we have an ID for the redirection URL */
  const [payin] = await walletDb("w_payins")
    .insert({
      user_id: userId,
      amount: body.amount,
      gateway: "slpe",
      status: PayinStatus.INITIATED,
    })
    .returning("*");

  /* Call SLPE create-order */
  let slpeOrder;
  try {
    slpeOrder = await slpe.createOrder({
      amount: body.amount,
      call_back_url: slpe.getPayinCallbackUrl(),
      redirection_url: `${slpe.getFrontendBase()}/payins?payinId=${payin.id}`,
      gateway_id: slpe.getPayinGatewayId(),
      payment_link_expiry: formatPaymentLinkExpiryForSlpe(expiresAt),
      payment_for: body.paymentFor || "Wallet Top-up",
      customer: {
        name: `${user.first_name} ${user.last_name}`,
        email: user.email,
        phone: phoneForSlpe,
      },
      mode: { netbanking: true, card: true, upi: true, wallet: true },
      notification: { sms: false, email: false },
    });
  } catch (err: any) {
    await walletDb("w_payins")
      .where({ id: payin.id })
      .update({ status: PayinStatus.FAILED, updated_at: walletDb.fn.now() });
    throw new UnprocessableError(`Payment gateway error: ${err.message}`);
  }

  if (!slpeOrder.result) {
    await walletDb("w_payins")
      .where({ id: payin.id })
      .update({ status: PayinStatus.FAILED, updated_at: walletDb.fn.now() });
    throw new UnprocessableError(
      `Payment gateway rejected: ${slpeOrder.message}`,
    );
  }

  /* Patch payin with SLPE details — poller will pick it up */
  await walletDb("w_payins")
    .where({ id: payin.id })
    .update({
      gateway_order_id: slpeOrder.order_id,
      payin_url: slpeOrder.payment_url,
      poll_until: pollUntil,
      gateway_response: JSON.stringify(slpeOrder),
      updated_at: walletDb.fn.now(),
    });

  logger.info("Payin initiated", {
    payinId: payin.id,
    orderId: slpeOrder.order_id,
    amount: body.amount,
    pollUntil: pollUntil.toISOString(),
  });

  return {
    payinId: payin.id,
    orderId: slpeOrder.order_id,
    amount: body.amount,
    paymentUrl: slpeOrder.payment_url,
  };
};

/* ------------------------------------------------------------------ */
/*  CORE: process a successful payin + commission distribution         */
/*  Called by the poller and by the webhook handler.                    */
/* ------------------------------------------------------------------ */

export const processSuccessfulPayin = async (
  payinId: string,
  gatewayTxnId = "",
) => {
  return walletDb.transaction(async (trx) => {
    const payin = await trx("w_payins").where({ id: payinId }).first();
    if (!payin) throw new NotFoundError("Payin not found");
    if (payin.status === PayinStatus.SUCCESS)
      return { message: "Already processed", payinId };

    const user = await trx("w_users").where({ id: payin.user_id }).first();
    if (!user) throw new NotFoundError("User not found");

    const payinAmount = Number(payin.amount);

    /* Commissions for every ancestor up the chain */
    const commissions = await calculateCommissions(
      user.id,
      user.role_id,
      payinAmount,
    );
    const totalCommission = commissions.reduce((s, c) => s + c.amount, 0);
    const netAmount = Math.round((payinAmount - totalCommission) * 100) / 100;

    /* Update payin record */
    await trx("w_payins").where({ id: payinId }).update({
      gateway_txn_id: gatewayTxnId,
      total_commission: totalCommission,
      net_amount: netAmount,
      status: PayinStatus.SUCCESS,
      updated_at: trx.fn.now(),
    });

    /* Credit each ancestor's COMMISSION wallet + ledger entry */
    for (const comm of commissions) {
      const wallet = await trx("w_wallets")
        .where({ user_id: comm.toUserId, type: "commission" })
        .first();
      if (!wallet) continue;

      const before = Number(wallet.balance);
      const after = Math.round((before + comm.amount) * 100) / 100;

      await trx("w_wallets").where({ id: wallet.id }).update({
        balance: after,
        updated_at: trx.fn.now(),
      });

      await trx("w_transactions").insert({
        wallet_id: wallet.id,
        user_id: comm.toUserId,
        type: TransactionType.CREDIT,
        amount: comm.amount,
        balance_before: before,
        balance_after: after,
        description: `Commission from payin by ${user.first_name} ${user.last_name}`,
        reference_id: payinId,
        reference_type: ReferenceType.COMMISSION,
        status: TxnStatus.SUCCESS,
      });

      await trx("w_commission_ledger").insert({
        payin_id: payinId,
        from_user_id: user.id,
        to_user_id: comm.toUserId,
        amount: comm.amount,
        percentage: comm.percentage,
      });
    }

    /* Credit the payer's MAIN wallet with the net amount */
    const payerWallet = await trx("w_wallets")
      .where({ user_id: user.id, type: "main" })
      .first();
    if (payerWallet) {
      const pBefore = Number(payerWallet.balance);
      const pAfter = Math.round((pBefore + netAmount) * 100) / 100;

      await trx("w_wallets").where({ id: payerWallet.id }).update({
        balance: pAfter,
        updated_at: trx.fn.now(),
      });

      await trx("w_transactions").insert({
        wallet_id: payerWallet.id,
        user_id: user.id,
        type: TransactionType.CREDIT,
        amount: netAmount,
        balance_before: pBefore,
        balance_after: pAfter,
        description: `Payin credit (net after ₹${totalCommission} commission)`,
        reference_id: payinId,
        reference_type: ReferenceType.PAYIN,
        status: TxnStatus.SUCCESS,
      });
    }

    logger.info("Payin processed", {
      payinId,
      amount: payinAmount,
      totalCommission,
      netAmount,
      commissions: commissions.length,
    });

    return {
      payinId,
      amount: payinAmount,
      totalCommission,
      netAmount,
      commissions,
    };
  });
};

/* ------------------------------------------------------------------ */
/*  SLPE WEBHOOK (backup to polling)                                   */
/* ------------------------------------------------------------------ */

export const handleSlpeWebhook = async (payload: any) => {
  logger.info("SLPE payin webhook received");

  const orderId = payload?.order_id || payload?.data?.order_id;
  if (!orderId) return { status: "ignored", reason: "no order_id" };

  const payin = await walletDb("w_payins")
    .where({ gateway_order_id: orderId })
    .first();
  if (!payin || payin.status === PayinStatus.SUCCESS)
    return { status: "ignored" };

  /* Re-verify via SLPE API — never trust the webhook body blindly */
  const statusRes = await slpe.getOrderStatus(orderId);
  await walletDb("w_payins")
    .where({ id: payin.id })
    .update({
      last_polled_at: new Date(),
      gateway_response: JSON.stringify(statusRes),
      updated_at: walletDb.fn.now(),
    });

  const orderStatus = statusRes?.data?.order_data?.status;
  if (orderStatus === "paid") {
    const txnId =
      statusRes.data.order_data.transaction_id ||
      statusRes.data.order_data.merchant_ref_id ||
      "";
    await processSuccessfulPayin(payin.id, txnId);
    return { status: "ok" };
  }

  return { status: "noted", orderStatus };
};

/* ------------------------------------------------------------------ */
/*  FRONTEND STATUS CHECK (used by frontend polling)                   */
/* ------------------------------------------------------------------ */

export const checkPayinStatus = async (userId: string, payinId: string) => {
  const payin = await walletDb("w_payins")
    .where({ id: payinId, user_id: userId })
    .first();
  if (!payin) throw new NotFoundError("Payin not found");

  return {
    payinId: payin.id,
    status: payin.status,
    amount: Number(payin.amount),
    paymentUrl: payin.payin_url,
    createdAt: payin.created_at,
    netAmount: payin.net_amount ? Number(payin.net_amount) : null,
    totalCommission: payin.total_commission
      ? Number(payin.total_commission)
      : null,
  };
};

/* ------------------------------------------------------------------ */
/*  LIST / DETAILS                                                     */
/* ------------------------------------------------------------------ */

export const listPayins = async (userId: string, page = 1, limit = 20) => {
  const offset = (page - 1) * limit;
  const rows = await walletDb("w_payins")
    .where({ user_id: userId })
    .orderBy("created_at", "desc")
    .limit(limit)
    .offset(offset);

  const [{ total }] = await walletDb("w_payins")
    .where({ user_id: userId })
    .count("id as total");

  return { payins: rows, pagination: { page, limit, total: Number(total) } };
};

export const getPayinDetails = async (userId: string, payinId: string) => {
  const payin = await walletDb("w_payins")
    .where({ id: payinId, user_id: userId })
    .first();
  if (!payin) throw new NotFoundError("Payin not found");

  const commissions = await walletDb("w_commission_ledger")
    .leftJoin("w_users", "w_commission_ledger.to_user_id", "w_users.id")
    .leftJoin("w_roles", "w_users.role_id", "w_roles.id")
    .where({ payin_id: payinId })
    .select(
      "w_commission_ledger.*",
      "w_users.first_name",
      "w_users.last_name",
      "w_roles.name as role_name",
    );

  return { payin, commissions };
};
