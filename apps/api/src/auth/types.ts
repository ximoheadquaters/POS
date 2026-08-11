export interface VerifiedAuthUser {
  id: string;
  email: string;
}

export interface AuthUserDetails extends VerifiedAuthUser {
  createdAt: string;
  invitedAt: string | null;
  lastSignInAt: string | null;
}

export type VerifyToken = (token: string) => Promise<VerifiedAuthUser>;

export interface AuthActions {
  login(email: string, password: string): Promise<unknown>;
  resetPassword(email: string): Promise<void>;
  createUser(input: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<VerifiedAuthUser>;
  inviteUser(input: { email: string; displayName: string }): Promise<VerifiedAuthUser>;
  resendOwnerInvitation(email: string): Promise<void>;
  changePassword?(userId: string, password: string): Promise<void>;
  getUser(userId: string): Promise<AuthUserDetails | null>;
  deleteUser(userId: string): Promise<void>;
}
