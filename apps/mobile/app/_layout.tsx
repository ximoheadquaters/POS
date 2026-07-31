import '../src/global.css';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider } from '@/providers/session';
import { OfflineProvider } from '@/providers/offline';
import { IosAlertProvider } from '@/providers/ios-alert';

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1 },
          mutations: { retry: 0 },
        },
      }),
  );
  useEffect(() => {
    if (Platform.OS !== 'web' || !('serviceWorker' in navigator)) return;
    if (__DEV__) {
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
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: '#F8F7F5' },
                  animation: 'slide_from_right',
                }}
              >
                <Stack.Screen name="index" />
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="accept-invitation" />
                <Stack.Screen name="branch-select" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="hardware" />
                <Stack.Screen name="cart" options={{ presentation: 'modal' }} />
                <Stack.Screen name="payment" options={{ presentation: 'modal' }} />
              </Stack>
            </IosAlertProvider>
          </OfflineProvider>
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
