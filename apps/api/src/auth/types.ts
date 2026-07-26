export interface VerifiedAuthUser {
  id: string;
  email: string;
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
  deleteUser(userId: string): Promise<void>;
}
