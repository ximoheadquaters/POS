import { createClient } from '@supabase/supabase-js';
import type { AppConfig } from '../config.js';
import { conflict, serviceUnavailable, unauthorized } from '../shared/errors.js';
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
      async inviteUser(input) {
        const options = {
          data: { display_name: input.displayName },
          redirectTo: config.PLATFORM_OWNER_INVITE_REDIRECT_URL,
        };
        const { data, error } = await adminClient.auth.admin.inviteUserByEmail(
          input.email,
          options,
        );
        if (error || !data.user?.email) {
          if (
            error?.status === 422 ||
            error?.message.toLowerCase().includes('already') ||
            error?.message.toLowerCase().includes('registered')
          ) {
            throw conflict(
              'OWNER_ALREADY_EXISTS',
              'An authentication account already exists for this owner email',
            );
          }
          throw serviceUnavailable(
            'OWNER_INVITATION_UNAVAILABLE',
            'The owner invitation service is temporarily unavailable',
          );
        }
        return { id: data.user.id, email: data.user.email };
      },
      async resendOwnerInvitation(email) {
        // Supabase does not re-invite an existing user. A recovery email establishes the
        // same secure password-setup session without deleting or duplicating the Auth user.
        const { error } = await publicClient.auth.resetPasswordForEmail(email, {
          redirectTo: config.PLATFORM_OWNER_INVITE_REDIRECT_URL,
        });
        if (error) {
          throw serviceUnavailable(
            'OWNER_INVITATION_UNAVAILABLE',
            'The owner invitation service is temporarily unavailable',
          );
        }
      },
      async changePassword(userId, password) {
        const current = await adminClient.auth.admin.getUserById(userId);
        if (current.error || !current.data.user) {
          throw serviceUnavailable(
            'PASSWORD_CHANGE_UNAVAILABLE',
            'Password changes are temporarily unavailable',
          );
        }
        const { error } = await adminClient.auth.admin.updateUserById(userId, {
          password,
          app_metadata: {
            ...current.data.user.app_metadata,
            must_change_password: false,
          },
        });
        if (error) {
          throw serviceUnavailable(
            'PASSWORD_CHANGE_UNAVAILABLE',
            'Password changes are temporarily unavailable',
          );
        }
      },
      async getUser(userId) {
        const { data, error } = await adminClient.auth.admin.getUserById(userId);
        if (error) {
          if (error.status === 404) return null;
          throw serviceUnavailable(
            'AUTH_USER_LOOKUP_UNAVAILABLE',
            'Authentication account details are temporarily unavailable',
          );
        }
        if (!data.user?.email) return null;
        return {
          id: data.user.id,
          email: data.user.email,
          createdAt: data.user.created_at,
          invitedAt: data.user.invited_at ?? null,
          lastSignInAt: data.user.last_sign_in_at ?? null,
        };
      },
      async deleteUser(userId) {
        const { error } = await adminClient.auth.admin.deleteUser(userId);
        if (error) throw new Error(error.message);
      },
    },
  };
}
