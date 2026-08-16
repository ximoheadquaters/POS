import { useEffect, useMemo, useState } from 'react';
import { appAlert } from '@/providers/ios-alert';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Permission } from '@ximo/shared';
import { api } from '@/lib/api';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import {
  PERMISSION_GROUPS,
  roleDescription,
  togglePermission,
  type AccessMatrix,
} from '@/lib/access-control';

function RoleDetailContent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['access-matrix'],
    queryFn: () => api<AccessMatrix>('/users/roles'),
  });
  const role = useMemo(
    () => query.data?.roles.find((item) => item.id === id),
    [id, query.data?.roles],
  );
  const [selected, setSelected] = useState<Permission[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!role || dirty) return;
    setSelected(role.permissions);
  }, [dirty, role]);

  const descriptions = useMemo(
    () =>
      new Map(
        query.data?.permissions.map((permission) => [permission.code, permission.description]),
      ),
    [query.data?.permissions],
  );

  const mutation = useMutation({
    mutationFn: () =>
      api(`/users/roles/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ permissions: selected }),
      }),
    onSuccess: async () => {
      setDirty(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['access-matrix'] }),
        queryClient.invalidateQueries({ queryKey: ['users'] }),
      ]);
      appAlert('Permissions updated', 'Users with this role will receive the new access rules.');
    },
    onError: (error) => appAlert('Could not update permissions', error.message),
  });

  if (query.isLoading) {
    return (
      <Screen>
        <Header
          title="Role permissions"
          subtitle="Loading role access"
          showBack
          backLabel="Users"
          fallbackHref="/users"
        />
        <LoadingState />
      </Screen>
    );
  }

  if (query.isError || !role) {
    return (
      <Screen>
        <Header
          title="Role permissions"
          subtitle="Role access"
          showBack
          backLabel="Users"
          fallbackHref="/users"
        />
        <ErrorState
          message={query.isError ? query.error.message : 'This role could not be found.'}
          retry={() => void query.refetch()}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Header
        title={role.name}
        subtitle={`${role.userCount} ${role.userCount === 1 ? 'user' : 'users'} assigned`}
        showBack
        backLabel="Users"
        fallbackHref="/users"
      />
      <ScrollView contentContainerClassName="px-4 py-6 pb-12">
        <View className="w-full max-w-3xl self-center">
          <View className="mb-6 flex-row items-start rounded-3xl border border-slate-200 bg-white p-5">
            <View className="mr-4 h-12 w-12 items-center justify-center rounded-2xl bg-brand-50">
              <Feather name={role.code === 'owner' ? 'key' : 'shield'} size={21} color="#1A593B" />
            </View>
            <View className="flex-1">
              <View className="flex-row flex-wrap items-center">
                <Text className="text-lg font-semibold text-slate-950">{role.name}</Text>
                {!role.editable ? (
                  <View className="ml-2 rounded-full bg-slate-100 px-2 py-1">
                    <Text className="text-[10px] font-medium uppercase text-slate-600">Locked</Text>
                  </View>
                ) : null}
              </View>
              <Text className="mt-1 text-sm leading-5 text-slate-500">
                {roleDescription(role.code)}
              </Text>
              {!role.editable ? (
                <Text className="mt-3 text-xs leading-5 text-slate-500">
                  Owner and administrator roles keep full access to prevent account lockout.
                </Text>
              ) : (
                <Text className="mt-3 text-xs leading-5 text-slate-500">
                  Changes apply to every {role.name.toLowerCase()} after their access refreshes or
                  they sign in again.
                </Text>
              )}
            </View>
          </View>

          {role.editable ? (
            <View className="mb-5 flex-row gap-2">
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setSelected(query.data?.permissions.map((item) => item.code) ?? []);
                  setDirty(true);
                }}
                className="min-h-11 flex-1 items-center justify-center rounded-xl border border-brand-200 bg-brand-50 px-3"
              >
                <Text className="text-sm font-medium text-brand-800">Select all</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setSelected([]);
                  setDirty(true);
                }}
                className="min-h-11 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-3"
              >
                <Text className="text-sm font-medium text-slate-700">Clear all</Text>
              </Pressable>
            </View>
          ) : null}

          <View className="gap-5">
            {PERMISSION_GROUPS.map((group) => (
              <View
                key={group.title}
                className="overflow-hidden rounded-3xl border border-slate-200 bg-white"
              >
                <View className="border-b border-slate-100 p-5">
                  <Text className="font-semibold text-slate-950">{group.title}</Text>
                  <Text className="mt-1 text-sm leading-5 text-slate-500">{group.description}</Text>
                </View>
                {group.permissions.map((permission, index) => {
                  const enabled = selected.includes(permission);
                  return (
                    <Pressable
                      key={permission}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: enabled, disabled: !role.editable }}
                      disabled={!role.editable}
                      onPress={() => {
                        setSelected((current) => togglePermission(current, permission));
                        setDirty(true);
                      }}
                      className={`min-h-16 flex-row items-center px-5 py-3 ${
                        index ? 'border-t border-slate-100' : ''
                      } ${role.editable ? 'active:bg-brand-50' : ''}`}
                    >
                      <View
                        className={`mr-3 h-6 w-6 items-center justify-center rounded-lg border ${
                          enabled ? 'border-brand-700 bg-brand-700' : 'border-slate-300 bg-white'
                        }`}
                      >
                        {enabled ? <Feather name="check" size={14} color="#FFFFFF" /> : null}
                      </View>
                      <View className="flex-1">
                        <Text className="text-sm font-medium text-slate-900">
                          {descriptions.get(permission) ?? permission}
                        </Text>
                        <Text className="mt-1 text-xs text-slate-500">{permission}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>

          {role.editable ? (
            <View className="mt-6 rounded-3xl border border-slate-200 bg-white p-4">
              <Pressable
                accessibilityRole="button"
                disabled={!dirty || mutation.isPending}
                onPress={() => mutation.mutate()}
                className={`min-h-14 flex-row items-center justify-center rounded-xl bg-brand-700 px-5 ${
                  !dirty || mutation.isPending ? 'opacity-50' : 'active:opacity-80'
                }`}
              >
                <Feather name="save" size={17} color="#FFFFFF" />
                <Text className="ml-2 font-semibold text-white">
                  {mutation.isPending ? 'Saving…' : 'Save permissions'}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

export default function RoleDetailScreen() {
  return (
    <AppSidebarProvider>
      <RoleDetailContent />
    </AppSidebarProvider>
  );
}
