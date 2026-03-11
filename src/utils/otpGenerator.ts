import crypto from 'crypto';

/**
 * Generate a cryptographically-random numeric OTP of the given length.
 * Uses `crypto.randomInt` so the distribution is uniform.
 *
 * @param length - number of digits (default 6)
 * @returns string of digits, zero-padded to `length`
 */
export const generateOtp = (length = 6): string => {
  const max = Math.pow(10, length);
  const otp = crypto.randomInt(0, max);
  return otp.toString().padStart(length, '0');
};
