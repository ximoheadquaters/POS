import { Redirect, Tabs } from 'expo-router';
import { Text, View, type ColorValue } from 'react-native';
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
    <Text style={{ color, fontSize: 18, fontWeight: '800' }}>{value}</Text>
  </View>
);

export default function TabLayout() {
  const { session, currentUser } = useSession();
  const branch = useBranchStore((state) => state.activeBranch);
  if (!session) return <Redirect href="/(auth)/login" />;
  if (!currentUser || !branch) return <Redirect href="/branch-select" />;
  const dashboardEnabled = currentUser.modules.includes('dashboard');
  const posEnabled = currentUser.modules.includes('pos');
  const inventoryEnabled = currentUser.modules.includes('inventory');
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#1A593B',
        tabBarInactiveTintColor: '#4C4239',
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
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
          title: 'Home',
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
          href: posEnabled ? undefined : null,
          tabBarIcon: (props) => <Icon value={'\u2630'} {...props} />,
        }}
      />
      <Tabs.Screen
        name="inventory"
        options={{
          title: 'Stock',
          href: inventoryEnabled ? undefined : null,
          tabBarIcon: (props) => <Icon value={'\u25A6'} {...props} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarIcon: (props) => <Icon value={'\u2022\u2022\u2022'} {...props} />,
        }}
      />
    </Tabs>
  );
}
