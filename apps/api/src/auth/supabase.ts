import { createClient } from '@supabase/supabase-js';
import type { AppConfig } from '../config.js';
import { conflict, unauthorized } from '../shared/errors.js';
import type { AuthActions, VerifyToken } from './types.js';

export function createSupabaseAuth(config: AppConfig): {
  verifyToken: VerifyToken;
  actions: AuthActions;
} {
  const publicClient = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
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
        if (error) throw new Error(error.message);
      },
      async createUser(input) {
        const { data, error } = await adminClient.auth.admin.createUser({
          email: input.email,
          password: input.password,
          email_confirm: true,
          user_metadata: { display_name: input.displayName },
        });
        if (error || !data.user?.email) {
          throw conflict(
            'AUTH_USER_CREATE_FAILED',
            error?.message ?? 'The employee account could not be created',
          );
        }
        return { id: data.user.id, email: data.user.email };
      },
      async deleteUser(userId) {
        const { error } = await adminClient.auth.admin.deleteUser(userId);
        if (error) throw new Error(error.message);
      },
    },
  };
}
