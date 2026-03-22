/**
 * Payout service — dual-wallet SLPE integration.
 *
 * Two withdrawal flows:
 *   MAIN wallet    → instant payout (no approval), debit + SLPE call immediately.
 *   COMMISSION wallet → request (hold) → admin approval → SLPE payout.
 *
 * All wallet debits use SELECT ... FOR UPDATE to prevent race conditions.
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
  WalletType,
} from "../../wallet-types";
import { slpe } from "../slpe/slpe.service";
import type { RequestPayoutBody, RejectPayoutBody } from "./payout.types";
import { logger } from "../../utils/logger";
import { normalizePhoneForSlpe } from "../../utils/phone-normalize";

const POLL_DURATION_MS = 10 * 60 * 1000;

/* ================================================================== */
/*  SHARED HELPERS                                                     */
/* ================================================================== */

/**
 * Debit a wallet inside a transaction, using FOR UPDATE to prevent
 * concurrent requests from reading the same balance (rage-click guard).
 */
async function debitWallet(
  trx: any,
  userId: string,
  walletType: WalletType,
  amount: number,
  payoutId: string,
  description: string,
) {
  const wallet = await trx("w_wallets")
    .where({ user_id: userId, type: walletType })
    .forUpdate()
    .first();

  if (!wallet) throw new NotFoundError(`${walletType} wallet not found`);

  if (Number(wallet.balance) < amount) {
    throw new UnprocessableError(
      `Insufficient ${walletType} balance: ₹${wallet.balance} available, ₹${amount} requested`,
    );
  }

  const before = Number(wallet.balance);
  const after = Math.round((before - amount) * 100) / 100;

  await trx("w_wallets").where({ id: wallet.id }).update({
    balance: after,
    updated_at: trx.fn.now(),
  });

  await trx("w_transactions").insert({
    wallet_id: wallet.id,
    user_id: userId,
    type: TransactionType.DEBIT,
    amount,
    balance_before: before,
    balance_after: after,
    description,
    reference_id: payoutId,
    reference_type: ReferenceType.PAYOUT,
    status: TxnStatus.SUCCESS,
  });

  return { walletId: wallet.id, before, after };
}

/** Refund a wallet (credit back). */
async function refundWallet(
  trx: any,
  userId: string,
  walletType: WalletType,
  amount: number,
  payoutId: string,
  description: string,
) {
  const wallet = await trx("w_wallets")
    .where({ user_id: userId, type: walletType })
    .forUpdate()
    .first();
  if (!wallet) return;

  const before = Number(wallet.balance);
  const after = Math.round((before + amount) * 100) / 100;

  await trx("w_wallets").where({ id: wallet.id }).update({
    balance: after,
    updated_at: trx.fn.now(),
  });

  await trx("w_transactions").insert({
    wallet_id: wallet.id,
    user_id: userId,
    type: TransactionType.CREDIT,
    amount,
    balance_before: before,
    balance_after: after,
    description,
    reference_id: payoutId,
    reference_type: ReferenceType.PAYOUT,
    status: TxnStatus.SUCCESS,
  });
}

/** Build SLPE payout payload and submit. */
async function submitSlpePayout(payout: any, user: any) {
  const phoneForSlpe = normalizePhoneForSlpe(user.mobile_number, "Mobile number");
  const bankName = payout.ifsc_code?.substring(0, 4) || "Bank";

  await slpe.validateBankAccount({
    account_number: payout.bank_account_number,
    ifsc_code: payout.ifsc_code,
    name: payout.account_holder_name,
    phone: phoneForSlpe,
  });

  const slpePayout = await slpe.createPayout({
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

  return slpePayout;
}

/* ================================================================== */
/*  REQUEST PAYOUT (entry point for both wallet types)                 */
/* ================================================================== */

export const requestPayout = async (
  userId: string,
  body: RequestPayoutBody,
) => {
  if (!body.amount || body.amount <= 0)
    throw new BadRequestError("Amount must be positive");

  const walletType = (body.walletType || "commission") as WalletType;
  if (walletType !== WalletType.MAIN && walletType !== WalletType.COMMISSION) {
    throw new BadRequestError("walletType must be 'main' or 'commission'");
  }

  const user = await walletDb("w_users").where({ id: userId }).first();
  if (!user) throw new NotFoundError("User not found");

  /* Daily withdraw limit (applies to both wallet types) */
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

  if (walletType === WalletType.MAIN) {
    return requestMainPayout(userId, user, body);
  }
  return requestCommissionPayout(userId, user, body);
};

/* ------------------------------------------------------------------ */
/*  MAIN WALLET PAYOUT — instant, no approval                         */
/* ------------------------------------------------------------------ */

async function requestMainPayout(
  userId: string,
  user: any,
  body: RequestPayoutBody,
) {
  let payout: any;

  /* Atomic: debit main wallet + create payout record */
  await walletDb.transaction(async (trx) => {
    [payout] = await trx("w_payouts")
      .insert({
        user_id: userId,
        amount: body.amount,
        bank_account_number: body.bankAccountNumber || user.bank_account_number,
        ifsc_code: body.ifscCode || user.ifsc_code,
        account_holder_name:
          body.accountHolderName || `${user.first_name} ${user.last_name}`,
        status: PayoutStatus.PROCESSING,
        wallet_type: WalletType.MAIN,
      })
      .returning("*");

    await debitWallet(
      trx,
      userId,
      WalletType.MAIN,
      body.amount,
      payout.id,
      `Withdrawal from main wallet (payout ${payout.id})`,
    );

    await trx("w_audit_logs").insert({
      user_id: userId,
      action: "PAYOUT_MAIN_INSTANT",
      entity_type: "payout",
      entity_id: payout.id,
      meta: JSON.stringify({ amount: body.amount }),
    });
  });

  /* Submit to SLPE outside the DB transaction (don't hold locks during HTTP) */
  let slpePayout;
  try {
    slpePayout = await submitSlpePayout(payout, user);
  } catch (err: any) {
    logger.error("SLPE main payout failed, refunding", {
      payoutId: payout.id,
      error: err.message,
    });

    await walletDb.transaction(async (trx) => {
      await refundWallet(
        trx,
        userId,
        WalletType.MAIN,
        Number(payout.amount),
        payout.id,
        `Main payout gateway error — auto-refund (${payout.id})`,
      );
      await trx("w_payouts").where({ id: payout.id }).update({
        status: PayoutStatus.FAILED,
        gateway_response: JSON.stringify({ error: err.message }),
        updated_at: trx.fn.now(),
      });
    });

    throw new UnprocessableError(
      `Payout gateway error: ${err.message}. Wallet has been refunded.`,
    );
  }

  const pollUntil = new Date(Date.now() + POLL_DURATION_MS);
  await walletDb("w_payouts").where({ id: payout.id }).update({
    gateway: "slpe",
    gateway_txn_id: slpePayout.payout_id,
    gateway_response: JSON.stringify(slpePayout),
    bank_validated: true,
    poll_until: pollUntil,
    updated_at: walletDb.fn.now(),
  });

  logger.info("Main wallet payout submitted (instant)", {
    payoutId: payout.id,
    slpePayoutId: slpePayout.payout_id,
  });

  return {
    message: "Withdrawal submitted to gateway (instant)",
    payoutId: payout.id,
    slpePayoutId: slpePayout.payout_id,
  };
}

/* ------------------------------------------------------------------ */
/*  COMMISSION WALLET PAYOUT — hold on request, admin approval needed  */
/* ------------------------------------------------------------------ */

async function requestCommissionPayout(
  userId: string,
  user: any,
  body: RequestPayoutBody,
) {
  let payout: any;

  /* Atomic: debit (hold) commission wallet + create pending payout */
  await walletDb.transaction(async (trx) => {
    [payout] = await trx("w_payouts")
      .insert({
        user_id: userId,
        amount: body.amount,
        bank_account_number: body.bankAccountNumber || user.bank_account_number,
        ifsc_code: body.ifscCode || user.ifsc_code,
        account_holder_name:
          body.accountHolderName || `${user.first_name} ${user.last_name}`,
        status: PayoutStatus.PENDING,
        wallet_type: WalletType.COMMISSION,
      })
      .returning("*");

    await debitWallet(
      trx,
      userId,
      WalletType.COMMISSION,
      body.amount,
      payout.id,
      `Commission withdrawal hold (payout ${payout.id})`,
    );

    await trx("w_audit_logs").insert({
      user_id: userId,
      action: "PAYOUT_REQUESTED",
      entity_type: "payout",
      entity_id: payout.id,
      meta: JSON.stringify({ amount: body.amount, walletType: "commission" }),
    });
  });

  return { message: "Withdrawal request submitted (pending approval)", payoutId: payout.id };
}

/* ------------------------------------------------------------------ */
/*  APPROVE COMMISSION PAYOUT — admin triggers SLPE                    */
/* ------------------------------------------------------------------ */

export const approvePayout = async (approverId: string, payoutId: string) => {
  const payout = await walletDb("w_payouts").where({ id: payoutId }).first();
  if (!payout) throw new NotFoundError("Payout not found");
  if (payout.status !== PayoutStatus.PENDING) {
    throw new BadRequestError(
      `Cannot approve a payout in '${payout.status}' status`,
    );
  }
  if (payout.wallet_type !== WalletType.COMMISSION) {
    throw new BadRequestError("Only commission wallet payouts require approval");
  }

  const user = await walletDb("w_users").where({ id: payout.user_id }).first();
  if (!user) throw new NotFoundError("User not found");

  /* Mark as approved before SLPE call */
  await walletDb("w_payouts").where({ id: payoutId }).update({
    status: PayoutStatus.APPROVED,
    approved_by: approverId,
    updated_at: walletDb.fn.now(),
  });

  /* Submit to SLPE */
  let slpePayout;
  try {
    slpePayout = await submitSlpePayout(payout, user);
  } catch (err: any) {
    logger.error("SLPE commission payout failed, refunding", {
      payoutId,
      error: err.message,
    });

    /* Refund commission wallet since SLPE failed */
    await walletDb.transaction(async (trx) => {
      await refundWallet(
        trx,
        payout.user_id,
        WalletType.COMMISSION,
        Number(payout.amount),
        payoutId,
        `Commission payout gateway error — auto-refund (${payoutId})`,
      );
      await trx("w_payouts").where({ id: payoutId }).update({
        status: PayoutStatus.FAILED,
        gateway_response: JSON.stringify({ error: err.message }),
        updated_at: trx.fn.now(),
      });
    });

    throw new UnprocessableError(
      `Payout gateway error: ${err.message}. Commission wallet has been refunded.`,
    );
  }

  const pollUntil = new Date(Date.now() + POLL_DURATION_MS);
  await walletDb("w_payouts").where({ id: payoutId }).update({
    status: PayoutStatus.PROCESSING,
    gateway: "slpe",
    gateway_txn_id: slpePayout.payout_id,
    gateway_response: JSON.stringify(slpePayout),
    bank_validated: true,
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

  logger.info("Commission payout approved and submitted", {
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
/*  REJECT COMMISSION PAYOUT — refund the held balance                 */
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

  /* Refund the held commission balance */
  await walletDb.transaction(async (trx) => {
    await refundWallet(
      trx,
      payout.user_id,
      WalletType.COMMISSION,
      Number(payout.amount),
      payoutId,
      `Commission payout rejected — refunded (${payoutId})`,
    );

    await trx("w_payouts").where({ id: payoutId }).update({
      status: PayoutStatus.REJECTED,
      approved_by: rejecterId,
      rejection_reason: body.reason,
      updated_at: trx.fn.now(),
    });

    await trx("w_audit_logs").insert({
      user_id: rejecterId,
      action: "PAYOUT_REJECTED",
      entity_type: "payout",
      entity_id: payoutId,
      meta: JSON.stringify({ reason: body.reason }),
    });
  });

  return { message: "Payout rejected, commission wallet refunded", payoutId };
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
  const wType = (payout.wallet_type || "commission") as WalletType;

  return walletDb.transaction(async (trx) => {
    await trx("w_payouts").where({ id: payout.id }).update({
      status: PayoutStatus.FAILED,
      updated_at: trx.fn.now(),
    });

    await refundWallet(
      trx,
      payout.user_id,
      wType,
      Number(payout.amount),
      payout.id,
      `Payout failed — auto-refund (${payout.id})`,
    );

    await trx("w_audit_logs").insert({
      user_id: payout.user_id,
      action: "PAYOUT_FAILED_REFUND",
      entity_type: "payout",
      entity_id: payout.id,
      meta: JSON.stringify({ amount: Number(payout.amount), walletType: wType }),
    });

    logger.info("Payout failed, wallet refunded", {
      payoutId: payout.id,
      walletType: wType,
      refund: Number(payout.amount),
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
