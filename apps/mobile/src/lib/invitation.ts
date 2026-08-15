import type { CurrentUser } from '@ximo/shared';

export const INVALID_INVITATION_MESSAGE =
  'This invitation link is invalid or has expired. Request a new invitation from your administrator.';

<<<<<<< HEAD
=======
export const SETUP_SESSION_EXPIRED_MESSAGE =
  'Your setup session expired before the password was saved. Ask your administrator to resend the setup link, then open it once and create your password immediately.';

export const PASSWORD_SAVED_SIGN_IN_MESSAGE =
  'Your password was saved. Sign in with your new password to continue.';

>>>>>>> d716e8a721fcc0fc5a72dce0bccdf9d92ead64ce
// A recovery/invitation session is intentionally authenticated before its POS
// profile is loaded. SessionProvider must not treat that temporary state as a
// failed normal login and sign it out before updateUser can save the password.
let invitationSetupActive = false;

export function setInvitationSetupActive(active: boolean): void {
  invitationSetupActive = active;
}

export function isInvitationSetupActive(): boolean {
  return invitationSetupActive;
}

export type InvitationCallback =
  | { kind: 'pkce'; code: string }
  | { kind: 'session'; accessToken: string; refreshToken: string }
  | { kind: 'otp'; tokenHash: string; type: 'invite' | 'recovery' }
  | { kind: 'invalid'; reason: 'invalid' | 'expired'; message: string };

interface AuthResponse {
  data: { session: { access_token: string } | null };
  error: { message: string; status?: number } | null;
}

export interface InvitationAuthClient {
  exchangeCodeForSession(code: string): Promise<AuthResponse>;
  setSession(input: { access_token: string; refresh_token: string }): Promise<AuthResponse>;
  verifyOtp(input: { token_hash: string; type: 'invite' | 'recovery' }): Promise<AuthResponse>;
  updateUser(input: { password: string }): Promise<{
    data: unknown;
    error: { message: string; status?: number } | null;
  }>;
  getSession(): Promise<AuthResponse>;
  signOut(): Promise<unknown>;
}

export class InvitationFlowError extends Error {
  constructor(
    public readonly kind: 'invalid' | 'expired' | 'network' | 'profile',
    message: string,
  ) {
    super(message);
  }
}

function callbackValues(url: URL): URLSearchParams {
  const values = new URLSearchParams(url.search);
  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  for (const [key, value] of new URLSearchParams(hash)) {
    if (!values.has(key)) values.set(key, value);
  }
  return values;
}

function looksExpired(value: string): boolean {
  return /expired|invalid.*(?:token|link|otp)|otp.*expired|same link twice|session.*missing|not authenticated|auth session missing/i.test(
    value,
  );
}

export function parseInvitationCallback(rawUrl: string): InvitationCallback {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { kind: 'invalid', reason: 'invalid', message: INVALID_INVITATION_MESSAGE };
  }

  const values = callbackValues(url);
  const providerError = [
    values.get('error'),
    values.get('error_code'),
    values.get('error_description'),
  ]
    .filter(Boolean)
    .join(' ');
  if (providerError) {
    return {
      kind: 'invalid',
      reason: looksExpired(providerError) ? 'expired' : 'invalid',
      message: INVALID_INVITATION_MESSAGE,
    };
  }

  const code = values.get('code')?.trim();
  if (code) return { kind: 'pkce', code };

  const type = values.get('type');
  const tokenHash = values.get('token_hash')?.trim();
  if (tokenHash && (type === 'invite' || type === 'recovery')) {
    return { kind: 'otp', tokenHash, type };
  }

  const accessToken = values.get('access_token')?.trim();
  const refreshToken = values.get('refresh_token')?.trim();
  if (accessToken && refreshToken && (!type || type === 'invite' || type === 'recovery')) {
    return { kind: 'session', accessToken, refreshToken };
  }

  return { kind: 'invalid', reason: 'invalid', message: INVALID_INVITATION_MESSAGE };
}

function providerFailure(error: { message: string; status?: number } | null): InvitationFlowError {
  if (error && (looksExpired(error.message) || error.status === 400 || error.status === 401)) {
    return new InvitationFlowError('expired', INVALID_INVITATION_MESSAGE);
  }
  return new InvitationFlowError(
    'network',
    'Could not verify the invitation. Check your connection and try opening the link again.',
  );
}

async function existingSessionAccessToken(auth: InvitationAuthClient): Promise<string | null> {
  try {
    const current = await auth.getSession();
    return current.error ? null : (current.data.session?.access_token ?? null);
  } catch {
    return null;
  }
}

export async function establishInvitationSession(
  auth: InvitationAuthClient,
  callback: InvitationCallback,
): Promise<string> {
  // Keep the invitation guard active while we establish or resume a setup session
  // so SessionProvider does not treat it as a normal login and sign it out.
  setInvitationSetupActive(true);

  if (callback.kind === 'invalid') {
<<<<<<< HEAD
=======
    const existingAccessToken = await existingSessionAccessToken(auth);
    if (existingAccessToken) return existingAccessToken;
>>>>>>> d716e8a721fcc0fc5a72dce0bccdf9d92ead64ce
    setInvitationSetupActive(false);
    throw new InvitationFlowError(callback.reason, callback.message);
  }

<<<<<<< HEAD
  setInvitationSetupActive(true);

  let result: AuthResponse;
  try {
    result =
      callback.kind === 'pkce'
        ? await auth.exchangeCodeForSession(callback.code)
        : callback.kind === 'session'
          ? await auth.setSession({
              access_token: callback.accessToken,
              refresh_token: callback.refreshToken,
            })
          : await auth.verifyOtp({ token_hash: callback.tokenHash, type: callback.type });
  } catch {
    setInvitationSetupActive(false);
    throw new InvitationFlowError(
      'network',
      'Could not verify the invitation. Check your connection and try opening the link again.',
    );
  }

  if (result.error || !result.data.session) {
=======
  let result: AuthResponse;
  try {
    result =
      callback.kind === 'pkce'
        ? await auth.exchangeCodeForSession(callback.code)
        : callback.kind === 'session'
          ? await auth.setSession({
              access_token: callback.accessToken,
              refresh_token: callback.refreshToken,
            })
          : await auth.verifyOtp({ token_hash: callback.tokenHash, type: callback.type });
  } catch {
    const existingAccessToken = await existingSessionAccessToken(auth);
    if (existingAccessToken) return existingAccessToken;
    setInvitationSetupActive(false);
    throw new InvitationFlowError(
      'network',
      'Could not verify the invitation. Check your connection and try opening the link again.',
    );
  }

  if (result.error || !result.data.session) {
    // A browser callback may already have been consumed by a remount or email
    // preview. If the setup session is already stored locally, continue.
    const existingAccessToken = await existingSessionAccessToken(auth);
    if (existingAccessToken) return existingAccessToken;
>>>>>>> d716e8a721fcc0fc5a72dce0bccdf9d92ead64ce
    setInvitationSetupActive(false);
    throw providerFailure(result.error);
  }
  return result.data.session.access_token;
}

export interface PasswordValidation {
  password?: string;
  confirmation?: string;
}

export function validateInvitationPassword(
  password: string,
  confirmation: string,
): PasswordValidation {
  const issues: PasswordValidation = {};
  if (
    password.length < 10 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/[0-9]/.test(password)
  ) {
    issues.password =
      'Use at least 10 characters with an uppercase letter, lowercase letter, and number.';
  }
  if (password !== confirmation) issues.confirmation = 'Passwords do not match.';
  return issues;
}

export async function completeInvitationPassword(
  auth: InvitationAuthClient,
  password: string,
  refreshUser: (accessToken?: string) => Promise<CurrentUser>,
): Promise<CurrentUser> {
  const sessionBefore = await existingSessionAccessToken(auth);
  if (!sessionBefore) {
    setInvitationSetupActive(false);
    throw new InvitationFlowError('expired', SETUP_SESSION_EXPIRED_MESSAGE);
  }

  const updated = await auth.updateUser({ password });
  if (updated.error) {
    if (looksExpired(updated.error.message) || updated.error.status === 401) {
      throw new InvitationFlowError('expired', SETUP_SESSION_EXPIRED_MESSAGE);
    }
    throw providerFailure(updated.error);
  }

  const sessionResult = await auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;
  if (sessionResult.error || !accessToken) {
    await auth.signOut();
    throw new InvitationFlowError(
      'profile',
      'Your password was saved, but the POS session could not be verified. Sign in with your new password.',
    );
  }

  try {
    const user = await refreshUser(accessToken);
    if (user.role !== 'owner') {
      throw new Error('The invited account is not an organization owner');
    }
    setInvitationSetupActive(false);
    return user;
<<<<<<< HEAD
  } catch {
=======
  } catch (error) {
    if (error instanceof InvitationFlowError) throw error;
>>>>>>> d716e8a721fcc0fc5a72dce0bccdf9d92ead64ce
    setInvitationSetupActive(false);
    await auth.signOut();
    throw new InvitationFlowError(
      'profile',
      'Your password was saved, but your active POS owner profile could not be loaded. Contact your administrator before signing in.',
    );
  }
}

export async function finishInvitationSetup(
  auth: InvitationAuthClient,
  password: string,
  refreshUser: (accessToken?: string) => Promise<CurrentUser>,
  onAuthorized: (user: CurrentUser) => void,
): Promise<CurrentUser> {
  const user = await completeInvitationPassword(auth, password, refreshUser);
  onAuthorized(user);
  return user;
}

export interface SubmissionGuard {
  current: boolean;
}

export async function runInvitationSubmission<T>(
  guard: SubmissionGuard,
  work: () => Promise<T>,
): Promise<{ started: boolean; value?: T }> {
  if (guard.current) return { started: false };
  guard.current = true;
  try {
    return { started: true, value: await work() };
  } finally {
    guard.current = false;
  }
}
