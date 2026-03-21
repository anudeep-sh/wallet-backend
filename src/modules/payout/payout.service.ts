/**
 * Payout service — SLPE integration with bank validation and polling.
 *
 * Flow:
 *   1. User requests a withdrawal (balance + daily-limit check)
 *   2. Admin approves → validate bank via SLPE → debit wallet → create SLPE payout
 *   3. Poller checks payout status every 30 s for 10 min
 *   4. On completion → mark as completed
 *   5. On failure  → mark as failed, refund wallet
 */
import walletDb from "../../database/wallet-db";
import {
  BadRequestError,
  NotFoundError,
  UnprocessableError,
} from "../../lib/errors";
import {
  TransactionType,
  ReferenceType,
  TxnStatus,
  PayoutStatus,
} from "../../wallet-types";
import { slpe } from "../slpe/slpe.service";
import type { RequestPayoutBody, RejectPayoutBody } from "./payout.types";
import { logger } from "../../utils/logger";
import { normalizePhoneForSlpe } from "../../utils/phone-normalize";

const POLL_DURATION_MS = 10 * 60 * 1000;

/* ------------------------------------------------------------------ */
/*  REQUEST PAYOUT                                                     */
/* ------------------------------------------------------------------ */

export const requestPayout = async (
  userId: string,
  body: RequestPayoutBody,
) => {
  if (!body.amount || body.amount <= 0)
    throw new BadRequestError("Amount must be positive");

  const user = await walletDb("w_users").where({ id: userId }).first();
  if (!user) throw new NotFoundError("User not found");

  const wallet = await walletDb("w_wallets").where({ user_id: userId }).first();
  if (!wallet) throw new NotFoundError("Wallet not found");

  if (Number(wallet.balance) < body.amount) {
    throw new UnprocessableError(
      `Insufficient balance: ₹${wallet.balance} available, ₹${body.amount} requested`,
    );
  }

  /* Daily withdraw limit */
  if (Number(user.withdraw_daily_limit) > 0) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayTotal = await walletDb("w_payouts")
      .where({ user_id: userId })
      .whereIn("status", [
        PayoutStatus.PENDING,
        PayoutStatus.APPROVED,
        PayoutStatus.PROCESSING,
        PayoutStatus.COMPLETED,
      ])
      .where("created_at", ">=", todayStart)
      .sum("amount as total")
      .first();

    const already = Number(todayTotal?.total || 0);
    if (already + body.amount > Number(user.withdraw_daily_limit)) {
      throw new UnprocessableError(
        `Daily limit: ₹${user.withdraw_daily_limit}, already ₹${already} today`,
      );
    }
  }

  const [payout] = await walletDb("w_payouts")
    .insert({
      user_id: userId,
      amount: body.amount,
      bank_account_number: body.bankAccountNumber || user.bank_account_number,
      ifsc_code: body.ifscCode || user.ifsc_code,
      account_holder_name:
        body.accountHolderName || `${user.first_name} ${user.last_name}`,
      status: PayoutStatus.PENDING,
    })
    .returning("*");

  await walletDb("w_audit_logs").insert({
    user_id: userId,
    action: "PAYOUT_REQUESTED",
    entity_type: "payout",
    entity_id: payout.id,
    meta: JSON.stringify({ amount: body.amount }),
  });

  return { message: "Withdrawal request submitted", payoutId: payout.id };
};

/* ------------------------------------------------------------------ */
/*  APPROVE PAYOUT (bank validation → debit → SLPE payout)            */
/* ------------------------------------------------------------------ */

export const approvePayout = async (approverId: string, payoutId: string) => {
  const payout = await walletDb("w_payouts").where({ id: payoutId }).first();
  if (!payout) throw new NotFoundError("Payout not found");
  if (payout.status !== PayoutStatus.PENDING) {
    throw new BadRequestError(
      `Cannot approve a payout in '${payout.status}' status`,
    );
  }

  const user = await walletDb("w_users").where({ id: payout.user_id }).first();
  if (!user) throw new NotFoundError("User not found");

  const phoneForSlpe = normalizePhoneForSlpe(
    user.mobile_number,
    "Mobile number",
  );

  /* ---------- Step 1: Validate bank account via SLPE ---------- */
  let bankValidation;
  try {
    bankValidation = await slpe.validateBankAccount({
      account_number: payout.bank_account_number,
      ifsc_code: payout.ifsc_code,
      name: payout.account_holder_name,
      phone: phoneForSlpe,
    });
  } catch (err: any) {
    logger.error("Bank validation failed", {
      payoutId,
      error: err.message,
    });
    throw new UnprocessableError(
      `Bank account validation failed: ${err.message}`,
    );
  }

  /* ---------- Step 2: Debit wallet inside a transaction ---------- */
  await walletDb.transaction(async (trx) => {
    const wallet = await trx("w_wallets")
      .where({ user_id: payout.user_id })
      .first();
    if (!wallet) throw new NotFoundError("Wallet not found");

    if (Number(wallet.balance) < Number(payout.amount)) {
      throw new UnprocessableError("User no longer has sufficient balance");
    }

    const before = Number(wallet.balance);
    const after = Math.round((before - Number(payout.amount)) * 100) / 100;

    await trx("w_wallets").where({ id: wallet.id }).update({
      balance: after,
      updated_at: trx.fn.now(),
    });

    await trx("w_transactions").insert({
      wallet_id: wallet.id,
      user_id: payout.user_id,
      type: TransactionType.DEBIT,
      amount: payout.amount,
      balance_before: before,
      balance_after: after,
      description: `Withdrawal approved (payout ${payoutId})`,
      reference_id: payoutId,
      reference_type: ReferenceType.PAYOUT,
      status: TxnStatus.SUCCESS,
    });

    await trx("w_payouts")
      .where({ id: payoutId })
      .update({
        status: PayoutStatus.APPROVED,
        approved_by: approverId,
        bank_validated: true,
        bank_validation_response: JSON.stringify(bankValidation),
        updated_at: trx.fn.now(),
      });
  });

  /* ---------- Step 3: Create SLPE payout ---------- */
  const bankName = payout.ifsc_code?.substring(0, 4) || "Bank";

  let slpePayout;
  try {
    slpePayout = await slpe.createPayout({
      amount: Number(payout.amount),
      mode: "IMPS",
      call_back_url: slpe.getPayoutCallbackUrl(),
      gateway_id: slpe.getPayoutGatewayId(),
      bank_account: {
        name: payout.account_holder_name,
        ifsc: payout.ifsc_code,
        bank_name: bankName,
        account_number: payout.bank_account_number,
      },
    });
  } catch (err: any) {
    logger.error("SLPE payout creation failed, refunding wallet", {
      payoutId,
      error: err.message,
    });

    /* Refund the wallet since SLPE call failed */
    await walletDb.transaction(async (trx) => {
      const wallet = await trx("w_wallets")
        .where({ user_id: payout.user_id })
        .first();
      if (!wallet) return;

      const before = Number(wallet.balance);
      const refund = Number(payout.amount);
      const after = Math.round((before + refund) * 100) / 100;

      await trx("w_wallets").where({ id: wallet.id }).update({
        balance: after,
        updated_at: trx.fn.now(),
      });

      await trx("w_transactions").insert({
        wallet_id: wallet.id,
        user_id: payout.user_id,
        type: TransactionType.CREDIT,
        amount: refund,
        balance_before: before,
        balance_after: after,
        description: `Payout gateway error — auto-refund (${payoutId})`,
        reference_id: payoutId,
        reference_type: ReferenceType.PAYOUT,
        status: TxnStatus.SUCCESS,
      });

      await trx("w_payouts")
        .where({ id: payoutId })
        .update({
          status: PayoutStatus.FAILED,
          gateway_response: JSON.stringify({ error: err.message }),
          updated_at: trx.fn.now(),
        });
    });

    throw new UnprocessableError(
      `Payout gateway error: ${err.message}. Wallet has been refunded.`,
    );
  }

  /* ---------- Step 4: Update payout → processing, start polling ---------- */
  const pollUntil = new Date(Date.now() + POLL_DURATION_MS);

  await walletDb("w_payouts")
    .where({ id: payoutId })
    .update({
      status: PayoutStatus.PROCESSING,
      gateway: "slpe",
      gateway_txn_id: slpePayout.payout_id,
      gateway_response: JSON.stringify(slpePayout),
      poll_until: pollUntil,
      updated_at: walletDb.fn.now(),
    });

  await walletDb("w_audit_logs").insert({
    user_id: approverId,
    action: "PAYOUT_APPROVED",
    entity_type: "payout",
    entity_id: payoutId,
    meta: JSON.stringify({
      amount: payout.amount,
      slpePayoutId: slpePayout.payout_id,
    }),
  });

  logger.info("Payout approved and submitted", {
    payoutId,
    slpePayoutId: slpePayout.payout_id,
  });

  return {
    message: "Payout approved and submitted to gateway",
    payoutId,
    slpePayoutId: slpePayout.payout_id,
  };
};

/* ------------------------------------------------------------------ */
/*  REJECT PAYOUT                                                      */
/* ------------------------------------------------------------------ */

export const rejectPayout = async (
  rejecterId: string,
  payoutId: string,
  body: RejectPayoutBody,
) => {
  if (!body.reason) throw new BadRequestError("Rejection reason is required");

  const payout = await walletDb("w_payouts").where({ id: payoutId }).first();
  if (!payout) throw new NotFoundError("Payout not found");
  if (payout.status !== PayoutStatus.PENDING) {
    throw new BadRequestError(
      `Cannot reject a payout in '${payout.status}' status`,
    );
  }

  await walletDb("w_payouts").where({ id: payoutId }).update({
    status: PayoutStatus.REJECTED,
    approved_by: rejecterId,
    rejection_reason: body.reason,
    updated_at: walletDb.fn.now(),
  });

  await walletDb("w_audit_logs").insert({
    user_id: rejecterId,
    action: "PAYOUT_REJECTED",
    entity_type: "payout",
    entity_id: payoutId,
    meta: JSON.stringify({ reason: body.reason }),
  });

  return { message: "Payout rejected", payoutId };
};

/* ------------------------------------------------------------------ */
/*  SLPE PAYOUT WEBHOOK (backup to polling)                            */
/* ------------------------------------------------------------------ */

export const handleSlpePayoutWebhook = async (payload: any) => {
  logger.info("SLPE payout webhook received");

  const payoutIdFromGw = payload?.payout_id || payload?.data?.payout_id;
  if (!payoutIdFromGw) return { status: "ignored", reason: "no payout_id" };

  const payout = await walletDb("w_payouts")
    .where({ gateway_txn_id: payoutIdFromGw })
    .first();
  if (!payout || payout.status === PayoutStatus.COMPLETED)
    return { status: "ignored" };

  /* Re-verify via SLPE API */
  const statusRes = await slpe.getPayoutStatus(payoutIdFromGw);
  await walletDb("w_payouts")
    .where({ id: payout.id })
    .update({
      last_polled_at: new Date(),
      gateway_response: JSON.stringify(statusRes),
      updated_at: walletDb.fn.now(),
    });

  const gwStatus = statusRes?.data?.payout_data?.status;

  if (gwStatus === "processed" || gwStatus === "completed") {
    await walletDb("w_payouts").where({ id: payout.id }).update({
      status: PayoutStatus.COMPLETED,
      updated_at: walletDb.fn.now(),
    });
    return { status: "ok" };
  }

  if (gwStatus === "failed" || gwStatus === "reversed") {
    await refundFailedPayout(payout);
    return { status: "refunded" };
  }

  return { status: "noted", gwStatus };
};

/* ------------------------------------------------------------------ */
/*  REFUND A FAILED PAYOUT (called by poller & webhook)                */
/* ------------------------------------------------------------------ */

export const refundFailedPayout = async (payout: any) => {
  return walletDb.transaction(async (trx) => {
    await trx("w_payouts").where({ id: payout.id }).update({
      status: PayoutStatus.FAILED,
      updated_at: trx.fn.now(),
    });

    const wallet = await trx("w_wallets")
      .where({ user_id: payout.user_id })
      .first();
    if (!wallet) return;

    const before = Number(wallet.balance);
    const refund = Number(payout.amount);
    const after = Math.round((before + refund) * 100) / 100;

    await trx("w_wallets").where({ id: wallet.id }).update({
      balance: after,
      updated_at: trx.fn.now(),
    });

    await trx("w_transactions").insert({
      wallet_id: wallet.id,
      user_id: payout.user_id,
      type: TransactionType.CREDIT,
      amount: refund,
      balance_before: before,
      balance_after: after,
      description: `Payout failed — auto-refund (${payout.id})`,
      reference_id: payout.id,
      reference_type: ReferenceType.PAYOUT,
      status: TxnStatus.SUCCESS,
    });

    await trx("w_audit_logs").insert({
      user_id: payout.user_id,
      action: "PAYOUT_FAILED_REFUND",
      entity_type: "payout",
      entity_id: payout.id,
      meta: JSON.stringify({ amount: refund }),
    });

    logger.info("Payout failed, wallet refunded", {
      payoutId: payout.id,
      refund,
    });
  });
};

/* ------------------------------------------------------------------ */
/*  LIST / DETAILS                                                     */
/* ------------------------------------------------------------------ */

export const listPayouts = async (userId: string, page = 1, limit = 20) => {
  const offset = (page - 1) * limit;
  const rows = await walletDb("w_payouts")
    .where({ user_id: userId })
    .orderBy("created_at", "desc")
    .limit(limit)
    .offset(offset);

  const [{ total }] = await walletDb("w_payouts")
    .where({ user_id: userId })
    .count("id as total");

  return { payouts: rows, pagination: { page, limit, total: Number(total) } };
};

export const getPayoutDetails = async (userId: string, payoutId: string) => {
  const payout = await walletDb("w_payouts")
    .where({ id: payoutId, user_id: userId })
    .first();
  if (!payout) throw new NotFoundError("Payout not found");
  return payout;
};
