import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';
import { api } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { liveDataQueryOptions } from '@/lib/live-data';
import { useBranchStore } from '@/store/branch';
import { useCartStore, type CartProduct } from '@/store/cart';
import { useIosAlert } from '@/providers/ios-alert';
import { Button, EmptyState, ErrorState, Header, LoadingState, Screen } from '@/components/ui';

interface CompletedSale {
  id: string;
  receiptNumber: string;
  status: string;
  total: string;
  completedAt: string | null;
  cashierName: string;
  paymentMethods: Array<string | null>;
}

function completedSaleDetails(sale: CompletedSale): string {
  const paymentMethods = (sale.paymentMethods ?? []).filter((method): method is string =>
    Boolean(method),
  );
  return [sale.completedAt ? formatDate(sale.completedAt) : '', paymentMethods.join(' + ')]
    .filter(Boolean)
    .join(' · ');
}

function completedSaleMeta(sale: CompletedSale): string {
  return [sale.status?.replaceAll('_', ' '), sale.cashierName].filter(Boolean).join(' · ');
}

interface HeldSale {
  id: string;
  receiptNumber: string;
  status: string;
  total: string;
  note?: string | null;
  createdAt: string;
  customerId?: string | null;
  cashierName: string;
  customerName?: string | null;
  itemCount: number;
}

interface VoidedHeldSale {
  id: string;
  receiptNumber: string;
  total: string;
  note?: string | null;
  createdAt: string;
  cashierName: string;
  customerName?: string | null;
  itemCount: number;
  action?: 'sale.resumed' | 'sale.discarded' | null;
  closedAt?: string | null;
  closedBy?: string | null;
}

function voidedActionLabel(action: VoidedHeldSale['action']): string {
  if (action === 'sale.discarded') return 'Discarded';
  if (action === 'sale.resumed') return 'Resumed to cart';
  return 'Closed';
}

interface ResumedHeldSale {
  id: string;
  receiptNumber: string;
  customerId?: string | null;
  note?: string | null;
  items: Array<{
    productId: string;
    variantId?: string | null;
    productName: string;
    unitPrice: string;
    quantity: number;
    unit?: string;
    unitsPerBase?: number;
    taxRate?: string;
    isTaxInclusive?: boolean;
    sku: string;
    image?: string | null;
  }>;
}

export default function SalesHistoryScreen() {
  const branch = useBranchStore((state) => state.activeBranch);
  const { showAlert } = useIosAlert();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'completed' | 'held' | 'voided'>('completed');

  // Query completed sales
  const query = useInfiniteQuery({
    queryKey: ['sales', branch?.id],
    initialPageParam: 1,
    enabled: Boolean(branch) && activeTab === 'completed',
    queryFn: ({ pageParam }) =>
      api<CompletedSale[]>(`/sales?branchId=${branch!.id}&page=${pageParam}&pageSize=30`),
    getNextPageParam: (lastPage, pages) => (lastPage.length === 30 ? pages.length + 1 : undefined),
    ...liveDataQueryOptions,
  });

  // Query held sales
  const heldQuery = useQuery({
    queryKey: ['held-sales', branch?.id],
    enabled: Boolean(branch) && activeTab === 'held',
    queryFn: () => api<HeldSale[]>(`/sales/held${branch?.id ? `?branchId=${branch.id}` : ''}`),
    refetchInterval: 5000,
  });

  const voidedQuery = useInfiniteQuery({
    queryKey: ['voided-held-sales', branch?.id],
    initialPageParam: 1,
    enabled: Boolean(branch) && activeTab === 'voided',
    queryFn: ({ pageParam }) =>
      api<VoidedHeldSale[]>(
        `/sales/voided-holds?branchId=${branch!.id}&page=${pageParam}&pageSize=30`,
      ),
    getNextPageParam: (lastPage, pages) => (lastPage.length === 30 ? pages.length + 1 : undefined),
    ...liveDataQueryOptions,
  });

  // Resume held sale mutation
  const resumeMutation = useMutation({
    mutationFn: (heldSaleId: string) =>
      api<ResumedHeldSale>(`/sales/held/${heldSaleId}/resume?branchId=${branch!.id}`, {
        method: 'POST',
      }),
    onSuccess: (data) => {
      const cartItems = data.items.map((item) => {
        const product: CartProduct = {
          id: item.productId,
          variantId: item.variantId ?? null,
          name: item.productName,
          sku: item.sku || '',
          sellingPrice: item.unitPrice,
          taxRate: item.taxRate ?? '0.00',
          isTaxInclusive: item.isTaxInclusive ?? false,
          unit: (item.unit as any) ?? 'piece',
          unitsPerBase: item.unitsPerBase ?? 1,
        };
        return { product, quantity: item.quantity };
      });

      useCartStore.getState().replaceCart(cartItems, data.customerId ?? null);
      void queryClient.invalidateQueries({ queryKey: ['held-sales'] });
      void queryClient.invalidateQueries({ queryKey: ['voided-held-sales'] });
      showAlert({
        title: 'Order Resumed',
        message: `Restored ${data.receiptNumber} with ${data.items.length} items. Redirecting to checkout…`,
        type: 'success',
        buttons: [
          {
            text: 'Go to Checkout',
            onPress: () => router.push('/(tabs)/pos'),
          },
        ],
      });
    },
    onError: (error) =>
      showAlert({ title: 'Could Not Resume Sale', message: error.message, type: 'error' }),
  });

  // Discard held sale mutation
  const discardMutation = useMutation({
    mutationFn: (heldSaleId: string) =>
      api(`/sales/held/${heldSaleId}?branchId=${branch!.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['held-sales'] });
      void queryClient.invalidateQueries({ queryKey: ['voided-held-sales'] });
      showAlert({
        title: 'Parked Order Discarded',
        message: 'The held sale was removed.',
        type: 'info',
      });
    },
    onError: (error) =>
      showAlert({ title: 'Could Not Discard Order', message: error.message, type: 'error' }),
  });

  const sales = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);
  const heldSales = heldQuery.data ?? [];
  const voidedSales = useMemo(() => voidedQuery.data?.pages.flat() ?? [], [voidedQuery.data]);

  return (
    <Screen>
      <Header title="Sales & Orders" subtitle={branch?.name} />

      {/* Tab Selector */}
      <View className="pt-3 pb-2">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="min-w-full px-4"
        >
          <View className="min-w-full flex-row rounded-2xl bg-slate-100 p-1">
            <Pressable
              accessibilityRole="button"
              onPress={() => setActiveTab('completed')}
              className={`min-h-11 min-w-36 flex-1 flex-row items-center justify-center rounded-xl px-3 ${
                activeTab === 'completed' ? 'bg-white shadow-xs' : 'active:bg-slate-200/50'
              }`}
            >
              <Feather
                name="check-circle"
                size={15}
                color={activeTab === 'completed' ? '#1A593B' : '#64748B'}
              />
              <Text
                className={`ml-2 text-sm ${activeTab === 'completed' ? 'font-bold text-slate-900' : 'font-medium text-slate-600'}`}
              >
                Completed Orders
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => setActiveTab('held')}
              className={`min-h-11 min-w-36 flex-1 flex-row items-center justify-center rounded-xl px-3 ${
                activeTab === 'held' ? 'bg-white shadow-xs' : 'active:bg-slate-200/50'
              }`}
            >
              <Feather
                name="pause-circle"
                size={15}
                color={activeTab === 'held' ? '#D97706' : '#64748B'}
              />
              <Text
                className={`ml-2 text-sm ${activeTab === 'held' ? 'font-bold text-slate-900' : 'font-medium text-slate-600'}`}
              >
                Held Sales ({heldSales.length})
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => setActiveTab('voided')}
              className={`min-h-11 min-w-40 flex-1 flex-row items-center justify-center rounded-xl px-3 ${
                activeTab === 'voided' ? 'bg-white shadow-xs' : 'active:bg-slate-200/50'
              }`}
            >
              <Feather
                name="archive"
                size={15}
                color={activeTab === 'voided' ? '#B91C1C' : '#64748B'}
              />
              <Text
                className={`ml-2 text-sm ${activeTab === 'voided' ? 'font-bold text-slate-900' : 'font-medium text-slate-600'}`}
              >
                Voided / Discarded
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>

      {activeTab === 'completed' ? (
        query.isLoading ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState message={query.error.message} retry={() => void query.refetch()} />
        ) : (
          <FlatList
            data={sales}
            keyExtractor={(item) => item.id}
            contentContainerClassName="p-4 gap-3"
            onEndReached={() => query.hasNextPage && void query.fetchNextPage()}
            ListEmptyComponent={
              <EmptyState title="No sales yet" message="Completed sales will appear here." />
            }
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`View receipt ${item.receiptNumber}`}
                className="rounded-2xl border border-slate-100 bg-white p-4 active:border-brand-300 active:bg-brand-50 shadow-xs"
                onPress={() => router.push(`/sale/${item.id}`)}
              >
                <View className="flex-row justify-between">
                  <Text className="font-bold text-slate-900">{item.receiptNumber}</Text>
                  <Text className="text-lg font-black text-brand-700">
                    {formatMoney(item.total)}
                  </Text>
                </View>
                {completedSaleDetails(item) ? (
                  <Text className="mt-2 text-sm text-slate-500">{completedSaleDetails(item)}</Text>
                ) : null}
                <View className="mt-2 flex-row items-center justify-between">
                  <Text className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    {completedSaleMeta(item)}
                  </Text>
                  <Text className="text-xs font-bold text-brand-700">View receipt ›</Text>
                </View>
              </Pressable>
            )}
          />
        )
      ) : activeTab === 'held' ? (
        /* Held Sales (Parked Carts) Feed */
        heldQuery.isLoading ? (
          <LoadingState label="Loading held sales…" />
        ) : heldQuery.isError ? (
          <ErrorState message={heldQuery.error.message} retry={() => void heldQuery.refetch()} />
        ) : heldSales.length === 0 ? (
          <EmptyState
            title="No held sales"
            message="Parked orders will appear here when a cashier holds a sale at POS checkout."
          />
        ) : (
          <FlatList
            data={heldSales}
            keyExtractor={(item) => item.id}
            contentContainerClassName="p-4 gap-3"
            renderItem={({ item }) => (
              <View className="rounded-2xl border border-amber-200/80 bg-white p-4 shadow-xs">
                <View className="flex-row items-start justify-between">
                  <View className="flex-1 pr-3">
                    <View className="flex-row items-center gap-2">
                      <View className="flex-row items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5">
                        <Feather name="pause-circle" size={12} color="#D97706" />
                        <Text className="text-xs font-bold text-amber-800">HELD SALE</Text>
                      </View>
                      <Text className="text-base font-bold text-slate-900">
                        {item.receiptNumber}
                      </Text>
                    </View>

                    {item.note ? (
                      <Text className="mt-2 text-sm font-semibold text-slate-800">
                        "{item.note}"
                      </Text>
                    ) : null}

                    <Text className="mt-1.5 text-xs font-medium text-slate-500">
                      {item.itemCount} {item.itemCount === 1 ? 'item' : 'items'} · Parked by{' '}
                      {item.cashierName}
                      {item.customerName ? ` for ${item.customerName}` : ''}
                    </Text>
                    <Text className="mt-1 text-xs text-slate-400">
                      {formatDate(item.createdAt)}
                    </Text>
                  </View>

                  <Text className="text-lg font-black text-amber-700">
                    {formatMoney(item.total)}
                  </Text>
                </View>

                {/* Actions: Resume / Discard */}
                <View className="mt-4 flex-row items-center justify-between border-t border-slate-100 pt-3">
                  <Pressable
                    accessibilityRole="button"
                    disabled={discardMutation.isPending || resumeMutation.isPending}
                    onPress={() =>
                      showAlert({
                        title: 'Discard Held Sale?',
                        message: `Discard parked order ${item.receiptNumber}? This action cannot be undone.`,
                        type: 'warning',
                        buttons: [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Discard',
                            style: 'destructive',
                            onPress: () => discardMutation.mutate(item.id),
                          },
                        ],
                      })
                    }
                    className="flex-row items-center gap-1 px-2 py-1"
                  >
                    <Feather name="trash-2" size={14} color="#DC2626" />
                    <Text className="text-xs font-semibold text-red-600">Discard</Text>
                  </Pressable>

                  <Button
                    title={resumeMutation.isPending ? 'Resuming…' : 'Resume Order'}
                    disabled={resumeMutation.isPending || discardMutation.isPending}
                    onPress={() => resumeMutation.mutate(item.id)}
                  />
                </View>
              </View>
            )}
          />
        )
      ) : voidedQuery.isLoading ? (
        <LoadingState label="Loading voided history…" />
      ) : voidedQuery.isError ? (
        <ErrorState message={voidedQuery.error.message} retry={() => void voidedQuery.refetch()} />
      ) : (
        <FlatList
          data={voidedSales}
          keyExtractor={(item) => item.id}
          contentContainerClassName="p-4 gap-3"
          onEndReached={() => voidedQuery.hasNextPage && void voidedQuery.fetchNextPage()}
          ListEmptyComponent={
            <EmptyState
              title="No voided held sales"
              message="Discarded and resumed parked orders will appear here for reference."
            />
          }
          renderItem={({ item }) => {
            const discarded = item.action === 'sale.discarded';
            const actionLabel = voidedActionLabel(item.action);
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`View ${actionLabel.toLowerCase()} parked order ${item.receiptNumber}`}
                onPress={() => router.push(`/sale/${item.id}`)}
                className="rounded-2xl border border-slate-200 bg-white p-4 active:bg-slate-50 shadow-xs"
              >
                <View className="flex-row items-start justify-between gap-3">
                  <View className="flex-1">
                    <View className="flex-row flex-wrap items-center gap-2">
                      <View
                        className={`flex-row items-center gap-1 rounded-full px-2.5 py-1 ${discarded ? 'bg-red-50' : 'bg-blue-50'}`}
                      >
                        <Feather
                          name={discarded ? 'trash-2' : 'rotate-ccw'}
                          size={12}
                          color={discarded ? '#B91C1C' : '#1D4ED8'}
                        />
                        <Text
                          className={`text-xs font-bold ${discarded ? 'text-red-700' : 'text-blue-700'}`}
                        >
                          {actionLabel.toUpperCase()}
                        </Text>
                      </View>
                      <Text className="text-sm font-bold text-slate-900">{item.receiptNumber}</Text>
                    </View>

                    {item.note ? (
                      <Text className="mt-2 text-sm text-slate-700">“{item.note}”</Text>
                    ) : null}

                    <Text className="mt-2 text-xs font-medium text-slate-500">
                      {item.itemCount} {item.itemCount === 1 ? 'item' : 'items'} · Parked by{' '}
                      {item.cashierName}
                      {item.customerName ? ` for ${item.customerName}` : ''}
                    </Text>
                    <Text className="mt-1 text-xs text-slate-400">
                      Parked {formatDate(item.createdAt)}
                    </Text>
                    <Text className="mt-1 text-xs font-medium text-slate-500">
                      {actionLabel}
                      {item.closedBy ? ` by ${item.closedBy}` : ''}
                      {item.closedAt ? ` · ${formatDate(item.closedAt)}` : ''}
                    </Text>
                  </View>

                  <View className="items-end">
                    <Text className="text-lg font-black text-slate-700">
                      {formatMoney(item.total)}
                    </Text>
                    <Text className="mt-3 text-xs font-bold text-brand-700">View details ›</Text>
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </Screen>
  );
}
