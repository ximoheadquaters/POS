import { randomBytes } from 'node:crypto';
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

  function temporaryPassword(): string {
    // 128 bits of randomness plus a fixed mixed-case/symbol prefix keeps the
    // password strong while remaining easy to copy from the setup email.
    return `Ximo!${randomBytes(16).toString('base64url')}`;
  }

  async function clearTemporaryPasswordMetadata(
    userId: string,
    displayName: string,
  ): Promise<void> {
    const { error } = await adminClient.auth.admin.updateUserById(userId, {
      user_metadata: { display_name: displayName },
    });
    if (error) {
      // The temporary password has already been delivered and is intentionally
      // not logged. A later password change replaces it even if cleanup fails.
    }
  }

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
        const generatedPassword = temporaryPassword();
        const options = {
          data: {
            display_name: input.displayName,
            temporary_password: generatedPassword,
          },
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
        const passwordResult = await adminClient.auth.admin.updateUserById(data.user.id, {
          password: generatedPassword,
          app_metadata: {
            ...data.user.app_metadata,
            must_change_password: true,
          },
        });
        if (passwordResult.error) {
          await adminClient.auth.admin.deleteUser(data.user.id);
          throw serviceUnavailable(
            'OWNER_INVITATION_UNAVAILABLE',
            'The owner invitation service is temporarily unavailable',
          );
        }
        await clearTemporaryPasswordMetadata(data.user.id, input.displayName);
        return { id: data.user.id, email: data.user.email };
      },
      async resendOwnerInvitation(input) {
        const generatedPassword = temporaryPassword();
        const current = await adminClient.auth.admin.getUserById(input.id);
        if (current.error || !current.data.user) {
          throw serviceUnavailable(
            'OWNER_INVITATION_UNAVAILABLE',
            'The owner invitation service is temporarily unavailable',
          );
        }
        const prepared = await adminClient.auth.admin.updateUserById(input.id, {
          password: generatedPassword,
          user_metadata: {
            ...current.data.user.user_metadata,
            display_name: input.displayName,
            temporary_password: generatedPassword,
          },
          app_metadata: {
            ...current.data.user.app_metadata,
            must_change_password: true,
          },
        });
        if (prepared.error) {
          throw serviceUnavailable(
            'OWNER_INVITATION_UNAVAILABLE',
            'The owner invitation service is temporarily unavailable',
          );
        }

        // Supabase cannot send a second invite for an existing Auth user. Its
        // recovery delivery creates an equally short-lived, single-use OTP.
        // The Ximo email and callback use that OTP strictly for email
        // verification; the owner signs in separately with the generated
        // temporary password above.
        const { error } = await publicClient.auth.resetPasswordForEmail(input.email, {
          redirectTo: config.PLATFORM_OWNER_INVITE_REDIRECT_URL,
        });
        if (error) {
          throw serviceUnavailable(
            'OWNER_INVITATION_UNAVAILABLE',
            'The owner invitation service is temporarily unavailable',
          );
        }
        await clearTemporaryPasswordMetadata(input.id, input.displayName);
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
