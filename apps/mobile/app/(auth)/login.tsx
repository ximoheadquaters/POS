import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@ximo/shared';
import { ApiError } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session';
import { BrandLogo } from '@/components/brand';
import { Button, Field, Screen } from '@/components/ui';

export default function LoginScreen() {
  const { refreshUser } = useSession();
  const [serverError, setServerError] = useState('');
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  async function submit(input: LoginInput) {
    setServerError('');
    const { data, error } = await supabase.auth.signInWithPassword({
      ...input,
      email: input.email.trim(),
    });
    if (error || !data.session) {
      setServerError('Email or password is incorrect.');
      return;
    }
    try {
      const user = await refreshUser(data.session.access_token);
      router.replace(user.mustChangePassword ? '/change-password' : '/branch-select');
    } catch (error) {
      await supabase.auth.signOut();
      setServerError(
        error instanceof ApiError
          ? error.message
          : 'Could not reach the POS server. Check your connection and try again.',
      );
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="w-full max-w-md self-center">
            <View className="mb-8 flex-row items-center justify-center gap-3">
              <View className="h-12 w-12 items-center justify-center rounded-2xl bg-brand-700">
                <BrandLogo size={36} />
              </View>
              <Text className="text-2xl font-bold tracking-tight text-brand-900">Ximo POS</Text>
            </View>
            <View className="rounded-3xl border border-slate-100 bg-white p-6 sm:p-8">
              <Text
                accessibilityRole="header"
                className="text-2xl font-bold tracking-tight text-brand-900"
              >
                Welcome back
              </Text>
              <Text className="mb-7 mt-2 text-sm leading-5 text-slate-500">
                Sign in to your workspace to get started.
              </Text>
              <Controller
                control={control}
                name="email"
                render={({ field: { onChange, onBlur, value } }) => (
                  <Field
                    label="Email"
                    accessibilityLabel="Email"
                    placeholder="you@example.com"
                    className="min-h-12"
                    autoCapitalize="none"
                    autoComplete="email"
                    autoCorrect={false}
                    keyboardType="email-address"
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    error={errors.email?.message}
                  />
                )}
              />
              <Controller
                control={control}
                name="password"
                render={({ field: { onChange, onBlur, value } }) => (
                  <Field
                    label="Password"
                    accessibilityLabel="Password"
                    placeholder="Enter your password"
                    className="min-h-12"
                    autoComplete="current-password"
                    secureTextEntry
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    error={errors.password?.message}
                  />
                )}
              />
              {serverError ? (
                <View className="mb-4 rounded-xl bg-red-50 p-3">
                  <Text accessibilityRole="alert" className="text-sm leading-5 text-red-700">
                    {serverError}
                  </Text>
                </View>
              ) : null}
              <View className="mt-3">
                <Button
                  title={isSubmitting ? 'Signing In…' : 'Sign In'}
                  disabled={isSubmitting}
                  onPress={handleSubmit(submit)}
                />
              </View>
            </View>
            <Text className="mt-6 text-center text-xs leading-5 text-slate-400">
              Fast, clear checkout for every branch.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
