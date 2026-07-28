import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { liveDataQueryOptions } from '@/lib/live-data';
import { Button, EmptyState, ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import { getHardwareDriver } from '@/hardware/registry';
import { useSession } from '@/providers/session';
import { cartTotal, useCartStore, type CartProduct } from '@/store/cart';
import { useBranchStore } from '@/store/branch';
import { useShiftStore } from '@/store/shift';

export default function PosScreen() {
  const { currentUser } = useSession();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [scanPending, setScanPending] = useState(false);
  const items = useCartStore((state) => state.items);
  const add = useCartStore((state) => state.add);
  const syncProducts = useCartStore((state) => state.syncProducts);
  const branch = useBranchStore((state) => state.activeBranch);
  const activeShift = useShiftStore((state) => state.activeShift);
  const hydrateShift = useShiftStore((state) => state.hydrate);

  useEffect(() => void hydrateShift(), [hydrateShift]);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useInfiniteQuery({
    queryKey: ['pos-products', branch?.id, debounced],
    initialPageParam: 1,
    enabled: Boolean(branch),
    queryFn: ({ pageParam }) =>
      api<CartProduct[]>(
        `/products?branchId=${branch!.id}&page=${pageParam}&pageSize=30${debounced ? `&search=${encodeURIComponent(debounced)}` : ''}`,
      ),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === 30 ? allPages.length + 1 : undefined,
    ...liveDataQueryOptions,
  });
  const products = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);
  const cartQuantities = useMemo(
    () => new Map(items.map((item) => [item.product.id, item.quantity])),
    [items],
  );
  const scannerEnabled = currentUser?.modules.includes('barcode_scanner') ?? false;
  const customerDisplayEnabled = currentUser?.modules.includes('customer_display') ?? false;

  useEffect(() => {
    syncProducts(products);
  }, [products, syncProducts]);

  useEffect(() => {
    if (!customerDisplayEnabled || !currentUser) return;
    const display = getHardwareDriver('customer_display');
    void display
      .status()
      .then((status) => {
        if (status.state !== 'ready') return;
        return display.show({
          itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
          total: cartTotal(items),
          currency: currentUser.organization.currency,
        });
      })
      .catch(() => undefined);
  }, [customerDisplayEnabled, currentUser, items]);

  const submitBarcode = async () => {
    const barcode = search.trim();
    if (!scannerEnabled || !barcode || scanPending) return;
    setScanPending(true);
    try {
      const exact = await api<CartProduct | null>(
        `/products/lookup?code=${encodeURIComponent(barcode)}&branchId=${branch!.id}`,
      );
      if (!exact) {
        if (currentUser?.permissions.includes('products:manage')) {
          Alert.alert('New product', `Barcode ${barcode} is not in the catalogue. Add it now?`, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Add product',
              onPress: () =>
                router.push({
                  pathname: '/product-form',
                  params: { barcode, addToCart: '1' },
                }),
            },
          ]);
        } else {
          Alert.alert(
            'Product not found',
            'Ask an owner or manager to add this barcode before selling it.',
          );
        }
        return;
      }
      if (exact.status === 'inactive') {
        Alert.alert('Product is inactive', 'Ask an owner or manager to reactivate this product.');
        return;
      }
      if (
        exact.availableQuantity !== null &&
        exact.availableQuantity !== undefined &&
        exact.availableQuantity <= 0
      ) {
        Alert.alert(
          'Product is sold out',
          'Stock changed on another register. Refreshing products.',
        );
        await query.refetch();
        return;
      }
      add(exact);
      setSearch('');
      setDebounced('');
    } catch (error) {
      Alert.alert(
        'Could not scan product',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setScanPending(false);
    }
  };

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
          returnKeyType={scannerEnabled ? 'done' : 'search'}
          onSubmitEditing={() => void submitBarcode()}
          blurOnSubmit={false}
        />
        {scannerEnabled ? (
          <View className="mt-2 flex-row items-center justify-between gap-3">
            <Text className="flex-1 text-xs text-brand-700">
              Scanner ready · scan a barcode or type it, then press Enter.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Scan product with camera"
              onPress={() =>
                router.push({
                  pathname: '/product-scan',
                  params: { addToCart: '1' },
                })
              }
              className="min-h-11 items-center justify-center rounded-xl bg-brand-50 px-3 active:bg-brand-100"
            >
              <Text className="text-sm font-bold text-brand-700">Use camera</Text>
            </Pressable>
          </View>
        ) : null}
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
              accessibilityState={{
                disabled:
                  item.availableQuantity !== null &&
                  item.availableQuantity !== undefined &&
                  (item.availableQuantity <= 0 ||
                    (cartQuantities.get(item.id) ?? 0) >= item.availableQuantity),
              }}
              disabled={
                item.availableQuantity !== null &&
                item.availableQuantity !== undefined &&
                (item.availableQuantity <= 0 ||
                  (cartQuantities.get(item.id) ?? 0) >= item.availableQuantity)
              }
              className={`min-h-20 flex-row items-center rounded-2xl border border-slate-100 bg-white p-4 active:border-brand-300 active:bg-brand-50 ${
                item.availableQuantity !== null &&
                item.availableQuantity !== undefined &&
                (item.availableQuantity <= 0 ||
                  (cartQuantities.get(item.id) ?? 0) >= item.availableQuantity)
                  ? 'opacity-50'
                  : ''
              }`}
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
                  {item.availableQuantity === null || item.availableQuantity === undefined
                    ? cartQuantities.get(item.id)
                      ? `${cartQuantities.get(item.id)} in cart`
                      : '+ Add'
                    : item.availableQuantity <= 0
                      ? 'Sold out'
                      : `${item.availableQuantity} in stock${
                          cartQuantities.get(item.id)
                            ? ` · ${cartQuantities.get(item.id)} in cart`
                            : ''
                        }`}
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
