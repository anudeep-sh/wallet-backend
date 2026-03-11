/**
 * Payout service — withdrawal requests, approval/rejection flow.
 *
 * Flow:
 *   1. User requests a withdrawal (MPIN must be verified first)
 *   2. Admin or parent approves → funds are debited from wallet
 *   3. Or admin/parent rejects with a reason
 */
import walletDb from '../../database/wallet-db';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
} from '../../lib/errors';
import { TransactionType, ReferenceType, TxnStatus, PayoutStatus } from '../../wallet-types';
import type { RequestPayoutBody, RejectPayoutBody } from './payout.types';

/** Request a withdrawal — user must have sufficient balance and within daily limit */
export const requestPayout = async (userId: string, body: RequestPayoutBody) => {
  if (!body.amount || body.amount <= 0) throw new BadRequestError('Amount must be positive');

  const user = await walletDb('w_users').where({ id: userId }).first();
  if (!user) throw new NotFoundError('User not found');

  const wallet = await walletDb('w_wallets').where({ user_id: userId }).first();
  if (!wallet) throw new NotFoundError('Wallet not found');

  /* Balance check */
  if (Number(wallet.balance) < body.amount) {
    throw new UnprocessableError(
      `Insufficient balance: ${wallet.balance} available, ${body.amount} requested`,
    );
  }

  /* Daily withdraw limit check */
  if (Number(user.withdraw_daily_limit) > 0) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayTotal = await walletDb('w_payouts')
      .where({ user_id: userId })
      .whereIn('status', [PayoutStatus.PENDING, PayoutStatus.APPROVED, PayoutStatus.PROCESSING, PayoutStatus.COMPLETED])
      .where('created_at', '>=', todayStart)
      .sum('amount as total')
      .first();

    const alreadyRequested = Number(todayTotal?.total || 0);
    if (alreadyRequested + body.amount > Number(user.withdraw_daily_limit)) {
      throw new UnprocessableError(
        `Daily limit exceeded: ${user.withdraw_daily_limit} limit, ${alreadyRequested} already requested today`,
      );
    }
  }

  const [payout] = await walletDb('w_payouts').insert({
    user_id: userId,
    amount: body.amount,
    bank_account_number: body.bankAccountNumber || user.bank_account_number,
    ifsc_code: body.ifscCode || user.ifsc_code,
    account_holder_name: body.accountHolderName || `${user.first_name} ${user.last_name}`,
    status: PayoutStatus.PENDING,
  }).returning('*');

  await walletDb('w_audit_logs').insert({
    user_id: userId,
    action: 'PAYOUT_REQUESTED',
    entity_type: 'payout',
    entity_id: payout.id,
    meta: JSON.stringify({ amount: body.amount }),
  });

  return { message: 'Withdrawal request submitted', payoutId: payout.id };
};

/** Approve a payout — debit the user's wallet atomically */
export const approvePayout = async (approverId: string, payoutId: string) => {
  return walletDb.transaction(async (trx) => {
    const payout = await trx('w_payouts').where({ id: payoutId }).first();
    if (!payout) throw new NotFoundError('Payout not found');
    if (payout.status !== PayoutStatus.PENDING) {
      throw new BadRequestError(`Cannot approve a payout in '${payout.status}' status`);
    }

    const wallet = await trx('w_wallets').where({ user_id: payout.user_id }).first();
    if (!wallet) throw new NotFoundError('User wallet not found');
    if (Number(wallet.balance) < Number(payout.amount)) {
      throw new UnprocessableError('User no longer has sufficient balance');
    }

    /* Debit the wallet */
    const balanceBefore = Number(wallet.balance);
    const balanceAfter = balanceBefore - Number(payout.amount);

    await trx('w_wallets').where({ id: wallet.id }).update({
      balance: balanceAfter,
      updated_at: trx.fn.now(),
    });

    await trx('w_transactions').insert({
      wallet_id: wallet.id,
      user_id: payout.user_id,
      type: TransactionType.DEBIT,
      amount: payout.amount,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      description: `Withdrawal approved (payout ${payoutId})`,
      reference_id: payoutId,
      reference_type: ReferenceType.PAYOUT,
      status: TxnStatus.SUCCESS,
    });

    /* Update payout status */
    await trx('w_payouts').where({ id: payoutId }).update({
      status: PayoutStatus.APPROVED,
      approved_by: approverId,
      updated_at: trx.fn.now(),
    });

    await trx('w_audit_logs').insert({
      user_id: approverId,
      action: 'PAYOUT_APPROVED',
      entity_type: 'payout',
      entity_id: payoutId,
    });

    return { message: 'Payout approved and wallet debited', payoutId };
  });
};

/** Reject a payout with a reason */
export const rejectPayout = async (rejecterId: string, payoutId: string, body: RejectPayoutBody) => {
  if (!body.reason) throw new BadRequestError('Rejection reason is required');

  const payout = await walletDb('w_payouts').where({ id: payoutId }).first();
  if (!payout) throw new NotFoundError('Payout not found');
  if (payout.status !== PayoutStatus.PENDING) {
    throw new BadRequestError(`Cannot reject a payout in '${payout.status}' status`);
  }

  await walletDb('w_payouts').where({ id: payoutId }).update({
    status: PayoutStatus.REJECTED,
    approved_by: rejecterId,
    rejection_reason: body.reason,
    updated_at: walletDb.fn.now(),
  });

  await walletDb('w_audit_logs').insert({
    user_id: rejecterId,
    action: 'PAYOUT_REJECTED',
    entity_type: 'payout',
    entity_id: payoutId,
    meta: JSON.stringify({ reason: body.reason }),
  });

  return { message: 'Payout rejected', payoutId };
};

/** List the user's own payouts (paginated) */
export const listPayouts = async (userId: string, page = 1, limit = 20) => {
  const offset = (page - 1) * limit;
  const rows = await walletDb('w_payouts')
    .where({ user_id: userId })
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset);

  const [{ total }] = await walletDb('w_payouts')
    .where({ user_id: userId })
    .count('id as total');

  return { payouts: rows, pagination: { page, limit, total: Number(total) } };
};

/** Get a single payout's details */
export const getPayoutDetails = async (userId: string, payoutId: string) => {
  const payout = await walletDb('w_payouts').where({ id: payoutId, user_id: userId }).first();
  if (!payout) throw new NotFoundError('Payout not found');
  return payout;
};
