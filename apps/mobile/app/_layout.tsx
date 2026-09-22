import '../src/global.css';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { Stack, usePathname } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider } from '@/providers/session';
import { OfflineProvider } from '@/providers/offline';
import { IosAlertProvider } from '@/providers/ios-alert';
import { useBranchStore } from '@/store/branch';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { QuickActionBar } from '@/components/quick-access';
import { useSession } from '@/providers/session';
import { ApiError } from '@/lib/api';

function WorkspaceNavigator() {
  const pathname = usePathname();
  const { session, currentUser } = useSession();
  const activeBranch = useBranchStore((state) => state.activeBranch);
  const excludedPrefixes = [
    '/branch-select',
    '/login',
    '/accept-invitation',
    '/change-password',
    '/reports',
    '/audit',
    '/organization',
    '/branches',
    '/users',
    '/user',
    '/role',
    '/settings',
    '/hardware',
    '/cart',
    '/payment',
    '/receipt',
    '/sale/',
    '/return/',
  ];
  const showQuickActions =
    Boolean(session && currentUser && activeBranch) &&
    !excludedPrefixes.some((prefix) => pathname.startsWith(prefix));

  return (
    <View className="flex-1">
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#F8F7F5' },
          animation: Platform.OS === 'web' ? 'none' : 'slide_from_right',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="accept-invitation" />
        <Stack.Screen name="change-password" />
        <Stack.Screen name="branch-select" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="hardware" />
        <Stack.Screen name="cart" options={{ presentation: 'modal' }} />
        <Stack.Screen name="payment" options={{ presentation: 'modal' }} />
      </Stack>
      {showQuickActions ? <QuickActionBar /> : null}
    </View>
  );
}

export default function RootLayout() {
  const hydrateBranch = useBranchStore((state) => state.hydrate);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: (failureCount, error) =>
              !(error instanceof ApiError && error.code === 'OFFLINE') && failureCount < 1,
          },
          mutations: { retry: 0 },
        },
      }),
  );
  useEffect(() => {
    void hydrateBranch();
  }, [hydrateBranch]);
  useEffect(() => {
    if (Platform.OS !== 'web' || !('serviceWorker' in navigator)) return;
    const onInviteRoute =
      typeof globalThis.location !== 'undefined' &&
      globalThis.location.pathname.includes('/accept-invitation');
    if (__DEV__ || onInviteRoute) {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(registrations.map((registration) => registration.unregister())),
        );
      return;
    }
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <OfflineProvider>
            <IosAlertProvider>
              <StatusBar style="dark" backgroundColor="#FFFFFF" />
              <AppSidebarProvider>
                <WorkspaceNavigator />
              </AppSidebarProvider>
            </IosAlertProvider>
          </OfflineProvider>
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
