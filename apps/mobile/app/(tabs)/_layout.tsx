import { Redirect, Tabs } from 'expo-router';
import { Text, View, type ColorValue } from 'react-native';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { useSession } from '@/providers/session';
import { useBranchStore } from '@/store/branch';

const Icon = ({
  value,
  color,
  focused,
}: {
  value: string;
  color: ColorValue;
  focused: boolean;
}) => (
  <View
    style={{
      width: 30,
      height: 26,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 10,
      backgroundColor: focused ? '#DDEBE4' : 'transparent',
    }}
  >
    <Text style={{ color, fontSize: 18, fontWeight: '600' }}>{value}</Text>
  </View>
);

export default function TabLayout() {
  const { session, currentUser } = useSession();
  const branch = useBranchStore((state) => state.activeBranch);
  if (!session) return <Redirect href="/(auth)/login" />;
  if (!currentUser || !branch) return <Redirect href="/branch-select" />;
  const dashboardEnabled =
    currentUser.modules.includes('dashboard') || currentUser.modules.includes('reports');
  const posEnabled = currentUser.modules.includes('pos');
  return (
    <AppSidebarProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: '#1A593B',
          tabBarInactiveTintColor: '#4C4239',
          tabBarHideOnKeyboard: true,
          tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
          tabBarStyle: {
            height: 72,
            paddingTop: 7,
            paddingBottom: 9,
            backgroundColor: '#FFFFFF',
            borderTopColor: '#DDEBE4',
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Dashboard',
            href: dashboardEnabled ? undefined : null,
            tabBarIcon: (props) => <Icon value={'\u2302'} {...props} />,
          }}
        />
        <Tabs.Screen
          name="pos"
          options={{
            title: 'POS',
            href: posEnabled ? undefined : null,
            tabBarIcon: (props) => <Icon value="+" {...props} />,
          }}
        />
        <Tabs.Screen
          name="sales"
          options={{
            title: 'Sales',
            href: null,
            tabBarIcon: (props) => <Icon value="$" {...props} />,
          }}
        />
        <Tabs.Screen
          name="inventory"
          options={{
            title: 'Stock',
            href: null,
            tabBarIcon: (props) => <Icon value={'\u25A6'} {...props} />,
          }}
        />
        <Tabs.Screen
          name="more"
          options={{
            title: 'More',
            href: null,
            tabBarIcon: (props) => <Icon value={'\u2630'} {...props} />,
          }}
        />
      </Tabs>
    </AppSidebarProvider>
  );
}
