import type { PropsWithChildren, ReactNode } from 'react';
import { router, type Href } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function Screen({ children }: PropsWithChildren) {
  return <SafeAreaView className="flex-1 bg-slate-50">{children}</SafeAreaView>;
}

export function Header({
  title,
  subtitle,
  action,
  showBack = false,
  backLabel = 'Back',
  fallbackHref = '/(tabs)',
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  showBack?: boolean;
  backLabel?: string;
  fallbackHref?: Href;
}) {
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace(fallbackHref);
  };
  return (
    <View className="flex-row items-center border-b border-brand-100 bg-white px-4 py-3">
      {showBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Go back to ${backLabel}`}
          hitSlop={8}
          onPress={goBack}
          className="mr-3 min-h-11 flex-row items-center justify-center rounded-xl border border-brand-100 bg-brand-50 px-3 active:bg-brand-100"
        >
          <Text className="mr-1 text-xl font-bold text-brand-700">{'\u2039'}</Text>
          <Text className="text-sm font-bold text-brand-700">{backLabel}</Text>
        </Pressable>
      ) : null}
      <View className="flex-1">
        <Text numberOfLines={1} className="text-2xl font-black text-brand-900">
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={2} className="mt-0.5 text-sm leading-5 text-slate-500">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action ? <View className="ml-3">{action}</View> : null}
    </View>
  );
}

export function Button({
  title,
  variant = 'primary',
  disabled,
  ...props
}: PressableProps & { title: string; variant?: 'primary' | 'secondary' | 'danger' }) {
  const color =
    variant === 'primary'
      ? 'bg-brand-700'
      : variant === 'danger'
        ? 'bg-red-700'
        : 'bg-brand-500';
  const text = 'text-white';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      className={`min-h-14 items-center justify-center rounded-xl px-5 ${color} ${disabled ? 'opacity-50' : 'active:opacity-80'}`}
      {...props}
    >
      <Text className={`text-base font-bold ${text}`}>{title}</Text>
    </Pressable>
  );
}

export function Field({
  label,
  error,
  ...props
}: TextInputProps & { label: string; error?: string }) {
  return (
    <View className="mb-4">
      <Text className="mb-2 text-sm font-medium text-slate-700">{label}</Text>
      <TextInput
        className="min-h-14 rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-900 focus:border-brand-700"
        placeholderTextColor="#81776E"
        selectionColor="#1A593B"
        {...props}
      />
      {error ? <Text className="mt-1 text-sm text-red-600">{error}</Text> : null}
    </View>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <View className="flex-1 items-center justify-center gap-3 p-8">
      <ActivityIndicator color="#1A593B" size="large" />
      <Text className="text-slate-500">{label}</Text>
    </View>
  );
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <View className="flex-1 items-center justify-center rounded-3xl border border-brand-100 bg-white p-10">
      <View className="mb-4 h-12 w-12 items-center justify-center rounded-2xl bg-brand-50">
        <Text className="text-2xl font-black text-brand-700">i</Text>
      </View>
      <Text className="text-lg font-bold text-slate-800">{title}</Text>
      <Text className="mt-2 text-center text-slate-500">{message}</Text>
    </View>
  );
}

export function ErrorState({ message, retry }: { message: string; retry(): void }) {
  return (
    <View className="flex-1 items-center justify-center p-8">
      <Text className="mb-4 text-center text-red-700">{message}</Text>
      <Button title="Try again" onPress={retry} />
    </View>
  );
}
