import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import type { Href } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import type { ModuleCode, Permission } from '@ximo/shared';
import { api } from '@/lib/api';
import { Button, Field, Header, Screen } from '@/components/ui';
import Feather from '@expo/vector-icons/Feather';
import { useSession } from '@/providers/session';
import { useBranchStore } from '@/store/branch';
import { useShiftStore } from '@/store/shift';
import { useIosAlert, appAlert } from '@/providers/ios-alert';

const links: Array<{
  title: string;
  subtitle: string;
  icon: string;
  href: Href;
  module?: ModuleCode;
  permission?: Permission;
}> = [
  {
    title: 'Products',
    subtitle: 'Catalog, categories and prices',
    icon: 'box',
    href: '/products',
    module: 'products',
  },
  {
    title: 'Customers',
    subtitle: 'Contacts and purchase history',
    icon: 'users',
    href: '/customers',
    module: 'customers',
  },
  {
    title: 'Registers & shifts',
    subtitle: 'Open, close and count cash',
    icon: 'credit-card',
    href: '/registers',
    module: 'registers',
  },
  {
    title: 'Returns',
    subtitle: 'Find a sale and process a return',
    icon: 'rotate-ccw',
    href: '/returns',
    module: 'returns',
  },
  {
    title: 'Purchasing',
    subtitle: 'Suppliers, purchase orders and receiving',
    icon: 'truck',
    href: '/purchasing',
    module: 'purchasing',
    permission: 'purchasing:read',
  },
  {
    title: 'Stock transfers',
    subtitle: 'Move inventory items between branches',
    icon: 'sliders',
    href: '/stock-transfers' as Href,
    module: 'stock_transfers',
  },
  {
    title: 'Promotions & Combos',
    subtitle: 'Combo deals, BOGO offers, and discounts',
    icon: 'tag',
    href: '/promotions' as Href,
    module: 'promotions',
  },
  {
    title: 'Reports',
    subtitle: 'KPIs, sales, inventory, purchasing, profit and cash',
    icon: 'trending-up',
    href: '/reports',
    module: 'reports',
  },
  {
    title: 'Users & roles',
    subtitle: 'Access and branch assignments',
    icon: 'user-check',
    href: '/users',
    permission: 'users:read',
  },
  {
    title: 'Audit Logs',
    subtitle: 'Security activity trail of sales, returns, shifts, and access',
    icon: 'shield',
    href: '/audit' as Href,
    permission: 'audit:read',
  },
  {
    title: 'Organization',
    subtitle: 'Business identity, plan and tenant overview',
    icon: 'briefcase',
    href: '/organization' as Href,
    permission: 'organization:read',
  },
  {
    title: 'Branches',
    subtitle: 'Locations, branch status and staff assignments',
    icon: 'map-pin',
    href: '/branches' as Href,
    permission: 'branches:read',
  },
  {
    title: 'Settings',
    subtitle: 'Business, tax and receipt options',
    icon: 'settings',
    href: '/settings',
    permission: 'settings:manage',
  },
  {
    title: 'Hardware devices',
    subtitle: 'Scanners, printers, drawers and terminals',
    icon: 'cpu',
    href: '/hardware' as Href,
    permission: 'settings:manage',
  },
  {
    title: 'Offline synchronization',
    subtitle: 'Saved data, pending sales and sync errors',
    icon: 'wifi-off',
    href: '/offline-sync' as Href,
  },
];

export default function MoreScreen() {
  const { currentUser, refreshUser, signOut } = useSession();
  const { showAlert } = useIosAlert();
  const [refreshingAccess, setRefreshingAccess] = useState(false);
  const branch = useBranchStore((state) => state.activeBranch);
  const clearBranch = useBranchStore((state) => state.clear);
  const shift = useShiftStore((state) => state.activeShift);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [newPin, setNewPin] = useState('');

  const visibleLinks = useMemo(() => {
    return links.filter((item) => {
      const hasModule = !item.module || currentUser?.modules.includes(item.module);
      const hasPermission = !item.permission || currentUser?.permissions.includes(item.permission);
      return hasModule && hasPermission;
    });
  }, [currentUser]);

  const changePinMutation = useMutation({
    mutationFn: (pin: string) =>
      api('/users/me/pin', {
        method: 'PATCH',
        body: JSON.stringify({ pin }),
      }),
    onSuccess: () => {
      setPinModalVisible(false);
      setNewPin('');
      showAlert({
        title: 'Security PIN Updated',
        message: 'Your Security PIN has been saved successfully.',
        type: 'success',
      });
    },
    onError: (error) =>
      showAlert({
        title: 'Could Not Update PIN',
        message: error.message,
        type: 'error',
      }),
  });

  return (
    <Screen>
      <Header title="More" subtitle={`${currentUser?.displayName} · ${currentUser?.role}`} />
      <FlatList
        data={visibleLinks}
        keyExtractor={(item) => item.title}
        contentContainerClassName="p-4 gap-3 pb-10"
        ListHeaderComponent={
          <View className="mb-2 rounded-2xl bg-brand-700 p-5">
            <Text className="text-xs font-bold uppercase tracking-wider text-brand-100">
              Current branch
            </Text>
            <Text className="mt-1 text-xl font-black text-white">{branch?.name}</Text>
            <Text className="mt-1 text-sm text-brand-100">
              {shift ? `Active shift · ${shift.registerName}` : 'No active shift'}
            </Text>
            <View className="mt-4 flex-row gap-3">
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  if (shift) {
                    appAlert(
                      'Close your shift first',
                      'Finish and close the active register shift before changing branches.',
                    );
                    return;
                  }
                  void clearBranch().then(() => router.replace('/branch-select'));
                }}
                className="flex-1 min-h-11 items-center justify-center rounded-xl bg-white px-4 active:opacity-80"
              >
                <Text className="font-bold text-brand-700">Switch branch</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setPinModalVisible(true)}
                className="flex-1 min-h-11 items-center justify-center rounded-xl bg-brand-800 px-4 active:opacity-80 border border-brand-500"
              >
                <Text className="font-bold text-white">🔑 Change PIN</Text>
              </Pressable>
            </View>
          </View>
        }
        ListFooterComponent={
          <View className="mt-3 gap-3">
            <Button
              title="Change Security PIN"
              variant="secondary"
              onPress={() => setPinModalVisible(true)}
            />
            <Button
              title={refreshingAccess ? 'Refreshing access…' : 'Refresh modules & access'}
              variant="secondary"
              disabled={refreshingAccess}
              onPress={() => {
                setRefreshingAccess(true);
                void refreshUser()
                  .then(() => appAlert('Access refreshed', 'Module changes are now applied.'))
                  .catch((error) => appAlert('Could not refresh access', error.message))
                  .finally(() => setRefreshingAccess(false));
              }}
            />
            <Button
              title="Sign out"
              variant="secondary"
              onPress={() =>
                appAlert('Sign out?', 'You will need your password to sign in again.', [
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
        renderItem={({ item }) => {
          const isDisabled = Boolean(item.module && !currentUser?.modules.includes(item.module));
          return (
            <Pressable
              accessibilityRole="button"
              className="min-h-16 flex-row items-center rounded-2xl border border-slate-100 bg-white p-3.5 mb-2 active:bg-slate-50 shadow-xs"
              onPress={() => router.push(item.href)}
            >
              <View className="mr-3.5 h-10 w-10 items-center justify-center rounded-xl bg-slate-100">
                <Feather name={item.icon as any} size={18} color="#1A593B" />
              </View>
              <View className="flex-1">
                <View className="flex-row items-center gap-2">
                  <Text className="text-sm font-bold text-slate-900">{item.title}</Text>
                  {isDisabled ? (
                    <View className="flex-row items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 border border-amber-200/80">
                      <Feather name="lock" size={10} color="#B45309" />
                      <Text className="text-[10px] font-semibold text-amber-800">Locked</Text>
                    </View>
                  ) : null}
                </View>
                <Text className="mt-0.5 text-xs text-slate-500">{item.subtitle}</Text>
              </View>
              <Feather name="chevron-right" size={18} color="#94A3B8" />
            </Pressable>
          );
        }}
      />
      <Modal
        visible={pinModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPinModalVisible(false)}
      >
        <View className="flex-1 bg-black/60 items-center justify-center p-4">
          <View className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
            <Text className="text-center text-lg font-bold text-slate-900">
              Change Security PIN
            </Text>
            <Text className="mt-1 text-center text-xs text-slate-500">
              Set a 4 to 8 digit Security PIN used to authorize manager overrides and refunds.
            </Text>

            <View className="mt-4">
              <TextInput
                value={newPin}
                onChangeText={setNewPin}
                secureTextEntry
                keyboardType="number-pad"
                maxLength={8}
                placeholder="New PIN (e.g. 1234)"
                placeholderTextColor="#94A3B8"
                autoFocus
                className="min-h-12 rounded-xl border border-slate-300 text-center text-xl font-bold tracking-widest bg-slate-50 text-slate-900"
              />
            </View>

            <View className="mt-5 flex-row gap-3">
              <View className="flex-1">
                <Button
                  title="Cancel"
                  variant="secondary"
                  onPress={() => {
                    setPinModalVisible(false);
                    setNewPin('');
                  }}
                />
              </View>
              <View className="flex-1">
                <Button
                  title={changePinMutation.isPending ? 'Saving…' : 'Save PIN'}
                  disabled={newPin.length < 4 || changePinMutation.isPending}
                  onPress={() => changePinMutation.mutate(newPin)}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
