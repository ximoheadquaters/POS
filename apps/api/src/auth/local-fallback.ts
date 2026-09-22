import { createClient } from '@supabase/supabase-js';
import { serviceUnavailable, unauthorized } from '../shared/errors.js';
import type { AuthActions, VerifyToken } from './types.js';

export interface LocalFallbackAuthConfig {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

const unavailable = (): never => {
  throw serviceUnavailable(
    'LOCAL_FALLBACK_LIMITED',
    'This action requires the hosted POS service. Reconnect and try again.',
  );
};

/**
 * Auth used by the loopback fallback server. It deliberately uses only the
 * public Supabase client: signing in, password resets, and bearer-token
 * verification remain available, while service-role operations do not.
 */
export function createLocalFallbackAuth(config: LocalFallbackAuthConfig): {
  verifyToken: VerifyToken;
  actions: AuthActions;
} {
  const publicClient = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const verifyToken: VerifyToken = async (token) => {
    const { data, error } = await publicClient.auth.getUser(token);
    if (error || !data.user?.email) throw unauthorized('The access token is invalid or expired');
    return { id: data.user.id, email: data.user.email };
  };

  return {
    verifyToken,
    actions: {
      async login(email, password) {
        const { data, error } = await publicClient.auth.signInWithPassword({ email, password });
        if (error) throw unauthorized('Invalid email or password');
        return {
          accessToken: data.session?.access_token,
          refreshToken: data.session?.refresh_token,
          expiresAt: data.session?.expires_at,
        };
      },
      async resetPassword(email) {
        const { error } = await publicClient.auth.resetPasswordForEmail(email);
        if (error) throw serviceUnavailable('PASSWORD_RESET_UNAVAILABLE', error.message);
      },
      createUser: unavailable,
      inviteUser: unavailable,
      resendOwnerInvitation: unavailable,
      changePassword: unavailable,
      findUserByEmail: unavailable,
      getUser: unavailable,
      deleteUser: unavailable,
    },
  };
}
