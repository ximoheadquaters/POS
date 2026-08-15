import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { BrandLogo } from '@/components/brand';
import { Button, Field, LoadingState, Screen } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import {
  establishInvitationSession,
  InvitationFlowError,
  INVALID_INVITATION_MESSAGE,
  PASSWORD_SAVED_SIGN_IN_MESSAGE,
  SETUP_SESSION_EXPIRED_MESSAGE,
  setInvitationSetupActive,
  parseInvitationCallback,
  runInvitationSubmission,
  validateInvitationPassword,
  type PasswordValidation,
} from '@/lib/invitation';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session';

type PageState =
  | { kind: 'loading' }
  | { kind: 'form' }
  | { kind: 'success'; message?: string; goToLogin?: boolean }
  | { kind: 'error'; message: string };

// Survive React remounts so the one-time invite token is not verified twice.
let invitationCallbackHandled = false;

function browserUrl(): string | null {
  if (Platform.OS !== 'web') return null;
  return globalThis.location?.href ?? null;
}

function clearBrowserCallback() {
  if (Platform.OS === 'web') {
    globalThis.history?.replaceState({}, '', '/accept-invitation');
  }
}

export default function AcceptInvitationScreen() {
  const incomingUrl = Linking.useURL();
  const { refreshUser, signOut } = useSession();
  const submissionGuard = useRef(false);
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [page, setPage] = useState<PageState>({ kind: 'loading' });
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [issues, setIssues] = useState<PasswordValidation>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    if (invitationCallbackHandled) return;
    invitationCallbackHandled = true;

    void (async () => {
      const callbackUrl = incomingUrl ?? browserUrl() ?? (await Linking.getInitialURL());
      if (!callbackUrl) {
        setPage({ kind: 'error', message: INVALID_INVITATION_MESSAGE });
        return;
      }
      try {
        const callback = parseInvitationCallback(callbackUrl);
        await establishInvitationSession(supabase.auth, callback);
        // Clear the one-time token from the address bar only after the session
        // is established so remounts can still resume from a stored session.
        clearBrowserCallback();
        setPage({ kind: 'form' });
      } catch (error) {
        setInvitationSetupActive(false);
        setPage({
          kind: 'error',
          message:
            error instanceof InvitationFlowError
              ? error.message
              : 'Could not verify the invitation. Check your connection and open the link again.',
        });
      }
    })();

    return () => {
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
    };
  }, [incomingUrl]);

  async function submit() {
    const validation = validateInvitationPassword(password, confirmation);
    setIssues(validation);
    setSubmitError('');
    if (Object.keys(validation).length) return;

    const result = await runInvitationSubmission(submissionGuard, async () => {
      setSubmitting(true);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) {
          setSubmitError(SETUP_SESSION_EXPIRED_MESSAGE);
          return;
        }

        // 1) Always save the Auth password first (does not depend on POS API).
        const updated = await supabase.auth.updateUser({ password });
        if (updated.error) {
          setSubmitError(
            /session|expired|invalid|not authenticated/i.test(updated.error.message)
              ? SETUP_SESSION_EXPIRED_MESSAGE
              : updated.error.message,
          );
          return;
        }

        // 2) Best-effort: clear must_change_password + load POS profile.
        try {
          await api<{ changed: true }>('/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({ password }),
            accessToken: session.access_token,
          });
          const user = await refreshUser(session.access_token);
          if (user.role !== 'owner') {
            throw new Error('The invited account is not an organization owner');
          }
          setInvitationSetupActive(false);
          setPage({ kind: 'success' });
          redirectTimer.current = setTimeout(() => router.replace('/branch-select'), 900);
          return;
        } catch (error) {
          // Password is already saved in Auth. If the API is misconfigured (401),
          // send the owner to sign in instead of blocking setup.
          setInvitationSetupActive(false);
          await supabase.auth.signOut();
          const apiMessage =
            error instanceof ApiError
              ? error.message
              : error instanceof Error
                ? error.message
                : '';
          setPage({
            kind: 'success',
            goToLogin: true,
            message:
              apiMessage && /profile|unauthorized|401/i.test(apiMessage)
                ? `${PASSWORD_SAVED_SIGN_IN_MESSAGE} (${apiMessage})`
                : PASSWORD_SAVED_SIGN_IN_MESSAGE,
          });
          redirectTimer.current = setTimeout(() => router.replace('/(auth)/login'), 1200);
        }
      } catch (error) {
        setSubmitError(
          error instanceof InvitationFlowError
            ? error.message
            : error instanceof ApiError
              ? error.message
              : 'Could not save your password. Check your connection and try again.',
        );
      } finally {
        setSubmitting(false);
      }
    });
    if (!result.started) return;
  }

  async function returnToLogin() {
    if (redirectTimer.current) clearTimeout(redirectTimer.current);
    setInvitationSetupActive(false);
    await signOut();
    router.replace('/(auth)/login');
  }

  if (page.kind === 'loading') {
    return (
      <Screen>
        <LoadingState label="Verifying your secure invitation…" />
      </Screen>
    );
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerClassName="flex-grow justify-center px-5 py-8"
          keyboardShouldPersistTaps="handled"
        >
          <View className="mx-auto w-full max-w-xl">
            <View className="mb-5 rounded-3xl bg-brand-700 p-6">
              <View className="mb-5">
                <BrandLogo size={56} />
              </View>
              <Text className="text-3xl font-black text-white">Set up your POS access</Text>
              <Text className="mt-2 text-base leading-6 text-brand-100">
                Create your owner password to securely manage your branches and team.
              </Text>
            </View>

            <View className="rounded-3xl border border-slate-100 bg-white p-5">
              {page.kind === 'success' ? (
                <View accessibilityRole="alert">
                  <Text className="text-2xl font-black text-brand-900">Password created</Text>
                  <Text className="mt-3 leading-6 text-slate-600">
                    {page.message ??
                      (page.goToLogin
                        ? PASSWORD_SAVED_SIGN_IN_MESSAGE
                        : 'Your owner account is ready. Taking you to branch selection…')}
                  </Text>
                  <View className="mt-5">
                    <Button
                      title={page.goToLogin ? 'Continue to sign in' : 'Continue to POS'}
                      onPress={() =>
                        router.replace(page.goToLogin ? '/(auth)/login' : '/branch-select')
                      }
                    />
                  </View>
                </View>
              ) : page.kind === 'error' ? (
                <View accessibilityRole="alert">
                  <Text className="text-2xl font-black text-brand-900">Invitation unavailable</Text>
                  <Text className="mt-3 leading-6 text-red-700">{page.message}</Text>
                  <View className="mt-5">
                    <Button title="Back to sign in" variant="secondary" onPress={returnToLogin} />
                  </View>
                </View>
              ) : (
                <>
                  <Text className="text-2xl font-black text-brand-900">Create your password</Text>
                  <Text className="mb-5 mt-2 leading-6 text-slate-500">
                    Use at least 10 characters with uppercase, lowercase, and a number.
                  </Text>
                  <Field
                    label="Password"
                    accessibilityLabel="Password"
                    autoCapitalize="none"
                    autoComplete="new-password"
                    secureTextEntry
                    value={password}
                    onChangeText={setPassword}
                    error={issues.password}
                  />
                  <Field
                    label="Confirm password"
                    accessibilityLabel="Confirm password"
                    autoCapitalize="none"
                    autoComplete="new-password"
                    secureTextEntry
                    value={confirmation}
                    onChangeText={setConfirmation}
                    error={issues.confirmation}
                    onSubmitEditing={submit}
                  />
                  {submitError ? (
                    <View accessibilityRole="alert" className="mb-4 rounded-xl bg-red-50 p-3">
                      <Text className="text-sm leading-5 text-red-700">{submitError}</Text>
                    </View>
                  ) : null}
                  <Button
                    title={submitting ? 'Saving password…' : 'Create password'}
                    accessibilityLabel="Create password"
                    disabled={submitting}
                    onPress={submit}
                  />
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel="Back to POS sign in"
                    className="mt-5 min-h-11 items-center justify-center"
                    onPress={returnToLogin}
                  >
                    <Text className="font-bold text-brand-700">Back to POS sign in</Text>
                  </Pressable>
                </>
              )}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
