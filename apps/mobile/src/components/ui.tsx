import { useState, type PropsWithChildren, type ReactNode } from 'react';
import { router, type Href } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
  useWindowDimensions,
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
  const { width } = useWindowDimensions();
  const phone = width < 640;
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace(fallbackHref);
  };
  return (
    <View
      className={`flex-row flex-wrap items-center gap-y-2 border-b border-slate-200 bg-white ${
        phone ? 'px-3 py-2.5' : 'px-4 py-3'
      }`}
    >
      {sidebar?.compact ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Navigation Menu"
          hitSlop={8}
          onPress={sidebar.openMenu}
          className="mr-2 h-10 w-10 items-center justify-center rounded-xl bg-slate-100 active:bg-slate-200"
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
          className="mr-2 min-h-10 flex-row items-center justify-center rounded-xl border border-slate-200/80 bg-slate-50 px-3 active:bg-slate-100"
        >
          <Feather name="chevron-left" size={18} color="#1A593B" />
          {!phone ? <Text className="ml-1 text-xs font-bold text-brand-800">{backLabel}</Text> : null}
        </Pressable>
      ) : null}
      <View className="min-w-[110px] flex-1">
        <Text numberOfLines={1} className={`${phone ? 'text-lg' : 'text-xl'} font-bold tracking-tight text-slate-900`}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} className="mt-0.5 text-xs font-medium text-slate-500">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action ? <View className={phone ? 'ml-2' : 'ml-3'}>{action}</View> : null}
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
  const textStyle = variant === 'secondary' ? 'text-slate-800 font-bold' : 'text-white font-bold';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      className={`min-h-11 items-center justify-center rounded-xl px-4 ${bgStyle} ${
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
  className,
  textAlignVertical,
  ...props
}: TextInputProps & { label: string; error?: string }) {
  const isParagraph = Boolean(props.multiline);

  return (
    <View className="mb-3">
      {label ? <Text className="mb-1.5 text-sm font-medium text-slate-600">{label}</Text> : null}
      <TextInput
        className={`min-h-11 rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 focus:border-brand-600 focus:bg-white ${
          isParagraph ? 'pt-4 pb-3' : ''
        } ${className ?? ''}`}
        placeholderTextColor="#94A3B8"
        selectionColor="#1A593B"
        textAlignVertical={textAlignVertical ?? (isParagraph ? 'top' : undefined)}
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
    <View className="flex-1 items-center justify-center rounded-2xl border border-slate-200 bg-white p-6">
      <View className="mb-3 h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
        <Feather name="inbox" size={22} color="#64748B" />
      </View>
      <Text className="text-base font-bold text-slate-900">{title}</Text>
      <Text className="mt-1 max-w-xs text-center text-xs text-slate-500 leading-relaxed">
        {message}
      </Text>
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

export function OfflineState({
  title = 'POS server unavailable',
  message = 'Reconnect and try again.',
  retry,
}: {
  title?: string;
  message?: string;
  retry?(): void;
}) {
  return (
    <View className="flex-1 items-center justify-center p-6">
      <View className="w-full max-w-sm items-center rounded-2xl border border-slate-200 bg-white p-6">
        <View className="mb-3 h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
          <Feather name="wifi-off" size={22} color="#64748B" />
        </View>
        <Text className="text-center text-base font-semibold text-slate-900">{title}</Text>
        <Text className="mt-1 max-w-xs text-center text-sm leading-5 text-slate-500">{message}</Text>
        {retry ? (
          <View className="mt-5 w-full">
            <Button title="Try again" variant="secondary" onPress={retry} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** Keep children mounted so disclosure never resets forms or triggers new requests. */
export function ExpandableSection({
  title,
  summary,
  children,
  defaultExpanded = false,
}: PropsWithChildren<{
  title: string;
  summary?: string;
  defaultExpanded?: boolean;
}>) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const { width } = useWindowDimensions();
  const phone = width < 640;
  return (
    <View
      className={`${phone ? 'mb-2 rounded-xl' : 'mb-3 rounded-2xl'} overflow-hidden border border-slate-200 bg-white`}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        className={`min-h-11 flex-row items-center gap-3 hover:bg-slate-50 active:bg-slate-100 ${
          phone ? 'px-3 py-2.5' : 'px-4 py-3'
        }`}
      >
        <View className="flex-1">
          <Text className="text-sm font-semibold text-slate-900">{title}</Text>
          {summary ? <Text className="mt-1 text-xs text-slate-600">{summary}</Text> : null}
        </View>
        <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color="#637169" />
      </Pressable>
      <View
        style={{ display: expanded ? 'flex' : 'none' }}
        className={`border-t border-slate-100 ${phone ? 'p-3' : 'p-4'}`}
      >
        {children}
      </View>
    </View>
  );
}

export function ShiftTabs({ active }: { active: 'current' | 'history' }) {
  return (
    <View className="flex-row gap-2 border-b border-slate-200 bg-white px-4 py-2">
      {(
        [
          { key: 'current', label: 'Current shift', href: '/registers' },
          { key: 'history', label: 'Shift history', href: '/shift-reports' },
        ] as const
      ).map((tab) => (
        <Pressable
          key={tab.key}
          accessibilityRole="tab"
          accessibilityState={{ selected: active === tab.key }}
          onPress={() => {
            if (active !== tab.key) router.push(tab.href);
          }}
          className={`min-h-11 flex-1 items-center justify-center rounded-xl px-3 ${active === tab.key ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
        >
          <Text
            className={`text-sm font-semibold ${active === tab.key ? 'text-brand-800' : 'text-slate-600'}`}
          >
            {tab.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
