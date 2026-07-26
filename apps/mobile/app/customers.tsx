import { useMemo, useState } from 'react';
import { Alert, FlatList, Text, TextInput, View } from 'react-native';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button, EmptyState, Header, Screen } from '@/components/ui';

interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
}

export default function CustomersScreen() {
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const client = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: ['customers', search],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api<Customer[]>(
        `/customers?page=${pageParam}&pageSize=30&search=${encodeURIComponent(search)}`,
      ),
    getNextPageParam: (last, pages) => (last.length === 30 ? pages.length + 1 : undefined),
  });
  const create = useMutation({
    mutationFn: () => api('/customers', { method: 'POST', body: JSON.stringify({ name }) }),
    onSuccess: async () => {
      setName('');
      await client.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (error) => Alert.alert('Could not create customer', error.message),
  });
  const customers = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);
  return (
    <Screen>
      <Header title="Customers" showBack backLabel="More" fallbackHref="/(tabs)/more" />
      <View className="gap-3 border-b border-slate-200 bg-white p-4">
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search customers"
          placeholderTextColor="#81776E"
          selectionColor="#1A593B"
          className="min-h-14 rounded-xl bg-slate-100 px-4"
        />
        <View className="flex-row gap-2">
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="New customer name"
            placeholderTextColor="#81776E"
            selectionColor="#1A593B"
            className="min-h-14 flex-1 rounded-xl border border-slate-200 px-4"
          />
          <Button
            title="Add"
            disabled={name.trim().length < 1 || create.isPending}
            onPress={() => create.mutate()}
          />
        </View>
      </View>
      <FlatList
        data={customers}
        keyExtractor={(item) => item.id}
        contentContainerClassName="p-4 gap-2"
        ListEmptyComponent={
          <EmptyState title="No customers" message="Walk-in sales do not require a customer." />
        }
        renderItem={({ item }) => (
          <View className="rounded-2xl bg-white p-4">
            <Text className="font-bold text-slate-900">{item.name}</Text>
            <Text className="mt-1 text-sm text-slate-500">
              {item.phone || item.email || 'No contact details'}
            </Text>
          </View>
        )}
      />
    </Screen>
  );
}
