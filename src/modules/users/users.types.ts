/** POST /api/wallet/users/invite — full onboarding payload */
export interface InviteUserBody {
  roleId: number;
  firstName: string;
  lastName: string;
  email: string;
  mobileNumber: string;
  gender?: string;
  dateOfBirth?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  panCardNumber?: string;
  aadharCardNumber?: string;
  nameOnAadhar?: string;
  bankAccountNumber?: string;
  ifscCode?: string;
  depositLimit?: number;
  withdrawDailyLimit?: number;
  fileUrls?: string[];
}

/** POST /api/wallet/users/register — accept invite and finish registration */
export interface RegisterBody {
  inviteToken?: string;
  token?: string;
  password?: string;
  mpin: string;
}

/** PUT /api/wallet/users/me */
export interface UpdateProfileBody {
  firstName?: string;
  lastName?: string;
  gender?: string;
  dateOfBirth?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  panCardNumber?: string;
  aadharCardNumber?: string;
  nameOnAadhar?: string;
  bankAccountNumber?: string;
  ifscCode?: string;
  fileUrls?: string[];
}

/** PUT /api/wallet/users/me/mpin */
export interface ChangeMpinBody {
  currentMpin?: string;
  newMpin: string;
}

/** PUT /api/wallet/users/:id/limits */
export interface UpdateLimitsBody {
  depositLimit?: number;
  withdrawDailyLimit?: number;
}
