import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { Button, EmptyState, ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import { cartTotal, useCartStore, type CartProduct } from '@/store/cart';
import { useShiftStore } from '@/store/shift';

export default function PosScreen() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const items = useCartStore((state) => state.items);
  const add = useCartStore((state) => state.add);
  const activeShift = useShiftStore((state) => state.activeShift);
  const hydrateShift = useShiftStore((state) => state.hydrate);

  useEffect(() => void hydrateShift(), [hydrateShift]);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useInfiniteQuery({
    queryKey: ['pos-products', debounced],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api<CartProduct[]>(
        `/products?page=${pageParam}&pageSize=30${debounced ? `&search=${encodeURIComponent(debounced)}` : ''}`,
      ),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === 30 ? allPages.length + 1 : undefined,
  });
  const products = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);
  const cartQuantities = useMemo(
    () => new Map(items.map((item) => [item.product.id, item.quantity])),
    [items],
  );

  return (
    <Screen>
      <Header
        title="Point of sale"
        subtitle={activeShift ? activeShift.registerName : 'No open shift'}
      />
      <View className="border-b border-slate-200 bg-white p-4">
        {!activeShift ? (
          <View className="mb-3 rounded-xl bg-brand-50 p-3">
            <Text className="font-bold text-brand-900">A shift is required to complete a sale</Text>
            <Text className="mt-1 text-sm text-slate-600">
              You can browse products now, then open a register shift before checkout.
            </Text>
          </View>
        ) : null}
        <TextInput
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          placeholder="Search name, SKU, or scan barcode"
          className="min-h-12 rounded-xl bg-slate-100 px-4 text-base"
          placeholderTextColor="#81776E"
          selectionColor="#1A593B"
        />
      </View>
      {query.isLoading ? (
        <LoadingState label="Loading products…" />
      ) : query.isError ? (
        <ErrorState message={query.error.message} retry={() => void query.refetch()} />
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => item.id}
          onEndReached={() => query.hasNextPage && void query.fetchNextPage()}
          onEndReachedThreshold={0.4}
          contentContainerClassName="p-4 gap-3 pb-32"
          ListEmptyComponent={<EmptyState title="No products" message="Try a different search." />}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Add ${item.name} to cart`}
              className="min-h-20 flex-row items-center rounded-2xl border border-slate-100 bg-white p-4 active:border-brand-300 active:bg-brand-50"
              onPress={() => add(item)}
            >
              <View className="flex-1">
                <Text className="text-base font-bold text-slate-900">{item.name}</Text>
                <Text className="mt-1 text-xs text-slate-500">{item.sku}</Text>
              </View>
              <View className="items-end">
                <Text className="text-lg font-bold text-brand-700">
                  {formatMoney(item.sellingPrice)}
                </Text>
                <Text className="mt-1 text-xs font-bold text-brand-500">
                  {cartQuantities.get(item.id)
                    ? `${cartQuantities.get(item.id)} in cart`
                    : '+ Add'}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}
      <View className="absolute bottom-0 left-0 right-0 border-t border-brand-100 bg-white p-4">
        {activeShift ? (
          <Button
            title={`Cart · ${items.reduce((sum, item) => sum + item.quantity, 0)} items · ${formatMoney(cartTotal(items))}`}
            disabled={!items.length}
            onPress={() => router.push('/cart')}
          />
        ) : (
          <Button title="Open a shift to sell" onPress={() => router.push('/registers')} />
        )}
      </View>
    </Screen>
  );
}
