import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { router, type Href } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { RoleCode } from '@ximo/shared';
import { api } from '@/lib/api';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { EmptyState, ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import { roleDescription, roleLabel, type AccessMatrix } from '@/lib/access-control';
import { useSession } from '@/providers/session';

interface User {
  id: string;
  displayName: string;
  email: string;
  role: RoleCode;
  isActive: boolean;
  branches: Array<{ id: string; name: string; code?: string }>;
}

function UsersContent() {
  const { currentUser } = useSession();
  const [tab, setTab] = useState<'employees' | 'roles'>('employees');
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') });
  const accessQuery = useQuery({
    queryKey: ['access-matrix'],
    queryFn: () => api<AccessMatrix>('/users/roles'),
  });
  const canManage = currentUser?.permissions.includes('users:manage') ?? false;
  const users = usersQuery.data ?? [];
  const activeCount = users.filter((user) => user.isActive).length;

  return (
    <Screen>
      <Header
        title="Users, roles & permissions"
        subtitle="Employee accounts, branch access, and what each role can do."
        showBack
        backLabel="More"
        fallbackHref="/(tabs)/more"
        action={
          canManage ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add employee"
              onPress={() => router.push('/employee-form' as Href)}
              className="min-h-11 flex-row items-center justify-center rounded-xl bg-brand-700 px-4 active:opacity-80"
            >
              <Feather name="user-plus" size={16} color="#FFFFFF" />
              <Text className="ml-2 font-medium text-white">Add employee</Text>
            </Pressable>
          ) : null
        }
      />

      <ScrollView contentContainerClassName="px-4 py-6 pb-12">
        <View className="w-full max-w-4xl self-center">
          <View className="mb-6 flex-row gap-3">
            {[
              ['Employees', String(users.length), 'users' as const],
              ['Active', String(activeCount), 'user-check' as const],
              ['Roles', String(accessQuery.data?.roles.length ?? 0), 'shield' as const],
            ].map(([label, value, icon]) => (
              <View
                key={label}
                className="min-h-24 flex-1 rounded-2xl border border-slate-200 bg-white p-4"
              >
                <Feather
                  name={icon as 'users' | 'user-check' | 'shield'}
                  size={17}
                  color="#1A593B"
                />
                <Text className="mt-2 text-xl font-semibold text-slate-950">{value}</Text>
                <Text className="mt-1 text-xs text-slate-500">{label}</Text>
              </View>
            ))}
          </View>

          <View className="mb-6 flex-row rounded-xl bg-slate-200/70 p-1">
            {[
              ['employees', 'Employees', 'users'],
              ['roles', 'Roles & permissions', 'shield'],
            ].map(([value, label, icon]) => {
              const selected = tab === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  onPress={() => setTab(value as 'employees' | 'roles')}
                  className={`min-h-11 flex-1 flex-row items-center justify-center rounded-lg ${
                    selected ? 'bg-white' : ''
                  }`}
                >
                  <Feather
                    name={icon as 'users' | 'shield'}
                    size={16}
                    color={selected ? '#1A593B' : '#64748B'}
                  />
                  <Text
                    className={`ml-2 text-sm font-medium ${
                      selected ? 'text-brand-800' : 'text-slate-600'
                    }`}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {tab === 'employees' ? (
            usersQuery.isLoading ? (
              <View className="min-h-64 rounded-3xl border border-slate-200 bg-white">
                <LoadingState label="Loading employees…" />
              </View>
            ) : usersQuery.isError ? (
              <View className="min-h-64 rounded-3xl border border-slate-200 bg-white">
                <ErrorState
                  message={usersQuery.error.message}
                  retry={() => void usersQuery.refetch()}
                />
              </View>
            ) : users.length ? (
              <View className="gap-3">
                {users.map((user) => {
                  const isCurrentUser = user.id === currentUser?.id;
                  return (
                    <Pressable
                      key={user.id}
                      accessibilityRole="button"
                      onPress={() =>
                        router.push({
                          pathname: '/user/[id]',
                          params: { id: user.id },
                        })
                      }
                      className="min-h-24 flex-row items-center rounded-2xl border border-slate-200 bg-white p-4 active:border-brand-300 active:bg-brand-50"
                    >
                      <View className="mr-4 h-12 w-12 items-center justify-center rounded-full bg-brand-50">
                        <Text className="font-semibold text-brand-800">
                          {user.displayName
                            .split(/\s+/)
                            .slice(0, 2)
                            .map((part) => part[0])
                            .join('')
                            .toUpperCase()}
                        </Text>
                      </View>
                      <View className="flex-1">
                        <View className="flex-row flex-wrap items-center">
                          <Text className="font-semibold text-slate-950">{user.displayName}</Text>
                          {isCurrentUser ? (
                            <View className="ml-2 rounded-full bg-slate-100 px-2 py-1">
                              <Text className="text-[10px] font-medium uppercase text-slate-600">
                                You
                              </Text>
                            </View>
                          ) : null}
                          {!user.isActive ? (
                            <View className="ml-2 rounded-full bg-red-50 px-2 py-1">
                              <Text className="text-[10px] font-medium uppercase text-red-700">
                                Inactive
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        <Text className="mt-1 text-sm text-slate-500">{user.email}</Text>
                        <Text className="mt-2 text-xs text-slate-500">
                          {roleLabel(user.role)} ·{' '}
                          {user.branches.length
                            ? user.branches.map((branch) => branch.name).join(', ')
                            : 'All branches'}
                        </Text>
                      </View>
                      <Feather name="chevron-right" size={20} color="#64748B" />
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <EmptyState
                title="No employees"
                message={
                  canManage ? 'Add the first employee to get started.' : 'No employees were found.'
                }
              />
            )
          ) : accessQuery.isLoading ? (
            <View className="min-h-64 rounded-3xl border border-slate-200 bg-white">
              <LoadingState label="Loading roles…" />
            </View>
          ) : accessQuery.isError ? (
            <View className="min-h-64 rounded-3xl border border-slate-200 bg-white">
              <ErrorState
                message={accessQuery.error.message}
                retry={() => void accessQuery.refetch()}
              />
            </View>
          ) : (
            <View className="gap-3">
              {accessQuery.data?.roles.map((role) => (
                <Pressable
                  key={role.id}
                  accessibilityRole="button"
                  onPress={() =>
                    router.push({
                      pathname: '/role/[id]',
                      params: { id: role.id },
                    })
                  }
                  className="min-h-28 flex-row items-center rounded-2xl border border-slate-200 bg-white p-4 active:border-brand-300 active:bg-brand-50"
                >
                  <View className="mr-4 h-12 w-12 items-center justify-center rounded-2xl bg-brand-50">
                    <Feather
                      name={role.code === 'owner' ? 'key' : 'shield'}
                      size={20}
                      color="#1A593B"
                    />
                  </View>
                  <View className="flex-1">
                    <View className="flex-row flex-wrap items-center">
                      <Text className="font-semibold text-slate-950">{role.name}</Text>
                      {!role.editable ? (
                        <View className="ml-2 rounded-full bg-slate-100 px-2 py-1">
                          <Text className="text-[10px] font-medium uppercase text-slate-600">
                            Locked
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <Text className="mt-1 text-sm leading-5 text-slate-500">
                      {roleDescription(role.code)}
                    </Text>
                    <Text className="mt-2 text-xs text-slate-500">
                      {role.userCount} {role.userCount === 1 ? 'user' : 'users'} ·{' '}
                      {role.permissions.length} permissions
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={20} color="#64748B" />
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

export default function UsersScreen() {
  return (
    <AppSidebarProvider>
      <UsersContent />
    </AppSidebarProvider>
  );
}
