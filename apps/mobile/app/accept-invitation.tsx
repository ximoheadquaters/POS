import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { BrandLogo } from '@/components/brand';
import { Button, LoadingState, Screen } from '@/components/ui';
import {
  completeInvitationVerification,
  establishInvitationSession,
  InvitationFlowError,
  INVALID_INVITATION_MESSAGE,
  parseInvitationCallback,
  setInvitationSetupActive,
} from '@/lib/invitation';
import { supabase } from '@/lib/supabase';

type PageState =
  | { kind: 'loading' }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

function browserUrl(): string | null {
  if (Platform.OS !== 'web') return null;
  return globalThis.location?.href ?? null;
}

function clearBrowserCallback() {
  if (Platform.OS === 'web') globalThis.history?.replaceState({}, '', '/accept-invitation');
}

export default function AcceptInvitationScreen() {
  const incomingUrl = Linking.useURL();
  const handledCallback = useRef(false);
  const [page, setPage] = useState<PageState>({ kind: 'loading' });

  useEffect(() => {
    if (handledCallback.current) return;
    handledCallback.current = true;

    void (async () => {
      const callbackUrl = incomingUrl ?? browserUrl() ?? (await Linking.getInitialURL());
      if (!callbackUrl) {
        setPage({ kind: 'error', message: INVALID_INVITATION_MESSAGE });
        return;
      }
      try {
        const callback = parseInvitationCallback(callbackUrl);
        clearBrowserCallback();
        await establishInvitationSession(supabase.auth, callback);
        await completeInvitationVerification(supabase.auth);
        setPage({ kind: 'success' });
      } catch (error) {
        setInvitationSetupActive(false);
        setPage({
          kind: 'error',
          message:
            error instanceof InvitationFlowError
              ? error.message
              : 'Could not verify your email. Check your connection and open the newest link again.',
        });
      }
    })();
  }, [incomingUrl]);

  if (page.kind === 'loading') {
    return (
      <Screen>
        <LoadingState label="Verifying your email..." />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerClassName="flex-grow justify-center px-5 py-8">
        <View className="mx-auto w-full max-w-xl">
          <View className="mb-5 rounded-3xl bg-brand-700 p-6">
            <View className="mb-5">
              <BrandLogo size={56} />
            </View>
            <Text className="text-3xl font-black text-white">Welcome to Ximo POS</Text>
            <Text className="mt-2 text-base leading-6 text-brand-100">
              Secure owner access for your new Ximo workspace.
            </Text>
          </View>

          <View className="rounded-3xl border border-slate-100 bg-white p-5">
            {page.kind === 'success' ? (
              <View accessibilityRole="alert">
                <Text className="text-2xl font-black text-brand-900">Email verified</Text>
                <Text className="mt-3 leading-6 text-slate-600">
                  Your email address is confirmed. Sign in using the temporary password in your
                  newest Ximo email. You will replace it with your own password after signing in.
                </Text>
                <View className="mt-5">
                  <Button title="Continue to sign in" onPress={() => router.replace('/(auth)/login')} />
                </View>
              </View>
            ) : (
              <View accessibilityRole="alert">
                <Text className="text-2xl font-black text-brand-900">Verification link unavailable</Text>
                <Text className="mt-3 leading-6 text-red-700">{page.message}</Text>
                <View className="mt-4 rounded-2xl bg-amber-50 p-4">
                  <Text className="text-sm leading-5 text-amber-900">
                    Only the newest verification link works. Ask your Ximo administrator to resend
                    the owner setup email if this link was already opened.
                  </Text>
                </View>
                <View className="mt-5">
                  <Button
                    title="Back to sign in"
                    variant="secondary"
                    onPress={() => router.replace('/(auth)/login')}
                  />
                </View>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
