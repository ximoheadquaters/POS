import { FlatList, Pressable, Text, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { EmptyState, ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import { useSession } from '@/providers/session';

interface User {
  id: string;
  displayName: string;
  email: string;
  role: string;
  isActive: boolean;
  branches: Array<{ id: string; name: string }>;
}

export default function UsersScreen() {
  const { currentUser } = useSession();
  const query = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') });
  const canManage = currentUser?.permissions.includes('users:manage') ?? false;
  return (
    <Screen>
      <Header
        title="Users & roles"
        subtitle="Employee accounts, roles, and branch access."
        showBack
        backLabel="More"
        fallbackHref="/(tabs)/more"
        action={
          canManage ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add employee"
              onPress={() => router.push('/employee-form' as Href)}
              className="min-h-11 items-center justify-center rounded-xl bg-brand-700 px-4 active:opacity-80"
            >
              <Text className="font-bold text-white">+ Add</Text>
            </Pressable>
          ) : null
        }
      />
      {query.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState message={query.error.message} retry={() => void query.refetch()} />
      ) : (
        <FlatList
          data={query.data}
          keyExtractor={(item) => item.id}
          contentContainerClassName="p-4 gap-3"
          ListEmptyComponent={
            <EmptyState
              title="No employees"
              message={canManage ? 'Use Add to create the first employee.' : 'No employees found.'}
            />
          }
          renderItem={({ item }) => (
            <View className="rounded-2xl border border-slate-100 bg-white p-4">
              <View className="flex-row justify-between">
                <Text className="font-bold text-slate-900">{item.displayName}</Text>
                <View className="items-end gap-1">
                  <Text className="rounded-lg bg-brand-50 px-2 py-1 text-xs font-bold uppercase text-brand-700">
                    {item.role.replace('_', ' ')}
                  </Text>
                  {!item.isActive ? (
                    <Text className="text-xs font-bold text-red-700">Inactive</Text>
                  ) : null}
                </View>
              </View>
              <Text className="mt-1 text-sm text-slate-500">{item.email}</Text>
              <Text className="mt-3 text-sm text-slate-600">
                {item.branches.length
                  ? item.branches.map((branch) => branch.name).join(', ')
                  : 'All branches for elevated roles'}
              </Text>
            </View>
          )}
        />
      )}
    </Screen>
  );
}
