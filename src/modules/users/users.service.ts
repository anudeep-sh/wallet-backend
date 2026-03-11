/**
 * Users service — invite flow, registration, profile CRUD, downline queries.
 */
import * as bcrypt from "bcrypt";
import crypto from "crypto";
import walletDb from "../../database/wallet-db";
import { sendMail } from "../../utils/mailSender";
import { sendSms } from "../../utils/smsSender";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../lib/errors";
import { ROLE_NAMES } from "../../wallet-types";
import type {
  InviteUserBody,
  RegisterBody,
  UpdateProfileBody,
  ChangeMpinBody,
  UpdateLimitsBody,
} from "./users.types";

const FRONTEND_URL = process.env.FRONTEND_URL || "https://wallet-frontend-61566002034.europe-west1.run.app";
/** Invitation links expire after 72 hours */
const INVITE_EXPIRY_HOURS = 72;

/* ------------------------------------------------------------------ */
/*  INVITE                                                             */
/* ------------------------------------------------------------------ */

/**
 * Create an invitation and send the invite link via email + SMS.
 *
 * Enforces the hierarchy rule: inviter's level must be *lower* (numerically)
 * than the invitee's role level  (e.g. level 4 can invite level 5–9).
 */
export const inviteUser = async (inviterId: string, body: InviteUserBody) => {
  /* Fetch inviter to validate hierarchy */
  const inviter = await walletDb("w_users").where({ id: inviterId }).first();
  if (!inviter) throw new NotFoundError("Inviter not found");

  const inviterLevel = inviter.role_id; // role_id stores the level number
  if (body.roleId <= inviterLevel) {
    throw new ForbiddenError(
      `You (level ${inviterLevel}) cannot invite a user at level ${body.roleId} — ` +
        `only levels ${inviterLevel + 1}–9 are allowed`,
    );
  }

  /* Ensure email / mobile aren't already taken */
  const existing = await walletDb("w_users")
    .where({ email: body.email })
    .orWhere({ mobile_number: body.mobileNumber })
    .first();
  if (existing)
    throw new ConflictError("A user with this email or mobile already exists");

  /* Also check pending invitations */
  const pendingInvite = await walletDb("w_invitations")
    .where({ email: body.email, status: "pending" })
    .first();
  if (pendingInvite)
    throw new ConflictError("An active invite already exists for this email");

  /* Build token and expiry */
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000);

  /* Persist */
  const [invitation] = await walletDb("w_invitations")
    .insert({
      invited_by: inviterId,
      role_id: body.roleId,
      first_name: body.firstName,
      last_name: body.lastName,
      email: body.email,
      mobile_number: body.mobileNumber,
      gender: body.gender || null,
      date_of_birth: body.dateOfBirth || null,
      address_1: body.address1 || null,
      address_2: body.address2 || null,
      city: body.city || null,
      state: body.state || null,
      pincode: body.pincode || null,
      pan_card_number: body.panCardNumber || null,
      aadhar_card_number: body.aadharCardNumber || null,
      name_on_aadhar: body.nameOnAadhar || null,
      bank_account_number: body.bankAccountNumber || null,
      ifsc_code: body.ifscCode || null,
      deposit_limit: body.depositLimit || 0,
      withdraw_daily_limit: body.withdrawDailyLimit || 0,
      file_urls: body.fileUrls ? JSON.stringify(body.fileUrls) : null,
      token,
      status: "pending",
      expires_at: expiresAt,
    })
    .returning("*");

  /* Send invite link */
  const inviteLink = `${FRONTEND_URL}/register?token=${token}`;
  const roleName = ROLE_NAMES[body.roleId] || `Level ${body.roleId}`;

  try {
    await sendMail(
      body.email,
      "You are invited to the Wallet System",
      `<h3>Hello ${body.firstName},</h3>
       <p>You have been invited as <strong>${roleName}</strong> by ${inviter.first_name} ${inviter.last_name}.</p>
       <p><a href="${inviteLink}">Click here to complete your registration</a></p>
       <p>This link expires in ${INVITE_EXPIRY_HOURS} hours.</p>`,
    );
  } catch (e) {
    console.error("[invite] Email notification failed:", e);
  }

  try {
    await sendSms(
      body.mobileNumber,
      `You're invited to the Wallet System as ${roleName}. Register here: ${inviteLink}`,
    );
  } catch (e) {
    console.error("[invite] SMS notification failed:", e);
  }

  /* Audit log */
  await walletDb("w_audit_logs").insert({
    user_id: inviterId,
    action: "INVITE_SENT",
    entity_type: "invitation",
    entity_id: invitation.id,
    meta: JSON.stringify({ email: body.email, roleId: body.roleId }),
  });

  return {
    message: "Invitation sent",
    invitationId: invitation.id,
    inviteLink,
  };
};

/* ------------------------------------------------------------------ */
/*  GET INVITE DETAILS                                                 */
/* ------------------------------------------------------------------ */

/** Fetch invite details so the frontend can pre-fill the registration form */
export const getInviteDetails = async (token: string) => {
  const inviteByToken = await walletDb("w_invitations")
    .leftJoin("w_roles", "w_invitations.role_id", "w_roles.id")
    .where("w_invitations.token", token)
    .select("w_invitations.*", "w_roles.name as role_name")
    .first();

  if (!inviteByToken) throw new NotFoundError("Invalid invitation link");
  if (inviteByToken.status !== "pending")
    throw new NotFoundError("This invitation was already used");
  if (new Date(inviteByToken.expires_at) <= new Date())
    throw new NotFoundError("This invitation link has expired");

  const invite = inviteByToken;

  let inviterName = "";
  if (invite.invited_by) {
    const inviter = await walletDb("w_users")
      .where({ id: invite.invited_by })
      .select("first_name", "last_name")
      .first();
    if (inviter)
      inviterName = [inviter.first_name, inviter.last_name]
        .filter(Boolean)
        .join(" ");
  }

  const { token: _, ...details } = invite;
  return { ...details, inviter_name: inviterName };
};

/* ------------------------------------------------------------------ */
/*  REGISTER (accept invite)                                           */
/* ------------------------------------------------------------------ */

/**
 * Complete registration: creates the user, wallet, and marks the invite accepted.
 * Everything runs in a single DB transaction for atomicity.
 */
export const registerUser = async (body: RegisterBody) => {
  const inviteToken = body.inviteToken ?? body.token;
  if (!inviteToken) throw new BadRequestError("Invite token is required");
  const mpin = body.mpin;
  if (!mpin) throw new BadRequestError("MPIN is required");

  const invite = await walletDb("w_invitations")
    .where({ token: inviteToken, status: "pending" })
    .where("expires_at", ">", new Date())
    .first();

  if (!invite) throw new NotFoundError("Invalid or expired invitation");

  /* Hash secrets; password optional (OTP-only login) */
  const passwordToHash =
    body.password && body.password.trim()
      ? body.password
      : crypto.randomBytes(24).toString("hex");
  const hashedPassword = await bcrypt.hash(passwordToHash, 10);
  const hashedMpin = await bcrypt.hash(mpin, 10);

  return walletDb.transaction(async (trx) => {
    /* Create user */
    const [user] = await trx("w_users")
      .insert({
        first_name: invite.first_name,
        last_name: invite.last_name,
        email: invite.email,
        mobile_number: invite.mobile_number,
        gender: invite.gender,
        date_of_birth: invite.date_of_birth,
        address_1: invite.address_1,
        address_2: invite.address_2,
        city: invite.city,
        state: invite.state,
        pincode: invite.pincode,
        pan_card_number: invite.pan_card_number,
        aadhar_card_number: invite.aadhar_card_number,
        name_on_aadhar: invite.name_on_aadhar,
        bank_account_number: invite.bank_account_number,
        ifsc_code: invite.ifsc_code,
        role_id: invite.role_id,
        parent_id: invite.invited_by,
        mpin: hashedMpin,
        password: hashedPassword,
        deposit_limit: invite.deposit_limit,
        withdraw_daily_limit: invite.withdraw_daily_limit,
        file_urls: invite.file_urls,
        is_active: true,
        is_verified: false,
      })
      .returning("*");

    /* Create wallet with zero balance */
    await trx("w_wallets").insert({ user_id: user.id, balance: 0 });

    /* Mark invitation as accepted */
    await trx("w_invitations")
      .where({ id: invite.id })
      .update({ status: "accepted" });

    /* Audit */
    await trx("w_audit_logs").insert({
      user_id: user.id,
      action: "USER_REGISTERED",
      entity_type: "user",
      entity_id: user.id,
    });

    return {
      message: "Registration successful — you can now log in via OTP",
      userId: user.id,
    };
  });
};

/* ------------------------------------------------------------------ */
/*  PROFILE                                                            */
/* ------------------------------------------------------------------ */

/** List invitations sent by the current user (for "Invites I sent" section) */
export const getInvitesSent = async (userId: string, page = 1, limit = 50) => {
  const offset = (page - 1) * limit;
  const rows = await walletDb("w_invitations")
    .leftJoin("w_roles", "w_invitations.role_id", "w_roles.id")
    .where("w_invitations.invited_by", userId)
    .select(
      "w_invitations.id",
      "w_invitations.first_name",
      "w_invitations.last_name",
      "w_invitations.email",
      "w_invitations.mobile_number",
      "w_invitations.status",
      "w_invitations.created_at",
      "w_invitations.expires_at",
      "w_roles.name as role_name",
    )
    .orderBy("w_invitations.created_at", "desc")
    .limit(limit)
    .offset(offset);

  const [{ total }] = await walletDb("w_invitations")
    .where({ invited_by: userId })
    .count("id as total");

  return { invitations: rows, total: Number(total) };
};

/** Get the authenticated user's full profile */
export const getProfile = async (userId: string) => {
  const user = await walletDb("w_users")
    .leftJoin("w_roles", "w_users.role_id", "w_roles.id")
    .where("w_users.id", userId)
    .select(
      "w_users.*",
      "w_roles.name as role_name",
      "w_roles.level as role_level",
    )
    .first();

  if (!user) throw new NotFoundError("User not found");

  /* Strip sensitive fields */
  delete user.password;
  delete user.mpin;
  return user;
};

/** Update mutable profile fields */
export const updateProfile = async (
  userId: string,
  body: UpdateProfileBody,
) => {
  const updateData: Record<string, any> = {};
  if (body.firstName) updateData.first_name = body.firstName;
  if (body.lastName) updateData.last_name = body.lastName;
  if (body.gender) updateData.gender = body.gender;
  if (body.dateOfBirth) updateData.date_of_birth = body.dateOfBirth;
  if (body.address1) updateData.address_1 = body.address1;
  if (body.address2) updateData.address_2 = body.address2;
  if (body.city) updateData.city = body.city;
  if (body.state) updateData.state = body.state;
  if (body.pincode) updateData.pincode = body.pincode;
  if (body.panCardNumber) updateData.pan_card_number = body.panCardNumber;
  if (body.aadharCardNumber)
    updateData.aadhar_card_number = body.aadharCardNumber;
  if (body.nameOnAadhar) updateData.name_on_aadhar = body.nameOnAadhar;
  if (body.bankAccountNumber)
    updateData.bank_account_number = body.bankAccountNumber;
  if (body.ifscCode) updateData.ifsc_code = body.ifscCode;
  if (body.fileUrls) updateData.file_urls = JSON.stringify(body.fileUrls);

  if (Object.keys(updateData).length === 0) {
    throw new BadRequestError("No fields provided for update");
  }

  updateData.updated_at = walletDb.fn.now();
  await walletDb("w_users").where({ id: userId }).update(updateData);
  return { message: "Profile updated" };
};

/** Set or change MPIN */
export const changeMpin = async (userId: string, body: ChangeMpinBody) => {
  const user = await walletDb("w_users").where({ id: userId }).first();
  if (!user) throw new NotFoundError("User not found");

  /* If user already has an MPIN, require the current one for verification */
  if (user.mpin) {
    if (!body.currentMpin) throw new BadRequestError("currentMpin is required");
    const valid = await bcrypt.compare(body.currentMpin, user.mpin);
    if (!valid) throw new BadRequestError("Current MPIN is incorrect");
  }

  const hashed = await bcrypt.hash(body.newMpin, 10);
  await walletDb("w_users")
    .where({ id: userId })
    .update({ mpin: hashed, updated_at: walletDb.fn.now() });
  return { message: "MPIN updated" };
};

/* ------------------------------------------------------------------ */
/*  DOWNLINE                                                           */
/* ------------------------------------------------------------------ */

/**
 * List all users directly or indirectly under the authenticated user
 * (i.e. the full sub-tree rooted at `userId`).
 *
 * Uses a recursive CTE for unlimited depth traversal.
 */
export const getDownline = async (
  userId: string,
  page = 1,
  limit = 50,
  roleFilter?: number,
) => {
  const offset = (page - 1) * limit;

  /* Recursive CTE to walk the parent_id tree */
  let query = walletDb.raw(
    `
    WITH RECURSIVE downline AS (
      SELECT id, first_name, last_name, email, mobile_number, role_id,
             parent_id, is_active, created_at, 1 AS depth
      FROM   wallet.w_users
      WHERE  parent_id = ?

      UNION ALL

      SELECT u.id, u.first_name, u.last_name, u.email, u.mobile_number, u.role_id,
             u.parent_id, u.is_active, u.created_at, d.depth + 1
      FROM   wallet.w_users u
      INNER JOIN downline d ON u.parent_id = d.id
    )
    SELECT d.*, r.name as role_name, r.level as role_level
    FROM   downline d
    LEFT JOIN wallet.w_roles r ON d.role_id = r.id
    ${roleFilter ? "WHERE d.role_id = " + Number(roleFilter) : ""}
    ORDER BY d.created_at DESC
    LIMIT ? OFFSET ?
  `,
    [userId, limit, offset],
  );

  const { rows } = await query;

  /* Total count for pagination */
  const countQuery = await walletDb.raw(
    `
    WITH RECURSIVE downline AS (
      SELECT id FROM wallet.w_users WHERE parent_id = ?
      UNION ALL
      SELECT u.id FROM wallet.w_users u INNER JOIN downline d ON u.parent_id = d.id
    )
    SELECT COUNT(*) as total FROM downline
    ${roleFilter ? "WHERE id IN (SELECT id FROM wallet.w_users WHERE role_id = " + Number(roleFilter) + ")" : ""}
  `,
    [userId],
  );

  return {
    users: rows,
    pagination: {
      page,
      limit,
      total: parseInt(countQuery.rows[0].total, 10),
    },
  };
};

/**
 * Get downline as a nested tree for org chart (who is under who).
 * Returns root node with children array; each node has id, name, roleName, isActive, children.
 */
export const getDownlineTree = async (userId: string) => {
  const all = await walletDb.raw(
    `
    WITH RECURSIVE downline AS (
      SELECT id, first_name, last_name, role_id, parent_id, is_active
      FROM   wallet.w_users WHERE parent_id = ?
      UNION ALL
      SELECT u.id, u.first_name, u.last_name, u.role_id, u.parent_id, u.is_active
      FROM   wallet.w_users u
      INNER JOIN downline d ON u.parent_id = d.id
    )
    SELECT d.*, r.name as role_name FROM downline d
    LEFT JOIN wallet.w_roles r ON d.role_id = r.id
    ORDER BY d.parent_id, d.id
  `,
    [userId],
  );
  const rows = all.rows || [];
  const byParent = new Map<string, typeof rows>();
  for (const r of rows) {
    const pid = r.parent_id || userId;
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid)!.push(r);
  }
  function buildNode(id: string): any[] {
    const children = byParent.get(id) || [];
    return children.map((u: any) => {
      const childList = buildNode(u.id);
      return {
        id: u.id,
        name:
          [u.first_name, u.last_name].filter(Boolean).join(" ") ||
          u.email ||
          u.id,
        roleName: u.role_name || "",
        isActive: u.is_active,
        ...(childList.length > 0 ? { children: childList } : {}),
      };
    });
  }
  const rootChildren = buildNode(userId);
  return {
    tree: {
      name: "You",
      id: userId,
      ...(rootChildren.length > 0 ? { children: rootChildren } : {}),
    },
  };
};

/** Get a single user's details — only if they are in the caller's downline */
export const getDownlineUser = async (callerId: string, targetId: string) => {
  /* Quick hierarchy check: walk up from target to see if caller is an ancestor */
  const check = await walletDb.raw(
    `
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id FROM wallet.w_users WHERE id = ?
      UNION ALL
      SELECT u.id, u.parent_id FROM wallet.w_users u INNER JOIN ancestors a ON u.id = a.parent_id
    )
    SELECT 1 FROM ancestors WHERE id = ?
  `,
    [targetId, callerId],
  );

  if (check.rows.length === 0) {
    throw new ForbiddenError("This user is not in your downline");
  }

  const user = await walletDb("w_users")
    .leftJoin("w_roles", "w_users.role_id", "w_roles.id")
    .where("w_users.id", targetId)
    .select(
      "w_users.*",
      "w_roles.name as role_name",
      "w_roles.level as role_level",
    )
    .first();

  if (!user) throw new NotFoundError("User not found");
  delete user.password;
  delete user.mpin;
  return user;
};

/** Activate or deactivate a user in the caller's downline */
export const toggleUserStatus = async (
  callerId: string,
  targetId: string,
  isActive: boolean,
) => {
  await getDownlineUser(callerId, targetId); // validates hierarchy
  await walletDb("w_users")
    .where({ id: targetId })
    .update({ is_active: isActive, updated_at: walletDb.fn.now() });

  await walletDb("w_audit_logs").insert({
    user_id: callerId,
    action: isActive ? "USER_ACTIVATED" : "USER_DEACTIVATED",
    entity_type: "user",
    entity_id: targetId,
  });

  return { message: `User ${isActive ? "activated" : "deactivated"}` };
};

/** Update deposit / withdraw limits for a downline user */
export const updateLimits = async (
  callerId: string,
  targetId: string,
  body: UpdateLimitsBody,
) => {
  await getDownlineUser(callerId, targetId); // validates hierarchy

  const update: Record<string, any> = { updated_at: walletDb.fn.now() };
  if (body.depositLimit !== undefined) update.deposit_limit = body.depositLimit;
  if (body.withdrawDailyLimit !== undefined)
    update.withdraw_daily_limit = body.withdrawDailyLimit;

  await walletDb("w_users").where({ id: targetId }).update(update);

  await walletDb("w_audit_logs").insert({
    user_id: callerId,
    action: "LIMITS_UPDATED",
    entity_type: "user",
    entity_id: targetId,
    meta: JSON.stringify(body),
  });

  return { message: "Limits updated" };
};
