import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RoleCode } from '@ximo/shared';
import { api } from '@/lib/api';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import { roleLabel, type AccessMatrix } from '@/lib/access-control';
import { useSession } from '@/providers/session';
import { useIosAlert } from '@/providers/ios-alert';

interface UserDetail {
  id: string;
  displayName: string;
  email: string;
  role: RoleCode;
  isActive: boolean;
  branches: Array<{ id: string; name: string; code: string }>;
}

function UserDetailContent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentUser } = useSession();
  const { showAlert } = useIosAlert();
  const queryClient = useQueryClient();
  const userQuery = useQuery({
    queryKey: ['user', id],
    queryFn: () => api<UserDetail>(`/users/${id}`),
  });
  const accessQuery = useQuery({
    queryKey: ['access-matrix'],
    queryFn: () => api<AccessMatrix>('/users/roles'),
  });
  const [selectedRole, setSelectedRole] = useState<RoleCode>('cashier');
  const [selectedBranches, setSelectedBranches] = useState<string[]>([]);
  const [isActive, setIsActive] = useState(true);
  const [pin, setPin] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!userQuery.data || dirty) return;
    setSelectedRole(userQuery.data.role);
    setSelectedBranches(userQuery.data.branches.map((branch) => branch.id));
    setIsActive(userQuery.data.isActive);
  }, [dirty, userQuery.data]);

  const roleOptions = useMemo(
    () => accessQuery.data?.roles.filter((role) => role.assignable) ?? [],
    [accessQuery.data?.roles],
  );
  const isSelf = currentUser?.id === id;
  const targetIsEmployee =
    userQuery.data && ['manager', 'cashier', 'inventory_staff'].includes(userQuery.data.role);
  const canManage =
    Boolean(currentUser?.permissions.includes('users:manage')) &&
    !isSelf &&
    Boolean(targetIsEmployee) &&
    roleOptions.some((role) => role.code === userQuery.data?.role);
  const canEditPin = isSelf || canManage;

  const mutation = useMutation({
    mutationFn: () =>
      api(`/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          role: selectedRole,
          isActive,
          branchIds: selectedBranches,
          ...(pin.trim() ? { pin: pin.trim() } : {}),
        }),
      }),
    onSuccess: async () => {
      setDirty(false);
      setPin('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['users'] }),
        queryClient.invalidateQueries({ queryKey: ['user', id] }),
        queryClient.invalidateQueries({ queryKey: ['access-matrix'] }),
      ]);
      showAlert({
        title: 'Account Updated',
        message: 'Employee role, security PIN, and branch access were saved successfully.',
        type: 'success',
      });
    },
    onError: (error) =>
      showAlert({
        title: 'Update Failed',
        message: error.message,
        type: 'error',
      }),
  });

  const toggleBranch = (branchId: string) => {
    setSelectedBranches((current) =>
      current.includes(branchId)
        ? current.filter((selected) => selected !== branchId)
        : [...current, branchId],
    );
    setDirty(true);
  };

  if (userQuery.isLoading || accessQuery.isLoading) {
    return (
      <Screen>
        <Header
          title="Employee access"
          subtitle="Loading account"
          showBack
          backLabel="Users"
          fallbackHref="/users"
        />
        <LoadingState />
      </Screen>
    );
  }

  if (userQuery.isError || accessQuery.isError || !userQuery.data) {
    const message = userQuery.isError
      ? userQuery.error.message
      : accessQuery.isError
        ? accessQuery.error.message
        : 'This employee could not be found.';
    return (
      <Screen>
        <Header
          title="Employee access"
          subtitle="Account details"
          showBack
          backLabel="Users"
          fallbackHref="/users"
        />
        <ErrorState
          message={message}
          retry={() => {
            void userQuery.refetch();
            void accessQuery.refetch();
          }}
        />
      </Screen>
    );
  }

  const user = userQuery.data;
  const initials = user.displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  return (
    <Screen>
      <Header
        title="Employee access"
        subtitle="Role, account status, and branch assignments."
        showBack
        backLabel="Users"
        fallbackHref="/users"
      />
      <ScrollView contentContainerClassName="px-4 py-6 pb-12">
        <View className="w-full max-w-3xl self-center">
          <View className="mb-6 flex-row items-center rounded-3xl border border-slate-200 bg-white p-5">
            <View className="mr-4 h-14 w-14 items-center justify-center rounded-full bg-brand-50">
              <Text className="text-lg font-semibold text-brand-800">{initials}</Text>
            </View>
            <View className="flex-1">
              <View className="flex-row flex-wrap items-center">
                <Text className="text-lg font-semibold text-slate-950">{user.displayName}</Text>
                {isSelf ? (
                  <View className="ml-2 rounded-full bg-slate-100 px-2 py-1">
                    <Text className="text-[10px] font-medium uppercase text-slate-600">
                      Your account
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text className="mt-1 text-sm text-slate-500">{user.email}</Text>
              <Text className="mt-2 text-xs text-slate-500">
                Current role: {roleLabel(user.role)}
              </Text>
            </View>
          </View>

          {!canManage ? (
            <View className="mb-6 flex-row items-start rounded-2xl bg-slate-100 p-4">
              <Feather name="lock" size={17} color="#64748B" />
              <Text className="ml-2 flex-1 text-sm leading-5 text-slate-600">
                {isSelf
                  ? 'For safety, another administrator must change your account access.'
                  : 'Your role cannot modify this account.'}
              </Text>
            </View>
          ) : null}

          <Text className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
            Role
          </Text>
          <View className="mb-7 gap-3">
            {(canManage
              ? roleOptions
              : (accessQuery.data?.roles.filter((role) => role.code === user.role) ?? [])
            ).map((role) => {
              const selected = selectedRole === role.code;
              return (
                <Pressable
                  key={role.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected, disabled: !canManage }}
                  disabled={!canManage}
                  onPress={() => {
                    setSelectedRole(role.code);
                    setDirty(true);
                  }}
                  className={`min-h-20 flex-row items-center rounded-2xl border p-4 ${
                    selected ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-white'
                  }`}
                >
                  <View
                    className={`mr-3 h-6 w-6 items-center justify-center rounded-full border-2 ${
                      selected ? 'border-brand-700' : 'border-slate-300'
                    }`}
                  >
                    {selected ? <View className="h-3 w-3 rounded-full bg-brand-700" /> : null}
                  </View>
                  <View className="flex-1">
                    <Text className="font-medium text-slate-950">{role.name}</Text>
                    <Text className="mt-1 text-xs text-slate-500">
                      {role.permissions.length} permissions
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <Text className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
            Branch access
          </Text>
          <View className="mb-7 overflow-hidden rounded-3xl border border-slate-200 bg-white">
            <View className="border-b border-slate-100 p-5">
              <Text className="font-semibold text-slate-950">Where can this employee work?</Text>
              <Text className="mt-1 text-sm leading-5 text-slate-500">
                Select at least one branch. Sales and inventory access remain limited to these
                locations.
              </Text>
            </View>
            {currentUser?.branches.map((branch, index) => {
              const selected = selectedBranches.includes(branch.id);
              return (
                <Pressable
                  key={branch.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected, disabled: !canManage }}
                  disabled={!canManage}
                  onPress={() => toggleBranch(branch.id)}
                  className={`min-h-16 flex-row items-center px-5 py-3 ${
                    index ? 'border-t border-slate-100' : ''
                  } ${canManage ? 'active:bg-brand-50' : ''}`}
                >
                  <View
                    className={`mr-3 h-6 w-6 items-center justify-center rounded-lg border ${
                      selected ? 'border-brand-700 bg-brand-700' : 'border-slate-300 bg-white'
                    }`}
                  >
                    {selected ? <Feather name="check" size={14} color="#FFFFFF" /> : null}
                  </View>
                  <View className="flex-1">
                    <Text className="font-medium text-slate-900">{branch.name}</Text>
                    <Text className="mt-1 text-xs text-slate-500">{branch.code}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {selectedRole !== 'cashier' ? (
            <>
              <Text className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
                Security PIN (Manager Authorization Override)
              </Text>
              <View className="mb-7 rounded-3xl border border-slate-200 bg-white p-5">
                <Text className="font-semibold text-slate-950">Set or Update Security PIN</Text>
                <Text className="mt-1 text-xs leading-4 text-slate-500">
                  Enter a 4 to 8 digit Security PIN used by this manager/staff member to authorize refunds and overrides.
                </Text>
                <View className="mt-3">
                  <TextInput
                    value={pin}
                    onChangeText={(val) => {
                      setPin(val);
                      setDirty(true);
                    }}
                    editable={canEditPin}
                    keyboardType="number-pad"
                    maxLength={8}
                    placeholder="Enter new 4-digit PIN (e.g. 1234)"
                    placeholderTextColor="#94A3B8"
                    style={{ outline: 'none' }}
                    className="min-h-12 rounded-xl border border-slate-200 bg-slate-50 px-4 text-base font-bold tracking-widest text-slate-900 focus:border-brand-600 focus:ring-2 focus:ring-brand-200"
                  />
                </View>
              </View>
            </>
          ) : null}

          <Text className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
            Account status
          </Text>
          <View className="mb-7 flex-row items-center rounded-3xl border border-slate-200 bg-white p-5">
            <View
              className={`mr-3 h-10 w-10 items-center justify-center rounded-xl ${
                isActive ? 'bg-emerald-50' : 'bg-red-50'
              }`}
            >
              <Feather
                name={isActive ? 'user-check' : 'user-x'}
                size={18}
                color={isActive ? '#047857' : '#B91C1C'}
              />
            </View>
            <View className="flex-1 pr-3">
              <Text className="font-medium text-slate-950">
                {isActive ? 'Account active' : 'Account inactive'}
              </Text>
              <Text className="mt-1 text-xs leading-4 text-slate-500">
                {isActive
                  ? 'The employee can sign in and use assigned features.'
                  : 'The employee cannot sign in. Sales history is preserved.'}
              </Text>
            </View>
            <Switch
              disabled={!canManage}
              value={isActive}
              onValueChange={(value) => {
                setIsActive(value);
                setDirty(true);
              }}
              trackColor={{ false: '#FECACA', true: '#A7D2BC' }}
              thumbColor={isActive ? '#1A593B' : '#B91C1C'}
            />
          </View>

          {canManage || isSelf ? (
            <View className="rounded-3xl border border-slate-200 bg-white p-4">
              {!selectedBranches.length ? (
                <Text className="mb-3 text-center text-sm text-red-600">
                  Select at least one branch before saving.
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={!dirty || mutation.isPending || !selectedBranches.length}
                onPress={() => mutation.mutate()}
                className={`min-h-14 flex-row items-center justify-center rounded-xl bg-brand-700 px-5 ${
                  !dirty || mutation.isPending || !selectedBranches.length
                    ? 'opacity-50'
                    : 'active:opacity-80'
                }`}
              >
                <Feather name="save" size={17} color="#FFFFFF" />
                <Text className="ml-2 font-semibold text-white">
                  {mutation.isPending ? 'Saving…' : 'Save employee access'}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

export default function UserDetailScreen() {
  return (
    <AppSidebarProvider>
      <UserDetailContent />
    </AppSidebarProvider>
  );
}
