/**
 * Authentication and authorization middleware for the wallet system.
 *
 * Verifies JWT, extracts user payload, and provides role-level guards.
 */
import * as jwt from "jsonwebtoken";
import walletDb from "../database/wallet-db";
import { UnauthorizedError, ForbiddenError } from "../lib/errors";
import { JwtPayload, RoleLevel } from "../wallet-types";

const JWT_SECRET = process.env.JWT_SECRET || "WALLET_JWT_SECRET";

/**
 * Verify the Bearer token and attach `ctx.state.walletUser` with the
 * decoded JWT payload plus the full user row from the wallet schema.
 */
export const walletAuth = async (ctx: any, next: any) => {
  const header = ctx.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing or malformed Authorization header");
  }

  const token = header.split(" ")[1];

  let decoded: JwtPayload;
  try {
    decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    throw new UnauthorizedError("Invalid or expired token");
  }

  const user = await walletDb("w_users").where({ id: decoded.userId }).first();
  if (!user) throw new UnauthorizedError("User not found");
  if (!user.is_active) throw new ForbiddenError("Account deactivated");

  ctx.state.walletUser = {
    ...decoded,
    userId: user.id,
    roleLevel: user.role_id,
    parentId: user.parent_id,
    email: user.email,
  };

  await next();
};

/**
 * Factory: restrict access to users whose role level is <= maxLevel.
 * Level 1 (ADMIN) passes every check; Level 9 (SHOPKEEPER) is most restricted.
 */
export const requireLevel = (maxLevel: RoleLevel) => {
  return async (ctx: any, next: any) => {
    const { roleLevel } = ctx.state.walletUser;
    if (roleLevel > maxLevel) {
      throw new ForbiddenError(
        `Role level ${roleLevel} is not authorized — requires level ${maxLevel} or above`,
      );
    }
    await next();
  };
};

/** Convenience: only ADMIN (level 1) */
export const adminOnly = requireLevel(RoleLevel.ADMIN);

/** Convenience: ADMIN + ADMIN_PARTNER (level <= 2) */
export const adminPartnerAndAbove = requireLevel(RoleLevel.ADMIN_PARTNER);
