/**
 * Normalize phone numbers for SLPE APIs.
 *
 * SLPE expects 10–15 digits (no +, spaces, or separators).
 * Handles: +91 / 91 prefix for 12-digit Indian numbers, leading 0.
 */
import { BadRequestError } from "../lib/errors";

export function normalizePhoneForSlpe(
  raw: string | null | undefined,
  fieldLabel = "Phone number",
): string {
  if (raw == null || String(raw).trim() === "") {
    throw new BadRequestError(`${fieldLabel} is required for payment gateway`);
  }

  let s = String(raw)
    .trim()
    .replace(/[\s\-().]/g, "");
  if (s.startsWith("+")) {
    s = s.slice(1);
  }

  let digits = s.replace(/\D/g, "");

  /* India: 91 + 10-digit mobile → 12 digits total */
  if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  }

  if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  if (digits.length < 10 || digits.length > 15) {
    throw new BadRequestError(
      `${fieldLabel} must be 10–15 digits after normalization (got ${digits.length}). Update your profile with a valid mobile.`,
    );
  }

  return digits;
}
