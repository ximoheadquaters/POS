import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { useSession } from '@/providers/session';
import { EmptyState, ErrorState, Header, LoadingState, Screen } from '@/components/ui';

interface Product {
  id: string;
  name: string;
  sku: string;
  sellingPrice: string;
  status: string;
  categoryName?: string;
}

export default function ProductsScreen() {
  const [search, setSearch] = useState('');
  const { currentUser } = useSession();
  const query = useInfiniteQuery({
    queryKey: ['products', search],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api<Product[]>(
        `/products?page=${pageParam}&pageSize=30${search ? `&search=${encodeURIComponent(search)}` : ''}`,
      ),
    getNextPageParam: (last, pages) => (last.length === 30 ? pages.length + 1 : undefined),
  });
  const products = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);
  return (
    <Screen>
      <Header
        title="Products"
        showBack
        backLabel="More"
        fallbackHref="/(tabs)/more"
        action={
          currentUser?.permissions.includes('products:manage') ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add product"
              className="rounded-xl bg-brand-700 px-4 py-3"
              onPress={() => router.push('/product-form')}
            >
              <Text className="font-bold text-white">Add</Text>
            </Pressable>
          ) : null
        }
      />
      <View className="bg-white p-4">
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search products"
          placeholderTextColor="#81776E"
          selectionColor="#1A593B"
          className="min-h-14 rounded-xl bg-slate-100 px-4"
        />
      </View>
      {query.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState message={query.error.message} retry={() => void query.refetch()} />
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => item.id}
          contentContainerClassName="p-4 gap-2"
          ListEmptyComponent={
            <EmptyState title="No products" message="Add the first product to begin." />
          }
          renderItem={({ item }) => (
            <View className="flex-row items-center rounded-2xl border border-slate-100 bg-white p-4">
              <View className="flex-1">
                <Text className="font-bold text-slate-900">{item.name}</Text>
                <Text className="mt-1 text-xs text-slate-500">
                  {item.sku} · {item.categoryName ?? 'Uncategorized'}
                </Text>
              </View>
              <Text className="font-black text-brand-700">{formatMoney(item.sellingPrice)}</Text>
            </View>
          )}
        />
      )}
    </Screen>
  );
}
