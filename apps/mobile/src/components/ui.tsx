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
import Feather from '@expo/vector-icons/Feather';
import { useAppSidebar } from './app-sidebar';

export function Screen({ children }: PropsWithChildren) {
  return <SafeAreaView className="flex-1 bg-[#F8F9FA]">{children}</SafeAreaView>;
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
  const sidebar = useAppSidebar();
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace(fallbackHref);
  };
  return (
    <View className="flex-row items-center border-b border-slate-200/70 bg-white/90 px-4 py-3.5 backdrop-blur-md">
      {sidebar?.compact ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open navigation menu"
          hitSlop={8}
          onPress={sidebar.openMenu}
          className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-slate-100 active:bg-slate-200"
        >
          <Feather name="menu" size={19} color="#1A593B" />
        </Pressable>
      ) : null}
      {showBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Go back to ${backLabel}`}
          hitSlop={8}
          onPress={goBack}
          className="mr-3 min-h-10 flex-row items-center justify-center rounded-xl border border-slate-200/80 bg-slate-50 px-3 active:bg-slate-100"
        >
          <Feather name="chevron-left" size={18} color="#1A593B" />
          <Text className="ml-1 text-xs font-bold text-brand-800">{backLabel}</Text>
        </Pressable>
      ) : null}
      <View className="flex-1">
        <Text numberOfLines={1} className="text-xl font-bold tracking-tight text-slate-900">
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} className="mt-0.5 text-xs font-medium text-slate-500">
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
  const bgStyle =
    variant === 'primary'
      ? 'bg-brand-700 active:bg-brand-800'
      : variant === 'danger'
        ? 'bg-red-600 active:bg-red-700'
        : 'bg-slate-100 border border-slate-200/80 active:bg-slate-200';
  const textStyle =
    variant === 'secondary' ? 'text-slate-800 font-bold' : 'text-white font-bold';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      className={`min-h-11 items-center justify-center rounded-xl px-4 transition-all ${bgStyle} ${
        disabled ? 'opacity-40' : ''
      }`}
      {...props}
    >
      <Text className={`text-sm ${textStyle}`}>{title}</Text>
    </Pressable>
  );
}

export function Field({
  label,
  error,
  ...props
}: TextInputProps & { label: string; error?: string }) {
  return (
    <View className="mb-3">
      {label ? <Text className="mb-1.5 text-xs font-semibold text-slate-600 uppercase tracking-wider">{label}</Text> : null}
      <TextInput
        className="min-h-11 rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 focus:border-brand-600 focus:bg-white"
        placeholderTextColor="#94A3B8"
        selectionColor="#1A593B"
        {...props}
      />
      {error ? <Text className="mt-1 text-xs font-medium text-red-600">{error}</Text> : null}
    </View>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <View className="flex-1 items-center justify-center gap-3 p-8">
      <ActivityIndicator color="#1A593B" size="small" />
      <Text className="text-xs font-medium text-slate-500">{label}</Text>
    </View>
  );
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <View className="flex-1 items-center justify-center rounded-3xl border border-slate-200/70 bg-white p-8 shadow-xs">
      <View className="mb-3 h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
        <Feather name="inbox" size={22} color="#64748B" />
      </View>
      <Text className="text-base font-bold text-slate-900">{title}</Text>
      <Text className="mt-1 max-w-xs text-center text-xs text-slate-500 leading-relaxed">{message}</Text>
    </View>
  );
}

export function ErrorState({ message, retry }: { message: string; retry(): void }) {
  return (
    <View className="flex-1 items-center justify-center p-8">
      <View className="mb-3 h-12 w-12 items-center justify-center rounded-2xl bg-red-50">
        <Feather name="alert-circle" size={24} color="#DC2626" />
      </View>
      <Text className="mb-4 text-center text-sm font-medium text-red-700 max-w-xs">{message}</Text>
      <Button title="Try again" variant="secondary" onPress={retry} />
    </View>
  );
}
