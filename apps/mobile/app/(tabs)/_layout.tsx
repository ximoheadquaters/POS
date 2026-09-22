import { useEffect } from 'react';
import { Redirect, Tabs } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useSession } from '@/providers/session';
import { useBranchStore } from '@/store/branch';

export default function TabLayout() {
  const { session, currentUser, loading } = useSession();
  const branch = useBranchStore((state) => state.activeBranch);
  const hydrated = useBranchStore((state) => state.hydrated);
  const hydrate = useBranchStore((state) => state.hydrate);

  useEffect(() => {
    if (!hydrated) {
      void hydrate();
    }
  }, [hydrated, hydrate]);

  if (loading || !hydrated) {
    return (
      <View className="flex-1 items-center justify-center bg-brand-700">
        <ActivityIndicator color="#FFFFFF" size="large" />
      </View>
    );
  }

  if (!session) return <Redirect href="/(auth)/login" />;
  if (
    !currentUser ||
    !branch ||
    !currentUser.branches.some((authorizedBranch) => authorizedBranch.id === branch.id)
  ) {
    return <Redirect href="/branch-select" />;
  }
  const dashboardEnabled =
    currentUser.modules.includes('dashboard') || currentUser.modules.includes('reports');
  const posEnabled = currentUser.modules.includes('pos');
  return (
    <Tabs
        screenOptions={{
          headerShown: false,
          tabBarHideOnKeyboard: true,
          tabBarStyle: { display: 'none' },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Dashboard',
            href: dashboardEnabled ? undefined : null,
          }}
        />
        <Tabs.Screen
          name="pos"
          options={{
            title: 'POS',
            href: posEnabled ? undefined : null,
          }}
        />
        <Tabs.Screen
          name="sales"
          options={{
            title: 'Sales',
            href: null,
          }}
        />
        <Tabs.Screen
          name="inventory"
          options={{
            title: 'Stock',
            href: null,
          }}
        />
        <Tabs.Screen
          name="more"
          options={{
            title: 'More',
            href: null,
          }}
        />
      </Tabs>
  );
}
