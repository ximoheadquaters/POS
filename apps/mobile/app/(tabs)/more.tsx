import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { Href } from 'expo-router';
import type { ModuleCode } from '@ximo/shared';
import { Button, Header, Screen } from '@/components/ui';
import { useSession } from '@/providers/session';
import { useBranchStore } from '@/store/branch';
import { useShiftStore } from '@/store/shift';

const links: Array<{
  title: string;
  subtitle: string;
  symbol: string;
  href: Href;
  module?: ModuleCode;
}> = [
  {
    title: 'Products',
    subtitle: 'Catalog, categories and prices',
    symbol: 'P',
    href: '/products',
    module: 'products',
  },
  {
    title: 'Customers',
    subtitle: 'Contacts and purchase history',
    symbol: 'C',
    href: '/customers',
    module: 'customers',
  },
  {
    title: 'Registers & shifts',
    subtitle: 'Open, close and count cash',
    symbol: 'R',
    href: '/registers',
    module: 'registers',
  },
  {
    title: 'Returns',
    subtitle: 'Find a sale and process a return',
    symbol: '↩',
    href: '/returns',
    module: 'returns',
  },
  {
    title: 'Reports',
    subtitle: 'Sales and gross profit analytics',
    symbol: 'A',
    href: '/reports',
    module: 'reports',
  },
  {
    title: 'Users & roles',
    subtitle: 'Access and branch assignments',
    symbol: 'U',
    href: '/users',
  },
  {
    title: 'Settings',
    subtitle: 'Business, tax and receipt options',
    symbol: 'S',
    href: '/settings',
  },
];

export default function MoreScreen() {
  const { currentUser, signOut } = useSession();
  const branch = useBranchStore((state) => state.activeBranch);
  const clearBranch = useBranchStore((state) => state.clear);
  const shift = useShiftStore((state) => state.activeShift);
  const visible = links.filter(
    (item) => !item.module || currentUser?.modules.includes(item.module),
  );
  return (
    <Screen>
      <Header title="More" subtitle={`${currentUser?.displayName} · ${currentUser?.role}`} />
      <FlatList
        data={visible}
        keyExtractor={(item) => item.title}
        contentContainerClassName="p-4 gap-3 pb-10"
        ListHeaderComponent={
          <View className="mb-2 rounded-3xl bg-brand-700 p-5">
            <Text className="text-xs font-bold uppercase tracking-wider text-brand-100">
              Current branch
            </Text>
            <Text className="mt-1 text-xl font-black text-white">{branch?.name}</Text>
            <Text className="mt-1 text-sm text-brand-100">
              {shift ? `Active shift · ${shift.registerName}` : 'No active shift'}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (shift) {
                  Alert.alert(
                    'Close your shift first',
                    'Finish and close the active register shift before changing branches.',
                  );
                  return;
                }
                void clearBranch().then(() => router.replace('/branch-select'));
              }}
              className="mt-4 min-h-11 items-center justify-center rounded-xl bg-white px-4 active:opacity-80"
            >
              <Text className="font-bold text-brand-700">Switch branch</Text>
            </Pressable>
          </View>
        }
        ListFooterComponent={
          <View className="mt-3">
            <Button
              title="Sign out"
              variant="secondary"
              onPress={() =>
                Alert.alert('Sign out?', 'You will need your password to sign in again.', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Sign out',
                    style: 'destructive',
                    onPress: () => {
                      void clearBranch().then(signOut);
                    },
                  },
                ])
              }
            />
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            className="min-h-20 flex-row items-center rounded-2xl border border-slate-100 bg-white px-4 active:border-brand-300 active:bg-brand-50"
            onPress={() => router.push(item.href)}
          >
            <View className="mr-4 h-11 w-11 items-center justify-center rounded-xl bg-brand-50">
              <Text className="text-base font-black text-brand-700">{item.symbol}</Text>
            </View>
            <View className="flex-1">
              <Text className="text-base font-bold text-slate-900">{item.title}</Text>
              <Text className="mt-1 text-sm text-slate-500">{item.subtitle}</Text>
            </View>
            <Text className="text-2xl font-bold text-brand-700">{'\u203A'}</Text>
          </Pressable>
        )}
      />
    </Screen>
  );
}
