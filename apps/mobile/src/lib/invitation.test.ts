import type { CurrentUser } from '@ximo/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  completeInvitationPassword,
  establishInvitationSession,
  finishInvitationSetup,
  INVALID_INVITATION_MESSAGE,
  InvitationFlowError,
  parseInvitationCallback,
  runInvitationSubmission,
  validateInvitationPassword,
  type InvitationAuthClient,
} from './invitation';

const session = { access_token: 'session-access-token' };
const success = { data: { session }, error: null };

function authFixture(
  options: {
    exchangeError?: { message: string; status?: number };
    updateError?: { message: string; status?: number };
  } = {},
) {
  const auth: InvitationAuthClient = {
    exchangeCodeForSession: vi.fn(async () =>
      options.exchangeError ? { data: { session: null }, error: options.exchangeError } : success,
    ),
    setSession: vi.fn(async () => success),
    verifyOtp: vi.fn(async () => success),
    updateUser: vi.fn(async () => ({
      data: {},
      error: options.updateError ?? null,
    })),
    getSession: vi.fn(async () => success),
    signOut: vi.fn(async () => undefined),
  };
  return auth;
}

const owner: CurrentUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'owner@example.com',
  displayName: 'Client Owner',
  organization: {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Client Business',
    currency: 'PHP',
    timezone: 'Asia/Manila',
    subscriptionStatus: 'active',
  },
  role: 'owner',
  permissions: [],
  modules: [],
  branches: [],
};

describe('POS owner invitation flow', () => {
  it('parses and exchanges a valid PKCE invitation callback', async () => {
    const callback = parseInvitationCallback(
      'https://pos.example.com/accept-invitation?code=pkce-code-value',
    );
    expect(callback).toEqual({ kind: 'pkce', code: 'pkce-code-value' });

    const auth = authFixture();
    await expect(establishInvitationSession(auth, callback)).resolves.toBe('session-access-token');
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('pkce-code-value');
  });

  it('supports implicit session and token-hash callback formats', async () => {
    const auth = authFixture();
    const implicit = parseInvitationCallback(
      'ximopos://accept-invitation#access_token=access&refresh_token=refresh&type=invite',
    );
    await establishInvitationSession(auth, implicit);
    expect(auth.setSession).toHaveBeenCalledWith({
      access_token: 'access',
      refresh_token: 'refresh',
    });

    const otp = parseInvitationCallback(
      'https://pos.example.com/accept-invitation?token_hash=hash-value&type=recovery',
    );
    await establishInvitationSession(auth, otp);
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      token_hash: 'hash-value',
      type: 'recovery',
    });
  });

  it('rejects missing callback credentials and expired provider callbacks', async () => {
    const invalid = parseInvitationCallback('https://pos.example.com/accept-invitation');
    expect(invalid).toEqual({
      kind: 'invalid',
      reason: 'invalid',
      message: INVALID_INVITATION_MESSAGE,
    });
    await expect(establishInvitationSession(authFixture(), invalid)).rejects.toMatchObject({
      kind: 'invalid',
      message: INVALID_INVITATION_MESSAGE,
    });

    const expired = parseInvitationCallback(
      'https://pos.example.com/accept-invitation?error=access_denied&error_description=Email+link+is+invalid+or+has+expired',
    );
    expect(expired.kind).toBe('invalid');
    await expect(establishInvitationSession(authFixture(), expired)).rejects.toMatchObject({
      kind: 'expired',
      message: INVALID_INVITATION_MESSAGE,
    });

    await expect(
      establishInvitationSession(
        authFixture({ exchangeError: { message: 'fetch failed', status: 503 } }),
        { kind: 'pkce', code: 'valid-format-code' },
      ),
    ).rejects.toMatchObject({
      kind: 'network',
      message:
        'Could not verify the invitation. Check your connection and try opening the link again.',
    });
  });

  it('validates weak and mismatched passwords', () => {
    expect(validateInvitationPassword('weak', 'different')).toEqual({
      password:
        'Use at least 10 characters with an uppercase letter, lowercase letter, and number.',
      confirmation: 'Passwords do not match.',
    });
    expect(validateInvitationPassword('SecurePass1', 'SecurePass1')).toEqual({});
  });

  it('updates the password and redirects only after the owner profile refreshes', async () => {
    const auth = authFixture();
    const events: string[] = [];
    const refreshUser = vi.fn(async () => {
      events.push('profile');
      return owner;
    });

    await finishInvitationSetup(auth, 'SecurePass1', refreshUser, () => {
      events.push('redirect:/branch-select');
    });

    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'SecurePass1' });
    expect(refreshUser).toHaveBeenCalledWith('session-access-token');
    expect(events).toEqual(['profile', 'redirect:/branch-select']);
  });

  it('signs out and reports a clear error when the POS profile refresh fails', async () => {
    const auth = authFixture();
    await expect(
      completeInvitationPassword(auth, 'SecurePass1', async () => {
        throw new Error('API unavailable');
      }),
    ).rejects.toEqual(
      new InvitationFlowError(
        'profile',
        'Your password was saved, but your active POS owner profile could not be loaded. Contact your administrator before signing in.',
      ),
    );
    expect(auth.signOut).toHaveBeenCalledOnce();
  });

  it('prevents duplicate password submissions while one is pending', async () => {
    const guard = { current: false };
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const work = vi.fn(async () => pending);

    const first = runInvitationSubmission(guard, work);
    const duplicate = await runInvitationSubmission(guard, work);
    expect(duplicate).toEqual({ started: false });
    expect(work).toHaveBeenCalledOnce();

    release();
    await expect(first).resolves.toMatchObject({ started: true });
  });
});
