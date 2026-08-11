import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/providers/session';
import { BrandLogo } from '@/components/brand';
import { Button, Field, Screen } from '@/components/ui';

function passwordIssue(password: string, confirmation: string): string {
  if (
    password.length < 10 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/[0-9]/.test(password)
  ) {
    return 'Use at least 10 characters with uppercase, lowercase, and a number.';
  }
  if (password !== confirmation) return 'Passwords do not match.';
  return '';
}

export default function ChangePasswordScreen() {
  const { refreshUser, signOut } = useSession();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    const validation = passwordIssue(password, confirmation);
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api<{ changed: true }>('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      await refreshUser();
      router.replace('/branch-select');
    } catch (changeError) {
      setError(
        changeError instanceof ApiError
          ? changeError.message
          : 'Could not change your password. Check your connection and try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerClassName="flex-grow justify-center px-5 py-8" keyboardShouldPersistTaps="handled">
          <View className="mx-auto w-full max-w-xl">
            <View className="mb-5 rounded-3xl bg-brand-700 p-6">
              <BrandLogo size={56} />
              <Text className="mt-5 text-3xl font-black text-white">Protect your account</Text>
              <Text className="mt-2 leading-6 text-brand-100">
                Replace the temporary password from your setup email before entering the POS.
              </Text>
            </View>
            <View className="rounded-3xl border border-slate-100 bg-white p-5">
              <Text className="text-2xl font-black text-brand-900">Create your password</Text>
              <Text className="mb-5 mt-2 leading-6 text-slate-500">
                Use at least 10 characters with uppercase, lowercase, and a number.
              </Text>
              <Field label="New password" autoCapitalize="none" autoComplete="new-password" secureTextEntry value={password} onChangeText={setPassword} />
              <Field label="Confirm password" autoCapitalize="none" autoComplete="new-password" secureTextEntry value={confirmation} onChangeText={setConfirmation} onSubmitEditing={submit} />
              {error ? (
                <View accessibilityRole="alert" className="mb-4 rounded-xl bg-red-50 p-3">
                  <Text className="text-sm leading-5 text-red-700">{error}</Text>
                </View>
              ) : null}
              <Button title={saving ? 'Saving...' : 'Save my password'} disabled={saving} onPress={submit} />
              <View className="mt-3">
                <Button title="Sign out" variant="secondary" onPress={signOut} />
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
