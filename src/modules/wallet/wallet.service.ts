/**
 * Wallet service — dual-wallet balance, transaction history, daily summary.
 */
import walletDb from "../../database/wallet-db";
import { NotFoundError } from "../../lib/errors";
import type { TransactionQuery } from "./wallet.types";

/** Get the user's current wallet balances (main + commission) */
export const getBalance = async (userId: string) => {
  const wallets = await walletDb("w_wallets").where({ user_id: userId });
  if (wallets.length === 0)
    throw new NotFoundError("Wallet not found — contact support");

  const main = wallets.find((w: any) => w.type === "main");
  const commission = wallets.find((w: any) => w.type === "commission");

  const mainBalance = Number(main?.balance ?? 0);
  const commissionBalance = Number(commission?.balance ?? 0);

  return {
    mainWalletId: main?.id ?? null,
    commissionWalletId: commission?.id ?? null,
    mainBalance,
    commissionBalance,
    balance: Math.round((mainBalance + commissionBalance) * 100) / 100,
    updatedAt: main?.updated_at ?? commission?.updated_at,
  };
};

/** Paginated, filterable transaction history */
export const getTransactions = async (
  userId: string,
  query: TransactionQuery,
) => {
  const page = parseInt(query.page || "1", 10);
  const limit = parseInt(query.limit || "50", 10);
  const offset = (page - 1) * limit;

  let q = walletDb("w_transactions").where({ user_id: userId });
  let countQ = walletDb("w_transactions").where({ user_id: userId });

  if (query.type) {
    q = q.where({ type: query.type });
    countQ = countQ.where({ type: query.type });
  }
  if (query.referenceType) {
    q = q.where({ reference_type: query.referenceType });
    countQ = countQ.where({ reference_type: query.referenceType });
  }
  if (query.walletType) {
    const wallet = await walletDb("w_wallets")
      .where({ user_id: userId, type: query.walletType })
      .first();
    if (wallet) {
      q = q.where({ wallet_id: wallet.id });
      countQ = countQ.where({ wallet_id: wallet.id });
    }
  }
  if (query.fromDate) {
    q = q.where("created_at", ">=", query.fromDate);
    countQ = countQ.where("created_at", ">=", query.fromDate);
  }
  if (query.toDate) {
    q = q.where("created_at", "<=", query.toDate);
    countQ = countQ.where("created_at", "<=", query.toDate);
  }

  const rows = await q
    .orderBy("created_at", "desc")
    .limit(limit)
    .offset(offset);
  const [{ total }] = await countQ.count("id as total");

  return {
    transactions: rows,
    pagination: { page, limit, total: Number(total) },
  };
};

/** Quick summary: both balances + today's credit/debit totals */
export const getSummary = async (userId: string) => {
  const wallets = await walletDb("w_wallets").where({ user_id: userId });
  if (wallets.length === 0) throw new NotFoundError("Wallet not found");

  const main = wallets.find((w: any) => w.type === "main");
  const commission = wallets.find((w: any) => w.type === "commission");

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayCredits = await walletDb("w_transactions")
    .where({ user_id: userId, type: "credit" })
    .where("created_at", ">=", todayStart)
    .sum("amount as total")
    .first();

  const todayDebits = await walletDb("w_transactions")
    .where({ user_id: userId, type: "debit" })
    .where("created_at", ">=", todayStart)
    .sum("amount as total")
    .first();

  return {
    mainBalance: Number(main?.balance ?? 0),
    commissionBalance: Number(commission?.balance ?? 0),
    balance: Number(main?.balance ?? 0) + Number(commission?.balance ?? 0),
    todayCredits: Number(todayCredits?.total || 0),
    todayDebits: Number(todayDebits?.total || 0),
  };
};
