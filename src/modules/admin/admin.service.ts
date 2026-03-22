/**
 * Admin service — dashboard stats, system-wide listings.
 * All endpoints require ADMIN role (level 1).
 */
import walletDb from "../../database/wallet-db";
import type { AdminListQuery } from "./admin.types";

/* ------------------------------------------------------------------ */
/*  DASHBOARD                                                          */
/* ------------------------------------------------------------------ */

/** System-wide stats snapshot */
export const getDashboard = async () => {
  /* Total and active users */
  const [{ totalUsers }] = await walletDb("w_users").count("id as totalUsers");
  const [{ activeUsers }] = await walletDb("w_users")
    .where({ is_active: true })
    .count("id as activeUsers");

  /* Total users by role */
  const usersByRole = await walletDb("w_users")
    .leftJoin("w_roles", "w_users.role_id", "w_roles.id")
    .select("w_roles.name as role_name", "w_roles.level")
    .count("w_users.id as count")
    .groupBy("w_roles.name", "w_roles.level")
    .orderBy("w_roles.level");

  /* Total wallet balances across all users (split by type) */
  const [{ total_balance }] = await walletDb("w_wallets").sum(
    "balance as total_balance",
  );
  const [{ total_main_balance }] = await walletDb("w_wallets")
    .where({ type: "main" })
    .sum("balance as total_main_balance");
  const [{ total_commission_balance }] = await walletDb("w_wallets")
    .where({ type: "commission" })
    .sum("balance as total_commission_balance");

  /* Total payin volume (successful only) */
  const [{ total_payin }] = await walletDb("w_payins")
    .where({ status: "success" })
    .sum("amount as total_payin");

  /* Total commissions distributed */
  const [{ total_commission }] = await walletDb("w_commission_ledger").sum(
    "amount as total_commission",
  );

  /* Pending payout count + total */
  const [pendingPayouts] = await walletDb("w_payouts")
    .where({ status: "pending" })
    .count("id as count")
    .sum("amount as total");

  /* Today's transaction volume */
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [todayPayins] = await walletDb("w_payins")
    .where({ status: "success" })
    .where("created_at", ">=", todayStart)
    .count("id as count")
    .sum("amount as total");

  /* Total payout amount (all time) */
  const [{ total_payout }] = await walletDb("w_payouts").sum(
    "amount as total_payout",
  );

  return {
    totalUsers: Number(totalUsers || 0),
    activeUsers: Number(activeUsers || 0),
    usersByRole,
    totalBalance: Number(total_balance || 0),
    totalMainBalance: Number(total_main_balance || 0),
    totalCommissionBalance: Number(total_commission_balance || 0),
    totalPayinVolume: Number(total_payin || 0),
    totalPayoutAmount: Number(total_payout || 0),
    totalCommissions: Number(total_commission || 0),
    pendingPayoutsCount: Number(pendingPayouts?.count || 0),
    pendingPayoutsTotal: Number(pendingPayouts?.total || 0),
    todayPayinsCount: Number(todayPayins?.count || 0),
    todayPayinsTotal: Number(todayPayins?.total || 0),
  };
};

/* ------------------------------------------------------------------ */
/*  USER LISTING                                                       */
/* ------------------------------------------------------------------ */

/** List all wallet users with filters + pagination */
export const listUsers = async (query: AdminListQuery) => {
  const page = parseInt(query.page || "1", 10);
  const limit = parseInt(query.limit || "50", 10);
  const offset = (page - 1) * limit;

  let q = walletDb("w_users")
    .leftJoin("w_roles", "w_users.role_id", "w_roles.id")
    .leftJoin(
      walletDb.raw(
        "wallet.w_wallets AS mw ON mw.user_id = w_users.id AND mw.type = 'main'",
      ),
    )
    .leftJoin(
      walletDb.raw(
        "wallet.w_wallets AS cw ON cw.user_id = w_users.id AND cw.type = 'commission'",
      ),
    )
    .leftJoin("w_users as parent", "w_users.parent_id", "parent.id")
    .select(
      "w_users.id",
      "w_users.first_name",
      "w_users.last_name",
      "w_users.email",
      "w_users.mobile_number",
      "w_users.is_active",
      "w_users.parent_id",
      "w_users.created_at",
      "w_roles.name as role_name",
      "w_roles.level as role_level",
      walletDb.raw("COALESCE(mw.balance, 0) as main_balance"),
      walletDb.raw("COALESCE(cw.balance, 0) as commission_balance"),
      walletDb.raw(
        "COALESCE(mw.balance, 0) + COALESCE(cw.balance, 0) as balance",
      ),
      walletDb.raw(
        "CONCAT(parent.first_name, ' ', parent.last_name) as parent_name",
      ),
    );

  let countQ = walletDb("w_users");

  if (query.roleId) {
    q = q.where("w_users.role_id", parseInt(query.roleId, 10));
    countQ = countQ.where("role_id", parseInt(query.roleId, 10));
  }
  if (query.roleName) {
    q = q.where("w_roles.name", query.roleName);
    countQ = countQ.whereIn(
      "role_id",
      walletDb("w_roles").select("id").where("name", query.roleName),
    );
  }
  if (query.status) {
    const isActive = query.status === "active";
    q = q.where("w_users.is_active", isActive);
    countQ = countQ.where("is_active", isActive);
  }
  if (query.parentId) {
    q = q.where("w_users.parent_id", query.parentId);
    countQ = countQ.where("parent_id", query.parentId);
  }
  if (query.search) {
    const s = `%${query.search}%`;
    q = q.where(function () {
      this.whereILike("w_users.first_name", s)
        .orWhereILike("w_users.last_name", s)
        .orWhereILike("w_users.email", s)
        .orWhereILike("w_users.mobile_number", s);
    });
    countQ = countQ.where(function () {
      this.whereILike("first_name", s)
        .orWhereILike("last_name", s)
        .orWhereILike("email", s)
        .orWhereILike("mobile_number", s);
    });
  }

  const rows = await q
    .orderBy("w_users.created_at", "desc")
    .limit(limit)
    .offset(offset);
  const [{ total }] = await countQ.count("id as total");
  const totalNum = Number(total);

  return {
    users: rows,
    total: totalNum,
    pagination: { page, limit, total: totalNum },
  };
};

/* ------------------------------------------------------------------ */
/*  TRANSACTION LISTING                                                */
/* ------------------------------------------------------------------ */

/** All transactions system-wide */
export const listTransactions = async (query: AdminListQuery) => {
  const page = parseInt(query.page || "1", 10);
  const limit = parseInt(query.limit || "50", 10);
  const offset = (page - 1) * limit;

  let q = walletDb("w_transactions")
    .leftJoin("w_users", "w_transactions.user_id", "w_users.id")
    .select(
      "w_transactions.*",
      "w_users.first_name",
      "w_users.last_name",
      "w_users.email",
    );

  if (query.fromDate)
    q = q.where("w_transactions.created_at", ">=", query.fromDate);
  if (query.toDate)
    q = q.where("w_transactions.created_at", "<=", query.toDate);

  const rows = await q
    .orderBy("w_transactions.created_at", "desc")
    .limit(limit)
    .offset(offset);
  const [{ total }] = await walletDb("w_transactions").count("id as total");

  return {
    transactions: rows,
    pagination: { page, limit, total: Number(total) },
  };
};

/* ------------------------------------------------------------------ */
/*  PAYIN LISTING                                                      */
/* ------------------------------------------------------------------ */

/** All payins system-wide */
export const listPayins = async (query: AdminListQuery) => {
  const page = parseInt(query.page || "1", 10);
  const limit = parseInt(query.limit || "50", 10);
  const offset = (page - 1) * limit;

  const rows = await walletDb("w_payins")
    .leftJoin("w_users", "w_payins.user_id", "w_users.id")
    .select(
      "w_payins.*",
      "w_users.first_name",
      "w_users.last_name",
      "w_users.email",
    )
    .orderBy("w_payins.created_at", "desc")
    .limit(limit)
    .offset(offset);

  const [{ total }] = await walletDb("w_payins").count("id as total");

  return { payins: rows, pagination: { page, limit, total: Number(total) } };
};

/* ------------------------------------------------------------------ */
/*  PAYOUT LISTING (with approval queue)                               */
/* ------------------------------------------------------------------ */

/** All payouts system-wide with optional status filter */
export const listPayouts = async (query: AdminListQuery) => {
  const page = parseInt(query.page || "1", 10);
  const limit = parseInt(query.limit || "50", 10);
  const offset = (page - 1) * limit;

  let q = walletDb("w_payouts")
    .leftJoin("w_users", "w_payouts.user_id", "w_users.id")
    .select(
      "w_payouts.*",
      "w_users.first_name",
      "w_users.last_name",
      "w_users.email",
      "w_users.mobile_number",
    );

  let countQ = walletDb("w_payouts");

  if (query.status) {
    q = q.where("w_payouts.status", query.status);
    countQ = countQ.where("status", query.status);
  }
  if (query.walletType) {
    q = q.where("w_payouts.wallet_type", query.walletType);
    countQ = countQ.where("wallet_type", query.walletType);
  }

  const rows = await q
    .orderBy("w_payouts.created_at", "desc")
    .limit(limit)
    .offset(offset);
  const [{ total }] = await countQ.count("id as total");

  return { payouts: rows, pagination: { page, limit, total: Number(total) } };
};
