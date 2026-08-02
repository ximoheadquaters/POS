import Feather from '@expo/vector-icons/Feather';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { Button, ErrorState, Field, Header, LoadingState, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { liveDataQueryOptions } from '@/lib/live-data';
import { useBranchStore } from '@/store/branch';

interface InventoryProduct {
  id: string;
  productId: string;
  name: string;
  sku: string;
  unit: string;
  quantity: number;
  portioningEnabled?: boolean;
  portioningVariantId?: string | null;
  sealedQuantity?: number;
  openedQuantity?: number;
  containerName?: string | null;
  containerUnit?: string | null;
  containerUnitsPerBase?: number | null;
}

type AdjustmentDirection = 'add' | 'deduct';
type InventoryPool = 'shared' | 'sealed' | 'opened';

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function formatQuantity(value: number): string {
  return new Intl.NumberFormat('en-PH', { maximumFractionDigits: 3 }).format(value);
}

function StockAdjustmentContent() {
  const params = useLocalSearchParams<{
    productId?: string | string[];
    name?: string | string[];
    sku?: string | string[];
    unit?: string | string[];
    quantity?: string | string[];
    portioningEnabled?: string | string[];
    sealedQuantity?: string | string[];
    openedQuantity?: string | string[];
    containerName?: string | string[];
    containerUnit?: string | string[];
    containerUnitsPerBase?: string | string[];
  }>();
  const routeProductId = firstParam(params.productId);
  const routeName = firstParam(params.name);
  const routeSku = firstParam(params.sku);
  const routeUnit = firstParam(params.unit) || 'unit';
  const routeQuantity = Number(firstParam(params.quantity));
  const routePortioningEnabled = firstParam(params.portioningEnabled) === '1';
  const routeSealedQuantity = Number(firstParam(params.sealedQuantity));
  const routeOpenedQuantity = Number(firstParam(params.openedQuantity));
  const routeContainerUnitsPerBase = Number(firstParam(params.containerUnitsPerBase));
  const branch = useBranchStore((state) => state.activeBranch);
  const [search, setSearch] = useState(routeName);
  const deferredSearch = useDeferredValue(search.trim());
  const [isChoosingProduct, setIsChoosingProduct] = useState(!routeProductId);
  const [selectedProduct, setSelectedProduct] = useState<InventoryProduct | null>(() =>
    routeProductId && routeName
      ? {
          id: routeProductId,
          productId: routeProductId,
          name: routeName,
          sku: routeSku,
          unit: routeUnit,
          quantity: Number.isFinite(routeQuantity) ? routeQuantity : Number.NaN,
          portioningEnabled: routePortioningEnabled,
          sealedQuantity: Number.isFinite(routeSealedQuantity) ? routeSealedQuantity : 0,
          openedQuantity: Number.isFinite(routeOpenedQuantity) ? routeOpenedQuantity : 0,
          containerName: firstParam(params.containerName) || null,
          containerUnit: firstParam(params.containerUnit) || null,
          containerUnitsPerBase: Number.isFinite(routeContainerUnitsPerBase)
            ? routeContainerUnitsPerBase
            : null,
        }
      : null,
  );
  const [direction, setDirection] = useState<AdjustmentDirection>('deduct');
  const [pool, setPool] = useState<InventoryPool>(
    routePortioningEnabled ? 'sealed' : 'shared',
  );
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [containersToOpen, setContainersToOpen] = useState('1');
  const client = useQueryClient();

  const productsQuery = useQuery({
    queryKey: ['inventory-adjustment-products', branch?.id, deferredSearch],
    enabled: Boolean(branch),
    queryFn: () => {
      const query = new URLSearchParams({
        branchId: branch!.id,
        page: '1',
        pageSize: '30',
      });
      if (deferredSearch) query.set('search', deferredSearch);
      return api<InventoryProduct[]>(`/inventory?${query.toString()}`);
    },
    ...liveDataQueryOptions,
  });

  useEffect(() => {
    if (!selectedProduct || Number.isFinite(selectedProduct.quantity)) return;
    const current = productsQuery.data?.find(
      (product) => product.productId === selectedProduct.productId,
    );
    if (current) setSelectedProduct(current);
  }, [productsQuery.data, selectedProduct]);

  const numericQuantity = Number(quantity.replace(',', '.'));
  const quantityDelta =
    direction === 'deduct' ? -Math.abs(numericQuantity) : Math.abs(numericQuantity);
  const hasValidQuantity = Number.isFinite(numericQuantity) && numericQuantity > 0;
  const displayUnit =
    pool === 'sealed'
      ? selectedProduct?.containerUnit || selectedProduct?.containerName || 'container'
      : selectedProduct?.unit || 'unit';
  const currentPoolQuantity = selectedProduct
    ? pool === 'sealed'
      ? Number(selectedProduct.sealedQuantity ?? 0)
      : pool === 'opened'
        ? Number(selectedProduct.openedQuantity ?? 0)
        : selectedProduct.quantity
    : Number.NaN;
  const projectedQuantity =
    selectedProduct && Number.isFinite(currentPoolQuantity) && hasValidQuantity
      ? currentPoolQuantity + quantityDelta
      : null;

  const mutation = useMutation({
    mutationFn: () => {
      if (!branch || !selectedProduct) throw new Error('Select a product first');
      return api('/inventory/adjustments', {
        method: 'POST',
        body: JSON.stringify({
          branchId: branch.id,
          productId: selectedProduct.productId,
          quantityDelta,
          reason: reason.trim(),
          pool,
        }),
      });
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['inventory', branch?.id] }),
        client.invalidateQueries({ queryKey: ['inventory-adjustment-products', branch?.id] }),
      ]);
      router.replace('/(tabs)/inventory');
    },
    onError: (error) => Alert.alert('Adjustment failed', error.message),
  });

  const openContainers = useMutation({
    mutationFn: () => {
      if (!branch || !selectedProduct) throw new Error('Select a product first');
      return api<{
        quantity: number;
        sealedQuantity: number;
        openedQuantity: number;
      }>('/inventory/open-portions', {
        method: 'POST',
        body: JSON.stringify({
          branchId: branch.id,
          productId: selectedProduct.productId,
          containerQuantity: Number(containersToOpen),
          reason: 'Opened for portioning',
        }),
      });
    },
    onSuccess: async (state) => {
      setSelectedProduct((current) =>
        current
          ? {
              ...current,
              quantity: state.quantity,
              sealedQuantity: state.sealedQuantity,
              openedQuantity: state.openedQuantity,
            }
          : current,
      );
      setContainersToOpen('1');
      await Promise.all([
        client.invalidateQueries({ queryKey: ['inventory', branch?.id] }),
        client.invalidateQueries({ queryKey: ['inventory-adjustment-products', branch?.id] }),
      ]);
    },
    onError: (error) => Alert.alert('Could not open container', error.message),
  });

  const commonReasons = useMemo(
    () =>
      direction === 'deduct'
        ? ['Waste', 'Spillage', 'Staff consumption', 'Expired']
        : ['Stock found', 'Count correction', 'Opening stock'],
    [direction],
  );

  const selectProduct = (product: InventoryProduct) => {
    setSelectedProduct(product);
    setPool(product.portioningEnabled ? 'sealed' : 'shared');
    setSearch(product.name);
    setIsChoosingProduct(false);
    setQuantity('');
  };

  const changeDirection = (nextDirection: AdjustmentDirection) => {
    setDirection(nextDirection);
    setReason('');
  };

  const confirmAdjustment = () => {
    if (!selectedProduct || !hasValidQuantity) return;
    const action = direction === 'deduct' ? 'Deduct' : 'Add';
    const amount = `${formatQuantity(Math.abs(quantityDelta))} ${displayUnit}`;
    Alert.alert(
      `${action} stock?`,
      `${selectedProduct.name}\n${action} ${amount.toLowerCase()}\nReason: ${reason.trim()}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: action, style: direction === 'deduct' ? 'destructive' : 'default', onPress: () => mutation.mutate() },
      ],
    );
  };

  return (
    <Screen>
      <Header
        title="Stock adjustment"
        subtitle={selectedProduct ? `${selectedProduct.name} · ${branch?.name ?? ''}` : branch?.name}
        showBack
        backLabel="Inventory"
        fallbackHref="/(tabs)/inventory"
      />

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="p-4 pb-10">
        <View className="w-full max-w-3xl self-center gap-4">
          <View className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <View className="flex-row items-center border-b border-slate-100 p-4">
              <View className="h-10 w-10 items-center justify-center rounded-xl bg-brand-50">
                <Feather name="package" size={18} color="#1A593B" />
              </View>
              <View className="ml-3 flex-1">
                <Text className="text-sm font-semibold text-slate-900">Product to adjust</Text>
                <Text className="mt-0.5 text-xs text-slate-500">
                  Select the exact product from {branch?.name ?? 'this branch'}.
                </Text>
              </View>
            </View>

            {selectedProduct && !isChoosingProduct ? (
              <View className="flex-row items-center p-4">
                <View className="flex-1 pr-3">
                  <Text className="text-base font-semibold text-slate-900">
                    {selectedProduct.name}
                  </Text>
                  <Text className="mt-1 text-xs text-slate-500">
                    {selectedProduct.sku || 'No SKU'} · Inventory unit: {selectedProduct.unit}
                  </Text>
                  {Number.isFinite(selectedProduct.quantity) ? (
                    <Text className="mt-2 text-sm font-medium text-brand-700">
                      Current stock: {formatQuantity(selectedProduct.quantity)} {selectedProduct.unit}
                    </Text>
                  ) : null}
                  {selectedProduct.portioningEnabled ? (
                    <View className="mt-3 flex-row flex-wrap gap-2">
                      <View className="rounded-lg bg-amber-50 px-2.5 py-1.5">
                        <Text className="text-xs font-semibold text-amber-800">
                          {formatQuantity(Number(selectedProduct.sealedQuantity ?? 0))} sealed {selectedProduct.containerUnit || 'containers'}
                        </Text>
                      </View>
                      <View className="rounded-lg bg-brand-50 px-2.5 py-1.5">
                        <Text className="text-xs font-semibold text-brand-800">
                          {formatQuantity(Number(selectedProduct.openedQuantity ?? 0))} {selectedProduct.unit} opened
                        </Text>
                      </View>
                    </View>
                  ) : null}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Change product"
                  onPress={() => {
                    setSearch('');
                    setIsChoosingProduct(true);
                  }}
                  className="min-h-10 items-center justify-center rounded-xl bg-brand-50 px-4 active:bg-brand-100"
                >
                  <Text className="text-xs font-semibold text-brand-700">Change</Text>
                </Pressable>
              </View>
            ) : (
              <View className="p-4">
                <Field
                  label="Search product"
                  placeholder="Search by product name or SKU"
                  value={search}
                  onChangeText={setSearch}
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                {productsQuery.isLoading ? (
                  <View className="h-32">
                    <LoadingState label="Loading branch inventory…" />
                  </View>
                ) : productsQuery.isError ? (
                  <View className="min-h-36">
                    <ErrorState
                      message={productsQuery.error.message}
                      retry={() => void productsQuery.refetch()}
                    />
                  </View>
                ) : productsQuery.data?.length ? (
                  <View className="overflow-hidden rounded-xl border border-slate-200">
                    {productsQuery.data.map((product, index) => (
                      <Pressable
                        key={product.id}
                        accessibilityRole="button"
                        accessibilityLabel={`Select ${product.name}`}
                        onPress={() => selectProduct(product)}
                        className={`flex-row items-center p-3 active:bg-brand-50 ${
                          index > 0 ? 'border-t border-slate-100' : ''
                        }`}
                      >
                        <View className="flex-1 pr-3">
                          <Text className="text-sm font-medium text-slate-900">{product.name}</Text>
                          <Text className="mt-0.5 text-xs text-slate-500">
                            {product.sku || 'No SKU'} · {product.unit}
                          </Text>
                        </View>
                        <Text className="mr-2 text-xs font-semibold text-brand-700">
                          {product.portioningEnabled
                            ? `${formatQuantity(Number(product.sealedQuantity ?? 0))} sealed · ${formatQuantity(Number(product.openedQuantity ?? 0))} ${product.unit} open`
                            : `${formatQuantity(product.quantity)} in stock`}
                        </Text>
                        <Feather name="chevron-right" size={17} color="#1A593B" />
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <View className="items-center rounded-xl bg-slate-50 p-6">
                    <Text className="text-sm font-medium text-slate-700">No inventory product found</Text>
                    <Text className="mt-1 text-center text-xs text-slate-500">
                      Try another name or SKU. Only inventory-tracked products appear here.
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>

          {selectedProduct?.portioningEnabled ? (
            <View className="overflow-hidden rounded-2xl border border-amber-200 bg-white">
              <View className="flex-row items-center border-b border-amber-100 bg-amber-50 p-4">
                <View className="h-10 w-10 items-center justify-center rounded-xl bg-white">
                  <Feather name="unlock" size={17} color="#92400E" />
                </View>
                <View className="ml-3 flex-1">
                  <Text className="text-sm font-semibold text-amber-950">
                    Open sealed stock for portioning
                  </Text>
                  <Text className="mt-1 text-xs leading-5 text-amber-800">
                    One {selectedProduct.containerUnit || 'container'} transfers {formatQuantity(Number(selectedProduct.containerUnitsPerBase ?? 0))} {selectedProduct.unit} to opened stock. Total inventory and value do not change.
                  </Text>
                </View>
              </View>
              <View className="gap-3 p-4 sm:flex-row sm:items-end">
                <View className="flex-1">
                  <Field
                    label={`Sealed ${selectedProduct.containerUnit || 'containers'} to open`}
                    value={containersToOpen}
                    onChangeText={setContainersToOpen}
                    keyboardType="number-pad"
                    placeholder="1"
                  />
                </View>
                <View className="mb-3 sm:min-w-48">
                  <Button
                    title={openContainers.isPending ? 'Opening…' : 'Open for portioning'}
                    disabled={
                      openContainers.isPending ||
                      !Number.isInteger(Number(containersToOpen)) ||
                      Number(containersToOpen) <= 0 ||
                      Number(containersToOpen) > Number(selectedProduct.sealedQuantity ?? 0)
                    }
                    onPress={() =>
                      Alert.alert(
                        'Open sealed stock?',
                        `Move ${containersToOpen} ${selectedProduct.containerUnit || 'container'} into opened ${selectedProduct.unit} stock?`,
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Open', onPress: () => openContainers.mutate() },
                        ],
                      )
                    }
                  />
                </View>
              </View>
            </View>
          ) : null}

          <View className={`overflow-hidden rounded-2xl border border-slate-200 bg-white ${!selectedProduct ? 'opacity-50' : ''}`}>
            <View className="p-4">
              {selectedProduct?.portioningEnabled ? (
                <>
                  <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-600">
                    Stock pool to adjust
                  </Text>
                  <View className="mb-4 flex-row rounded-xl bg-slate-100 p-1">
                    {(['sealed', 'opened'] as const).map((item) => {
                      const active = pool === item;
                      return (
                        <Pressable
                          key={item}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          onPress={() => {
                            setPool(item);
                            setQuantity('');
                          }}
                          className={`min-h-11 flex-1 items-center justify-center rounded-lg ${active ? 'bg-white' : ''}`}
                        >
                          <Text className={`text-xs font-semibold ${active ? 'text-brand-800' : 'text-slate-500'}`}>
                            {item === 'sealed'
                              ? `Sealed ${selectedProduct.containerUnit || 'containers'}`
                              : `Opened ${selectedProduct.unit}`}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : null}
              <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-600">
                Adjustment type
              </Text>
              <View className="flex-row rounded-xl bg-slate-100 p-1">
                {(['add', 'deduct'] as const).map((item) => {
                  const active = direction === item;
                  return (
                    <Pressable
                      key={item}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active, disabled: !selectedProduct }}
                      disabled={!selectedProduct}
                      onPress={() => changeDirection(item)}
                      className={`min-h-11 flex-1 flex-row items-center justify-center rounded-lg ${
                        active ? (item === 'add' ? 'bg-brand-700' : 'bg-red-600') : ''
                      }`}
                    >
                      <Feather
                        name={item === 'add' ? 'plus' : 'minus'}
                        size={16}
                        color={active ? '#FFFFFF' : '#64748B'}
                      />
                      <Text className={`ml-2 text-sm font-semibold ${active ? 'text-white' : 'text-slate-600'}`}>
                        {item === 'add' ? 'Add stock' : 'Deduct stock'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View className="border-t border-slate-100 p-4">
              <Field
                label={`Quantity${selectedProduct ? ` (${displayUnit})` : ''}`}
                placeholder="Enter quantity"
                keyboardType="decimal-pad"
                value={quantity}
                onChangeText={setQuantity}
                editable={Boolean(selectedProduct)}
              />
              <Text className="-mt-1 mb-4 text-xs leading-5 text-slate-500">
                Enter a positive amount. Ximo will {direction === 'deduct' ? 'subtract it from' : 'add it to'} the current stock automatically.
              </Text>

              {projectedQuantity !== null ? (
                <View className={`mb-4 flex-row items-center justify-between rounded-xl p-3 ${projectedQuantity < 0 ? 'bg-red-50' : 'bg-brand-50'}`}>
                  <Text className={`text-xs font-medium ${projectedQuantity < 0 ? 'text-red-700' : 'text-brand-700'}`}>
                    Stock after adjustment
                  </Text>
                  <Text className={`text-sm font-semibold ${projectedQuantity < 0 ? 'text-red-700' : 'text-brand-800'}`}>
                    {formatQuantity(projectedQuantity)} {displayUnit}
                  </Text>
                </View>
              ) : null}

              <Field
                label="Reason"
                placeholder="Explain why the stock is changing"
                value={reason}
                onChangeText={setReason}
                multiline
                editable={Boolean(selectedProduct)}
              />
              <View className="mb-5 flex-row flex-wrap gap-2">
                {commonReasons.map((item) => (
                  <Pressable
                    key={item}
                    accessibilityRole="button"
                    accessibilityState={{ selected: reason === item, disabled: !selectedProduct }}
                    disabled={!selectedProduct}
                    onPress={() => setReason(item)}
                    className={`min-h-10 items-center justify-center rounded-full border px-4 ${
                      reason === item
                        ? direction === 'deduct'
                          ? 'border-red-600 bg-red-600'
                          : 'border-brand-700 bg-brand-700'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <Text className={`text-xs font-medium ${reason === item ? 'text-white' : 'text-slate-700'}`}>
                      {item}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Button
                title={mutation.isPending ? 'Saving…' : 'Save adjustment'}
                disabled={
                  mutation.isPending ||
                  !selectedProduct ||
                  !hasValidQuantity ||
                  reason.trim().length < 3
                }
                onPress={confirmAdjustment}
              />
              {projectedQuantity !== null && projectedQuantity < 0 ? (
                <Text className="mt-2 text-center text-xs font-medium text-red-600">
                  This goes below zero and will save only if negative inventory is enabled in store settings.
                </Text>
              ) : null}
            </View>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

export default function StockAdjustmentScreen() {
  return (
    <AppSidebarProvider>
      <StockAdjustmentContent />
    </AppSidebarProvider>
  );
}
