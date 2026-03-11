/**
 * Commission service — CRUD for default & per-user rates, and the
 * calculation engine that distributes commissions on every payin.
 */
import walletDb from "../../database/wallet-db";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../lib/errors";
import { RoleLevel } from "../../wallet-types";
import type {
  SetCommissionConfigBody,
  SetOverrideBody,
  CommissionEntry,
} from "./commission.types";

/* ------------------------------------------------------------------ */
/*  DEFAULT CONFIG CRUD                                                */
/* ------------------------------------------------------------------ */

/** Get all default commission config rows */
export const getConfig = async () => {
  return walletDb("w_commission_configs").orderBy([
    { column: "transaction_role_level", order: "asc" },
    { column: "beneficiary_role_level", order: "asc" },
  ]);
};

/**
 * Batch upsert default commission rates.  Admin-only.
 * Replaces existing rows for the same (transaction_role_level, beneficiary_role_level) pair.
 */
export const setConfig = async (
  adminId: string,
  body: SetCommissionConfigBody,
) => {
  if (!body.rates || body.rates.length === 0) {
    throw new BadRequestError("At least one rate entry is required");
  }

  for (const r of body.rates) {
    /* beneficiary must be above (lower number) the transactor */
    if (r.beneficiaryRoleLevel >= r.transactionRoleLevel) {
      throw new BadRequestError(
        `Beneficiary level ${r.beneficiaryRoleLevel} must be above transaction level ${r.transactionRoleLevel}`,
      );
    }
    if (r.percentage < 0 || r.percentage > 100) {
      throw new BadRequestError("Percentage must be between 0 and 100");
    }
  }

  await walletDb.transaction(async (trx) => {
    for (const r of body.rates) {
      const existing = await trx("w_commission_configs")
        .where({
          transaction_role_level: r.transactionRoleLevel,
          beneficiary_role_level: r.beneficiaryRoleLevel,
        })
        .first();

      if (existing) {
        await trx("w_commission_configs")
          .where({ id: existing.id })
          .update({
            percentage: r.percentage,
            set_by: adminId,
            updated_at: trx.fn.now(),
          });
      } else {
        await trx("w_commission_configs").insert({
          transaction_role_level: r.transactionRoleLevel,
          beneficiary_role_level: r.beneficiaryRoleLevel,
          percentage: r.percentage,
          set_by: adminId,
        });
      }
    }
  });

  return { message: `${body.rates.length} commission rate(s) saved` };
};

/* ------------------------------------------------------------------ */
/*  PER-USER OVERRIDES                                                 */
/* ------------------------------------------------------------------ */

/** List overrides set by the caller */
export const getOverrides = async (callerId: string) => {
  return walletDb("w_user_commission_overrides").where({ set_by: callerId });
};

/** Set or update an override for a specific user→beneficiary pair */
export const setOverride = async (
  callerId: string,
  userId: string,
  body: SetOverrideBody,
) => {
  if (body.percentage < 0 || body.percentage > 100) {
    throw new BadRequestError("Percentage must be between 0 and 100");
  }

  /* Validate target user exists and is in caller's downline */
  const targetUser = await walletDb("w_users").where({ id: userId }).first();
  if (!targetUser) throw new NotFoundError("Target user not found");

  const beneficiary = await walletDb("w_users")
    .where({ id: body.beneficiaryUserId })
    .first();
  if (!beneficiary) throw new NotFoundError("Beneficiary user not found");

  /* Upsert */
  const existing = await walletDb("w_user_commission_overrides")
    .where({ user_id: userId, beneficiary_user_id: body.beneficiaryUserId })
    .first();

  if (existing) {
    await walletDb("w_user_commission_overrides")
      .where({ id: existing.id })
      .update({
        percentage: body.percentage,
        set_by: callerId,
        updated_at: walletDb.fn.now(),
      });
  } else {
    await walletDb("w_user_commission_overrides").insert({
      user_id: userId,
      beneficiary_user_id: body.beneficiaryUserId,
      percentage: body.percentage,
      set_by: callerId,
    });
  }

  return { message: "Override saved" };
};

/** Remove an override so the system falls back to default config */
export const deleteOverride = async (
  callerId: string,
  userId: string,
  beneficiaryUserId: string,
) => {
  const deleted = await walletDb("w_user_commission_overrides")
    .where({ user_id: userId, beneficiary_user_id: beneficiaryUserId })
    .del();

  if (!deleted) throw new NotFoundError("Override not found");
  return { message: "Override removed — default config will apply" };
};

/** Get commission earnings for a user (paginated) */
export const getEarnings = async (userId: string, page = 1, limit = 50) => {
  const offset = (page - 1) * limit;

  const rows = await walletDb("w_commission_ledger")
    .where({ to_user_id: userId })
    .orderBy("created_at", "desc")
    .limit(limit)
    .offset(offset);

  const [{ total }] = await walletDb("w_commission_ledger")
    .where({ to_user_id: userId })
    .count("id as total");

  return { earnings: rows, pagination: { page, limit, total: Number(total) } };
};

/* ------------------------------------------------------------------ */
/*  COMMISSION CALCULATION ENGINE                                      */
/* ------------------------------------------------------------------ */

/**
 * Calculate commissions for a payin by walking up the parent_id chain
 * from the swiper to the ADMIN.
 *
 * For each ancestor, it first checks `w_user_commission_overrides`,
 * then falls back to `w_commission_configs` for the level pair.
 *
 * Returns an array of CommissionEntry objects (one per ancestor).
 * Does NOT persist anything — the caller (payin service) wraps this
 * inside a DB transaction together with wallet credits.
 */
export const calculateCommissions = async (
  swiperId: string,
  swiperRoleLevel: number,
  payinAmount: number,
): Promise<CommissionEntry[]> => {
  const entries: CommissionEntry[] = [];

  /* Walk up the parent chain */
  let currentUserId: string | null = swiperId;

  while (currentUserId) {
    const user: any = await walletDb("w_users")
      .where({ id: currentUserId })
      .first();
    if (!user || !user.parent_id) break;

    const parent: any = await walletDb("w_users")
      .where({ id: user.parent_id })
      .first();
    if (!parent) break;

    /* 1) Check per-user override */
    const override = await walletDb("w_user_commission_overrides")
      .where({ user_id: swiperId, beneficiary_user_id: parent.id })
      .first();

    let percentage: number | null = override
      ? Number(override.percentage)
      : null;

    /* 2) Fall back to default config for the (swiperLevel → parentLevel) pair */
    if (percentage === null) {
      const config = await walletDb("w_commission_configs")
        .where({
          transaction_role_level: swiperRoleLevel,
          beneficiary_role_level: parent.role_id,
        })
        .first();

      percentage = config ? Number(config.percentage) : 0;
    }

    if (percentage > 0) {
      entries.push({
        toUserId: parent.id,
        toRoleLevel: parent.role_id,
        percentage,
        amount: Math.round(((payinAmount * percentage) / 100) * 100) / 100,
      });
    }

    currentUserId = parent.id;
  }

  return entries;
};
