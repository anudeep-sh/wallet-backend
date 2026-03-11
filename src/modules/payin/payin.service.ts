/**
 * Payin service — Razorpay order creation, payment verification,
 * webhook handling, and commission distribution.
 *
 * The main flow:
 *   1. User calls /initiate → system creates a Razorpay order and returns the pay URL
 *   2. User pays on the Razorpay checkout page
 *   3. Client calls /verify with the Razorpay signature
 *   4. (Alternatively) Razorpay sends a webhook to /webhook
 *   5. On success: calculate commissions, credit all wallets atomically
 */
import crypto from 'crypto';
import walletDb from '../../database/wallet-db';
import { BadRequestError, NotFoundError, UnprocessableError } from '../../lib/errors';
import { TransactionType, ReferenceType, TxnStatus } from '../../wallet-types';
import { calculateCommissions } from '../commission/commission.service';
import type { InitiatePayinBody, VerifyPayinBody } from './payin.types';
import { logger } from '../../utils/logger';

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';

/* ------------------------------------------------------------------ */
/*  Razorpay HTTP helpers (using fetch to avoid extra dependency)      */
/* ------------------------------------------------------------------ */

const razorpayBase = 'https://api.razorpay.com/v1';
const authHeader = 'Basic ' + Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');

/** Create a Razorpay order via their REST API */
const createRazorpayOrder = async (amountPaise: number, receipt: string) => {
  const res = await fetch(`${razorpayBase}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader },
    body: JSON.stringify({
      amount: amountPaise,
      currency: 'INR',
      receipt,
      payment_capture: 1,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Razorpay order creation failed: ${err}`);
  }
  return res.json();
};

/** Verify Razorpay signature (HMAC SHA256) */
const verifySignature = (orderId: string, paymentId: string, signature: string): boolean => {
  const expected = crypto
    .createHmac('sha256', RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return expected === signature;
};

/* ------------------------------------------------------------------ */
/*  INITIATE PAYIN                                                     */
/* ------------------------------------------------------------------ */

export const initiatePayin = async (userId: string, body: InitiatePayinBody) => {
  if (!body.amount || body.amount <= 0) throw new BadRequestError('Amount must be positive');

  /* Enforce deposit limit */
  const user = await walletDb('w_users').where({ id: userId }).first();
  if (!user) throw new NotFoundError('User not found');
  if (user.deposit_limit > 0 && body.amount > Number(user.deposit_limit)) {
    throw new UnprocessableError(
      `Amount ${body.amount} exceeds your deposit limit of ${user.deposit_limit}`,
    );
  }

  /* Create Razorpay order (amount in paise) */
  const amountPaise = Math.round(body.amount * 100);
  const rzpOrder = await createRazorpayOrder(amountPaise, `payin_${userId}_${Date.now()}`);

  /* Persist the payin record */
  const [payin] = await walletDb('w_payins').insert({
    user_id: userId,
    amount: body.amount,
    gateway: 'razorpay',
    gateway_order_id: rzpOrder.id,
    payin_url: `https://api.razorpay.com/v1/checkout/embedded?order_id=${rzpOrder.id}&key_id=${RAZORPAY_KEY_ID}`,
    status: 'initiated',
  }).returning('*');

  return {
    payinId: payin.id,
    orderId: rzpOrder.id,
    amount: body.amount,
    currency: 'INR',
    keyId: RAZORPAY_KEY_ID,
    payinUrl: payin.payin_url,
  };
};

/* ------------------------------------------------------------------ */
/*  VERIFY PAYIN (client callback)                                     */
/* ------------------------------------------------------------------ */

export const verifyPayin = async (body: VerifyPayinBody) => {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = body;

  /* Signature check */
  if (!verifySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
    throw new BadRequestError('Invalid payment signature');
  }

  /* Find the payin */
  const payin = await walletDb('w_payins')
    .where({ gateway_order_id: razorpayOrderId })
    .first();

  if (!payin) throw new NotFoundError('Payin not found');
  if (payin.status === 'success') return { message: 'Already processed', payinId: payin.id };

  /* Process the successful payment */
  return processSuccessfulPayin(payin.id, razorpayPaymentId, razorpaySignature);
};

/* ------------------------------------------------------------------ */
/*  WEBHOOK (server-to-server from Razorpay)                           */
/* ------------------------------------------------------------------ */

export const handleWebhook = async (rawBody: string, signature: string) => {
  /* Verify webhook signature */
  const expected = crypto
    .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  if (expected !== signature) {
    logger.warn('Razorpay webhook signature mismatch');
    return { status: 'ignored' };
  }

  const payload = JSON.parse(rawBody);
  if (payload.event !== 'payment.captured') return { status: 'ignored' };

  const payment = payload.payload.payment.entity;
  const payin = await walletDb('w_payins')
    .where({ gateway_order_id: payment.order_id })
    .first();

  if (!payin || payin.status === 'success') return { status: 'ignored' };

  await processSuccessfulPayin(payin.id, payment.id, '');
  return { status: 'ok' };
};

/* ------------------------------------------------------------------ */
/*  CORE: process a successful payin + commission distribution         */
/* ------------------------------------------------------------------ */

/**
 * Atomic transaction that:
 * 1. Updates the payin status
 * 2. Calculates commissions for every ancestor in the chain
 * 3. Credits each ancestor's wallet
 * 4. Credits the swiper's wallet (amount minus total commission)
 * 5. Records everything in w_transactions and w_commission_ledger
 */
const processSuccessfulPayin = async (
  payinId: string,
  gatewayPaymentId: string,
  gatewaySignature: string,
) => {
  return walletDb.transaction(async (trx) => {
    const payin = await trx('w_payins').where({ id: payinId }).first();
    const user = await trx('w_users').where({ id: payin.user_id }).first();
    const payinAmount = Number(payin.amount);

    /* Calculate commissions for every ancestor */
    const commissions = await calculateCommissions(user.id, user.role_id, payinAmount);
    const totalCommission = commissions.reduce((sum, c) => sum + c.amount, 0);
    const netAmount = payinAmount - totalCommission;

    /* Update payin record */
    await trx('w_payins').where({ id: payinId }).update({
      gateway_payment_id: gatewayPaymentId,
      gateway_signature: gatewaySignature,
      total_commission: totalCommission,
      net_amount: netAmount,
      status: 'success',
      updated_at: trx.fn.now(),
    });

    /* Credit each ancestor's wallet + commission ledger entry */
    for (const comm of commissions) {
      const wallet = await trx('w_wallets').where({ user_id: comm.toUserId }).first();
      if (!wallet) continue;

      const balanceBefore = Number(wallet.balance);
      const balanceAfter = balanceBefore + comm.amount;

      await trx('w_wallets').where({ id: wallet.id }).update({
        balance: balanceAfter,
        updated_at: trx.fn.now(),
      });

      await trx('w_transactions').insert({
        wallet_id: wallet.id,
        user_id: comm.toUserId,
        type: TransactionType.CREDIT,
        amount: comm.amount,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        description: `Commission from payin by ${user.first_name} ${user.last_name}`,
        reference_id: payinId,
        reference_type: ReferenceType.COMMISSION,
        status: TxnStatus.SUCCESS,
      });

      await trx('w_commission_ledger').insert({
        payin_id: payinId,
        from_user_id: user.id,
        to_user_id: comm.toUserId,
        amount: comm.amount,
        percentage: comm.percentage,
      });
    }

    /* Credit the swiper's own wallet with net amount */
    const swiperWallet = await trx('w_wallets').where({ user_id: user.id }).first();
    if (swiperWallet) {
      const swiperBefore = Number(swiperWallet.balance);
      const swiperAfter = swiperBefore + netAmount;

      await trx('w_wallets').where({ id: swiperWallet.id }).update({
        balance: swiperAfter,
        updated_at: trx.fn.now(),
      });

      await trx('w_transactions').insert({
        wallet_id: swiperWallet.id,
        user_id: user.id,
        type: TransactionType.CREDIT,
        amount: netAmount,
        balance_before: swiperBefore,
        balance_after: swiperAfter,
        description: `Payin credit (net after ${totalCommission} commission)`,
        reference_id: payinId,
        reference_type: ReferenceType.PAYIN,
        status: TxnStatus.SUCCESS,
      });
    }

    logger.info('Payin processed', {
      payinId,
      amount: payinAmount,
      totalCommission,
      netAmount,
      commissionEntries: commissions.length,
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
/*  LIST / DETAILS                                                     */
/* ------------------------------------------------------------------ */

/** List the user's own payins (paginated) */
export const listPayins = async (userId: string, page = 1, limit = 20) => {
  const offset = (page - 1) * limit;
  const rows = await walletDb('w_payins')
    .where({ user_id: userId })
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset);

  const [{ total }] = await walletDb('w_payins')
    .where({ user_id: userId })
    .count('id as total');

  return { payins: rows, pagination: { page, limit, total: Number(total) } };
};

/** Get a single payin with its commission breakdown */
export const getPayinDetails = async (userId: string, payinId: string) => {
  const payin = await walletDb('w_payins').where({ id: payinId, user_id: userId }).first();
  if (!payin) throw new NotFoundError('Payin not found');

  const commissions = await walletDb('w_commission_ledger')
    .leftJoin('w_users', 'w_commission_ledger.to_user_id', 'w_users.id')
    .leftJoin('w_roles', 'w_users.role_id', 'w_roles.id')
    .where({ payin_id: payinId })
    .select(
      'w_commission_ledger.*',
      'w_users.first_name',
      'w_users.last_name',
      'w_roles.name as role_name',
    );

  return { payin, commissions };
};
