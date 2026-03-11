/**
 * Wallet service — balance, transaction history, daily summary.
 */
import walletDb from '../../database/wallet-db';
import { NotFoundError } from '../../lib/errors';
import type { TransactionQuery } from './wallet.types';

/** Get the user's current wallet balance */
export const getBalance = async (userId: string) => {
  const wallet = await walletDb('w_wallets').where({ user_id: userId }).first();
  if (!wallet) throw new NotFoundError('Wallet not found — contact support');
  return {
    walletId: wallet.id,
    balance: Number(wallet.balance),
    updatedAt: wallet.updated_at,
  };
};

/** Paginated, filterable transaction history */
export const getTransactions = async (userId: string, query: TransactionQuery) => {
  const page = parseInt(query.page || '1', 10);
  const limit = parseInt(query.limit || '50', 10);
  const offset = (page - 1) * limit;

  let q = walletDb('w_transactions').where({ user_id: userId });
  let countQ = walletDb('w_transactions').where({ user_id: userId });

  if (query.type) {
    q = q.where({ type: query.type });
    countQ = countQ.where({ type: query.type });
  }
  if (query.referenceType) {
    q = q.where({ reference_type: query.referenceType });
    countQ = countQ.where({ reference_type: query.referenceType });
  }
  if (query.fromDate) {
    q = q.where('created_at', '>=', query.fromDate);
    countQ = countQ.where('created_at', '>=', query.fromDate);
  }
  if (query.toDate) {
    q = q.where('created_at', '<=', query.toDate);
    countQ = countQ.where('created_at', '<=', query.toDate);
  }

  const rows = await q.orderBy('created_at', 'desc').limit(limit).offset(offset);
  const [{ total }] = await countQ.count('id as total');

  return {
    transactions: rows,
    pagination: { page, limit, total: Number(total) },
  };
};

/** Quick summary: balance + today's credit/debit totals */
export const getSummary = async (userId: string) => {
  const wallet = await walletDb('w_wallets').where({ user_id: userId }).first();
  if (!wallet) throw new NotFoundError('Wallet not found');

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayCredits = await walletDb('w_transactions')
    .where({ user_id: userId, type: 'credit' })
    .where('created_at', '>=', todayStart)
    .sum('amount as total')
    .first();

  const todayDebits = await walletDb('w_transactions')
    .where({ user_id: userId, type: 'debit' })
    .where('created_at', '>=', todayStart)
    .sum('amount as total')
    .first();

  return {
    balance: Number(wallet.balance),
    todayCredits: Number(todayCredits?.total || 0),
    todayDebits: Number(todayDebits?.total || 0),
  };
};
