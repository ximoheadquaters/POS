import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@ximo/shared';
import { ApiError } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session';
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
    const { data, error } = await supabase.auth.signInWithPassword(input);
    if (error || !data.session) {
      setServerError('Email or password is incorrect.');
      return;
    }
    try {
      await refreshUser(data.session.access_token);
      router.replace('/branch-select');
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
        className="flex-1 justify-center px-5"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View className="mb-5 rounded-3xl bg-brand-700 p-6">
          <View className="mb-5 h-14 w-14 items-center justify-center rounded-2xl bg-white">
            <Text className="text-3xl font-black text-brand-700">X</Text>
          </View>
          <Text className="text-4xl font-black text-white">Ximo POS</Text>
          <Text className="mt-2 text-base leading-6 text-brand-100">
            Fast, clear checkout for every branch.
          </Text>
        </View>
        <View className="rounded-3xl border border-slate-100 bg-white p-5">
          <Text className="mb-5 text-xl font-black text-brand-900">Welcome back</Text>
          <Controller
            control={control}
            name="email"
            render={({ field: { onChange, onBlur, value } }) => (
              <Field
                label="Email"
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
              <Text className="text-sm leading-5 text-red-700">{serverError}</Text>
            </View>
          ) : null}
          <Button
            title={isSubmitting ? 'Signing in…' : 'Sign in'}
            disabled={isSubmitting}
            onPress={handleSubmit(submit)}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
