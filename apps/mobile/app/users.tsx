import { FlatList, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { EmptyState, ErrorState, Header, LoadingState, Screen } from '@/components/ui';

interface User {
  id: string;
  displayName: string;
  email: string;
  role: string;
  isActive: boolean;
  branches: Array<{ id: string; name: string }>;
}

export default function UsersScreen() {
  const query = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') });
  return (
    <Screen>
      <Header
        title="Users & roles"
        subtitle="Role changes and branch assignments are audited."
        showBack
        backLabel="More"
        fallbackHref="/(tabs)/more"
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
            <EmptyState title="No users" message="Create users securely through Supabase Auth." />
          }
          renderItem={({ item }) => (
            <View className="rounded-2xl bg-white p-4">
              <View className="flex-row justify-between">
                <Text className="font-bold text-slate-900">{item.displayName}</Text>
                <Text className="rounded-lg bg-brand-50 px-2 py-1 text-xs font-bold uppercase text-brand-700">
                  {item.role.replace('_', ' ')}
                </Text>
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
