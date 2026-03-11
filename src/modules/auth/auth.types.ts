/** POST /api/wallet/auth/request-otp */
export interface RequestOtpBody {
  /** Email address or phone number — determines delivery channel */
  identifier: string;
  /** Force "email" or "sms"; if omitted, detected from identifier format */
  channel?: 'email' | 'sms';
}

/** POST /api/wallet/auth/verify-otp */
export interface VerifyOtpBody {
  identifier: string;
  otp: string;
}

/** POST /api/wallet/auth/verify-mpin */
export interface VerifyMpinBody {
  mpin: string;
}

/** POST /api/wallet/auth/refresh-token */
export interface RefreshTokenBody {
  refreshToken: string;
}
