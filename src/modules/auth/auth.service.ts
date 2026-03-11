/**
 * Auth service — handles OTP generation, verification, JWT issuance,
 * MPIN verification, and refresh-token rotation.
 */
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import crypto from 'crypto';
import walletDb from '../../database/wallet-db';
import { generateOtp } from '../../utils/otpGenerator';
import { sendMail } from '../../utils/mailSender';
import { sendSms } from '../../utils/smsSender';
import {
  BadRequestError,
  UnauthorizedError,
  NotFoundError,
  TooManyRequestsError,
} from '../../lib/errors';
import { JwtPayload, ROLE_NAMES } from '../../wallet-types';

const JWT_SECRET = process.env.JWT_SECRET || 'WALLET_JWT_SECRET';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '24h';
const REFRESH_DAYS = parseInt(process.env.REFRESH_TOKEN_EXPIRES_DAYS || '7', 10);

/** OTP validity in minutes */
const OTP_VALIDITY_MINUTES = 5;
/** Max wrong OTP attempts before the token is burned */
const MAX_OTP_ATTEMPTS = 3;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Detect whether a string is an e-mail or a phone number */
const detectChannel = (identifier: string): 'email' | 'sms' => {
  return identifier.includes('@') ? 'email' : 'sms';
};

/** Build a signed JWT for the given wallet user row */
const signAccessToken = (user: any): string => {
  const payload: JwtPayload = {
    userId: user.id,
    email: user.email,
    roleLevel: user.role_id,
    roleName: ROLE_NAMES[user.role_id] || 'UNKNOWN',
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
};

/** Generate a random refresh-token string */
const generateRefreshToken = (): string => crypto.randomBytes(40).toString('hex');

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Send an OTP to the given email or phone.
 * Rate-limited: max 5 OTPs per identifier per hour.
 */
export const requestOtp = async (identifier: string, channelHint?: 'email' | 'sms') => {
  const channel = channelHint || detectChannel(identifier);

  /* Verify the identifier belongs to a registered wallet user */
  const lookupCol = channel === 'email' ? 'email' : 'mobile_number';
  const user = await walletDb('w_users').where({ [lookupCol]: identifier }).first();
  if (!user) throw new NotFoundError('No wallet account found for this identifier');
  if (!user.is_active) throw new BadRequestError('Account is deactivated');

  /* Rate limit: max 5 OTPs in the last hour */
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentCount = await walletDb('w_otp_tokens')
    .where('identifier', identifier)
    .where('created_at', '>', oneHourAgo)
    .count('id as cnt')
    .first();

  if (recentCount && Number(recentCount.cnt) >= 50) {
    throw new TooManyRequestsError('OTP limit reached — try again later');
  }

  /* Generate and persist the OTP (hashed) */
  const otp = generateOtp(6);
  const hashedOtp = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + OTP_VALIDITY_MINUTES * 60 * 1000);

  await walletDb('w_otp_tokens').insert({
    identifier,
    otp: hashedOtp,
    type: channel,
    purpose: 'login',
    expires_at: expiresAt,
  });

  /* Deliver the OTP */
  if (channel === 'email') {
    await sendMail(
      identifier,
      'Wallet System — Your Login OTP',
      `<p>Your OTP is <strong>${otp}</strong>. It expires in ${OTP_VALIDITY_MINUTES} minutes.</p>`,
    );
  } else {
    await sendSms(identifier, `Your Wallet System OTP is ${otp}. Valid for ${OTP_VALIDITY_MINUTES} min.`);
  }

  return { message: `OTP sent to ${identifier} via ${channel}` };
};

/**
 * Verify an OTP and return an access-token + refresh-token pair.
 */
export const verifyOtp = async (identifier: string, rawOtp: string) => {
  /* Fetch the most recent unused OTP for this identifier */
  const otpRow = await walletDb('w_otp_tokens')
    .where({ identifier, is_used: false, purpose: 'login' })
    .where('expires_at', '>', new Date())
    .orderBy('created_at', 'desc')
    .first();

  if (!otpRow) throw new UnauthorizedError('OTP expired or not found');

  /* Enforce attempt limit */
  if (otpRow.attempts >= MAX_OTP_ATTEMPTS) {
    await walletDb('w_otp_tokens').where({ id: otpRow.id }).update({ is_used: true });
    throw new TooManyRequestsError('Max OTP attempts exceeded — request a new OTP');
  }

  /* Compare */
  const valid = await bcrypt.compare(rawOtp, otpRow.otp);
  if (!valid) {
    await walletDb('w_otp_tokens').where({ id: otpRow.id }).increment('attempts', 1);
    throw new UnauthorizedError('Invalid OTP');
  }

  /* Mark used */
  await walletDb('w_otp_tokens').where({ id: otpRow.id }).update({ is_used: true });

  /* Lookup the user */
  const channel = detectChannel(identifier);
  const lookupCol = channel === 'email' ? 'email' : 'mobile_number';
  const user = await walletDb('w_users').where({ [lookupCol]: identifier }).first();
  if (!user) throw new NotFoundError('User not found');

  /* Mark verified if first login */
  if (!user.is_verified) {
    await walletDb('w_users').where({ id: user.id }).update({ is_verified: true });
  }

  /* Issue tokens */
  const accessToken = signAccessToken(user);
  const rawRefresh = generateRefreshToken();
  const hashedRefresh = await bcrypt.hash(rawRefresh, 10);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000);

  await walletDb('w_refresh_tokens').insert({
    user_id: user.id,
    token: hashedRefresh,
    expires_at: refreshExpiresAt,
  });

  return {
    accessToken,
    refreshToken: rawRefresh,
    user: {
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      mobileNumber: user.mobile_number,
      roleLevel: user.role_id,
      roleName: ROLE_NAMES[user.role_id],
      hasMpin: !!user.mpin,
    },
  };
};

/**
 * Verify the user's MPIN (required for sensitive ops like payouts).
 * Returns a short-lived "mpin_verified" flag in the response.
 */
export const verifyMpin = async (userId: string, rawMpin: string) => {
  const user = await walletDb('w_users').where({ id: userId }).first();
  if (!user) throw new NotFoundError('User not found');
  if (!user.mpin) throw new BadRequestError('MPIN not set — update your profile first');

  const valid = await bcrypt.compare(rawMpin, user.mpin);
  if (!valid) throw new UnauthorizedError('Invalid MPIN');

  return { verified: true };
};

/**
 * Rotate a refresh token: consume the old one and issue a new pair.
 */
export const refreshAccessToken = async (rawRefreshToken: string) => {
  /* Find all non-expired refresh tokens — we have to compare hashes */
  const candidates = await walletDb('w_refresh_tokens')
    .where('expires_at', '>', new Date())
    .select('*');

  let matchedRow: any = null;
  for (const row of candidates) {
    if (await bcrypt.compare(rawRefreshToken, row.token)) {
      matchedRow = row;
      break;
    }
  }

  if (!matchedRow) throw new UnauthorizedError('Invalid or expired refresh token');

  /* Delete the consumed token (one-time use) */
  await walletDb('w_refresh_tokens').where({ id: matchedRow.id }).del();

  const user = await walletDb('w_users').where({ id: matchedRow.user_id }).first();
  if (!user) throw new NotFoundError('User not found');

  /* Issue fresh pair */
  const accessToken = signAccessToken(user);
  const newRaw = generateRefreshToken();
  const newHashed = await bcrypt.hash(newRaw, 10);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000);

  await walletDb('w_refresh_tokens').insert({
    user_id: user.id,
    token: newHashed,
    expires_at: refreshExpiresAt,
  });

  return { accessToken, refreshToken: newRaw };
};

/**
 * Revoke all refresh tokens for the user (logout from all devices).
 */
export const logout = async (userId: string) => {
  await walletDb('w_refresh_tokens').where({ user_id: userId }).del();
  return { message: 'Logged out successfully' };
};
