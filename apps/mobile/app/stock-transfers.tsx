import { useMemo, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';
import { api } from '@/lib/api';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { Button, EmptyState, Field, Header, LoadingState, Screen } from '@/components/ui';
import { useSession } from '@/providers/session';
import { useBranchStore } from '@/store/branch';

interface StockTransferItemSummary {
  id: string;
  transferNumber: string;
  status: 'in_transit' | 'completed' | 'cancelled';
  fromBranchName: string;
  toBranchName: string;
  createdByName: string;
  createdAt: string;
  completedAt?: string;
  notes?: string;
}

interface ProductItem {
  id: string;
  name: string;
  sku?: string;
  unit?: string;
  sellingUnits?: Array<{
    variantId: string;
    name: string;
    unit: string;
    unitsPerBase: number;
    isPortioningContainer?: boolean;
  }>;
}

type TransferPool = 'shared' | 'sealed' | 'opened';
type SelectedTransferItem = {
  productId: string;
  name: string;
  quantity: string;
  pool: TransferPool;
  baseUnit: string;
  containerUnit?: string;
};

function StockTransfersContent() {
  const { currentUser } = useSession();
  const branch = useBranchStore((state) => state.activeBranch)!;
  const branches = currentUser?.branches ?? [];
  const client = useQueryClient();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [modalVisible, setModalVisible] = useState(false);

  // New transfer form state
  const [toBranchId, setToBranchId] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedItems, setSelectedItems] = useState<SelectedTransferItem[]>([]);
  const [productSearch, setProductSearch] = useState('');

  // Check SaaS module enablement
  const hasModule = currentUser?.modules.includes('stock_transfers') ?? false;

  const query = useInfiniteQuery({
    queryKey: ['stock-transfers', branch?.id, statusFilter, search],
    enabled: hasModule,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api<StockTransferItemSummary[]>(
        `/stock-transfers?page=${pageParam}&pageSize=30&branchId=${branch?.id || ''}&status=${
          statusFilter === 'all' ? '' : statusFilter
        }&search=${encodeURIComponent(search)}`,
      ),
    getNextPageParam: (last, pages) => (last.length === 30 ? pages.length + 1 : undefined),
  });

  const productsQuery = useQuery({
    queryKey: ['products-lookup', productSearch],
    enabled: modalVisible && hasModule,
    queryFn: () => api<ProductItem[]>(`/products?pageSize=20&search=${encodeURIComponent(productSearch)}`),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api('/stock-transfers', {
        method: 'POST',
        body: JSON.stringify({
          fromBranchId: branch.id,
          toBranchId,
          notes,
          items: selectedItems.map((item) => ({
            productId: item.productId,
            quantity: Number(item.quantity.replace(',', '.')),
            pool: item.pool,
          })),
        }),
      }),
    onSuccess: async () => {
      Alert.alert('Transfer dispatched', 'Stock transfer created and marked in transit.');
      setModalVisible(false);
      setSelectedItems([]);
      setNotes('');
      setToBranchId('');
      await client.invalidateQueries({ queryKey: ['stock-transfers'] });
      await client.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (error) => Alert.alert('Transfer failed', error.message),
  });

  const receiveMutation = useMutation({
    mutationFn: (transferId: string) =>
      api(`/stock-transfers/${transferId}/receive`, { method: 'POST' }),
    onSuccess: async () => {
      Alert.alert('Transfer received', 'Stock has been added to destination branch inventory.');
      await client.invalidateQueries({ queryKey: ['stock-transfers'] });
      await client.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (error) => Alert.alert('Failed to receive transfer', error.message),
  });

  const cancelMutation = useMutation({
    mutationFn: (transferId: string) =>
      api(`/stock-transfers/${transferId}/cancel`, { method: 'POST' }),
    onSuccess: async () => {
      Alert.alert('Transfer cancelled', 'Stock has been returned to sender branch.');
      await client.invalidateQueries({ queryKey: ['stock-transfers'] });
      await client.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (error) => Alert.alert('Failed to cancel transfer', error.message),
  });

  const transfers = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);
  const otherBranches = useMemo(
    () => branches.filter((b) => b.id !== branch?.id),
    [branches, branch],
  );

  const addItemToTransfer = (prod: ProductItem) => {
    if (selectedItems.some((i) => i.productId === prod.id)) return;
    const container = prod.sellingUnits?.find((unit) => unit.isPortioningContainer);
    setSelectedItems((prev) => [
      ...prev,
      {
        productId: prod.id,
        name: prod.name,
        quantity: '1',
        pool: container ? 'sealed' : 'shared',
        baseUnit: prod.unit || 'unit',
        containerUnit: container?.unit,
      },
    ]);
  };

  const removeItem = (prodId: string) => {
    setSelectedItems((prev) => prev.filter((i) => i.productId !== prodId));
  };

  const updateItemQty = (prodId: string, qty: string) => {
    setSelectedItems((prev) =>
      prev.map((i) => (i.productId === prodId ? { ...i, quantity: qty } : i)),
    );
  };

  const updateItemPool = (prodId: string, pool: TransferPool) => {
    setSelectedItems((prev) =>
      prev.map((item) => (item.productId === prodId ? { ...item, pool } : item)),
    );
  };

  if (!hasModule) {
    return (
      <Screen>
        <Header title="Stock Transfers" showBack backLabel="More" fallbackHref="/(tabs)/more" />
        <View className="flex-1 items-center justify-center p-6">
          <View className="mb-4 h-16 w-16 items-center justify-center rounded-2xl bg-amber-100">
            <Feather name="lock" size={32} color="#D97706" />
          </View>
          <Text className="text-xl font-bold text-slate-900">Module Not Enabled</Text>
          <Text className="mt-2 max-w-md text-center text-sm text-slate-600">
            Multi-branch Stock Transfers is a SaaS plan capability. Contact your organization
            administrator to upgrade your plan tier or enable this feature.
          </Text>
          <View className="mt-6">
            <Button title="Back to More" variant="secondary" onPress={() => router.back()} />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Header
        title="Stock Transfers"
        subtitle={`Active Branch: ${branch?.name ?? 'Main'}`}
        action={
          <Button
            title="+ New Transfer"
            onPress={() => {
              if (otherBranches.length === 0) {
                Alert.alert('Multi-branch required', 'You need at least 2 active branches to transfer stock.');
                return;
              }
              setToBranchId(otherBranches[0]?.id ?? '');
              setModalVisible(true);
            }}
          />
        }
      />

      <View className="gap-3 border-b border-slate-200 bg-white p-4">
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search transfer # or branch name"
          placeholderTextColor="#81776E"
          className="min-h-12 rounded-xl bg-slate-100 px-4 text-sm"
        />

        <View className="flex-row gap-2">
          {['all', 'in_transit', 'completed', 'cancelled'].map((st) => (
            <Pressable
              key={st}
              onPress={() => setStatusFilter(st)}
              className={`rounded-xl px-3 py-2 ${
                statusFilter === st ? 'bg-brand-700' : 'bg-slate-100'
              }`}
            >
              <Text
                className={`text-xs font-bold capitalize ${
                  statusFilter === st ? 'text-white' : 'text-slate-700'
                }`}
              >
                {st.replace('_', ' ')}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <FlatList
        data={transfers}
        keyExtractor={(item) => item.id}
        contentContainerClassName="p-4 gap-3"
        ListEmptyComponent={
          query.isLoading ? (
            <LoadingState label="Loading transfers…" />
          ) : (
            <EmptyState
              title="No stock transfers"
              message="Create a stock transfer to move inventory between branches."
            />
          )
        }
        renderItem={({ item }) => {
          const isInTransit = item.status === 'in_transit';
          const isCompleted = item.status === 'completed';
          return (
            <View className="rounded-2xl border border-slate-100 bg-white p-4">
              <View className="flex-row items-center justify-between">
                <Text className="text-base font-bold text-slate-900">{item.transferNumber}</Text>
                <View
                  className={`rounded-full px-2.5 py-1 ${
                    isInTransit
                      ? 'bg-amber-100'
                      : isCompleted
                        ? 'bg-emerald-100'
                        : 'bg-red-100'
                  }`}
                >
                  <Text
                    className={`text-xs font-bold capitalize ${
                      isInTransit
                        ? 'text-amber-800'
                        : isCompleted
                          ? 'text-emerald-800'
                          : 'text-red-700'
                    }`}
                  >
                    {item.status.replace('_', ' ')}
                  </Text>
                </View>
              </View>

              <View className="mt-2 flex-row items-center gap-2">
                <Text className="text-sm font-semibold text-slate-800">{item.fromBranchName}</Text>
                <Feather name="arrow-right" size={14} color="#64748B" />
                <Text className="text-sm font-semibold text-brand-700">{item.toBranchName}</Text>
              </View>

              <Text className="mt-1 text-xs text-slate-500">
                Created by {item.createdByName} · {new Date(item.createdAt).toLocaleString()}
              </Text>

              {item.notes ? (
                <Text className="mt-2 text-xs text-slate-600">Note: {item.notes}</Text>
              ) : null}

              {isInTransit ? (
                <View className="mt-4 flex-row gap-2 border-t border-slate-100 pt-3">
                  <Pressable
                    disabled={receiveMutation.isPending}
                    onPress={() =>
                      Alert.alert(
                        'Receive transfer?',
                        `Receive stock items from ${item.fromBranchName} into ${item.toBranchName}?`,
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Receive',
                            onPress: () => receiveMutation.mutate(item.id),
                          },
                        ],
                      )
                    }
                    className="min-h-10 flex-1 items-center justify-center rounded-xl bg-brand-700 active:bg-brand-800"
                  >
                    <Text className="text-xs font-bold text-white">Receive Transfer</Text>
                  </Pressable>

                  <Pressable
                    disabled={cancelMutation.isPending}
                    onPress={() =>
                      Alert.alert(
                        'Cancel transfer?',
                        'Stock items will be restored to the sender branch.',
                        [
                          { text: 'Back', style: 'cancel' },
                          {
                            text: 'Cancel Transfer',
                            style: 'destructive',
                            onPress: () => cancelMutation.mutate(item.id),
                          },
                        ],
                      )
                    }
                    className="min-h-10 items-center justify-center rounded-xl bg-slate-100 px-4 active:bg-slate-200"
                  >
                    <Text className="text-xs font-bold text-red-600">Cancel</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        }}
      />

      {/* New Stock Transfer Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View className="flex-1 bg-black/50 justify-end md:justify-center p-0 md:p-6">
          <View className="max-h-[90%] w-full max-w-2xl mx-auto rounded-t-3xl md:rounded-3xl bg-white p-5 shadow-xl">
            <View className="flex-row items-center justify-between border-b border-slate-100 pb-3">
              <Text className="text-lg font-bold text-slate-900">New Stock Transfer</Text>
              <Pressable onPress={() => setModalVisible(false)} className="p-2">
                <Feather name="x" size={20} color="#64748B" />
              </Pressable>
            </View>

            <ScrollView className="mt-4" contentContainerClassName="gap-4 pb-6">
              <View className="rounded-xl bg-slate-50 p-3">
                <Text className="text-xs text-slate-500">From (Source Branch)</Text>
                <Text className="text-base font-bold text-slate-900">{branch?.name}</Text>
              </View>

              <View>
                <Text className="mb-1 text-xs font-semibold text-slate-700">To (Destination Branch)</Text>
                <View className="flex-row flex-wrap gap-2">
                  {otherBranches.map((b) => (
                    <Pressable
                      key={b.id}
                      onPress={() => setToBranchId(b.id)}
                      className={`rounded-xl px-4 py-3 border ${
                        toBranchId === b.id
                          ? 'border-brand-700 bg-brand-50'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <Text
                        className={`text-sm font-bold ${
                          toBranchId === b.id ? 'text-brand-700' : 'text-slate-800'
                        }`}
                      >
                        {b.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View>
                <Text className="mb-1 text-xs font-semibold text-slate-700">Add Products to Transfer</Text>
                <TextInput
                  value={productSearch}
                  onChangeText={setProductSearch}
                  placeholder="Search catalog products…"
                  className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm"
                />

                {productsQuery.data?.length ? (
                  <View className="mt-2 max-h-36 rounded-xl border border-slate-100 bg-slate-50 p-2">
                    <ScrollView nestedScrollEnabled>
                      {productsQuery.data.map((p) => (
                        <Pressable
                          key={p.id}
                          onPress={() => addItemToTransfer(p)}
                          className="flex-row items-center justify-between border-b border-slate-200/60 p-2 active:bg-slate-200/50"
                        >
                          <Text className="text-sm font-medium text-slate-900">{p.name}</Text>
                          <Text className="text-xs font-bold text-brand-700">+ Select</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                ) : null}
              </View>

              <View className="gap-2">
                <Text className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Selected Transfer Items ({selectedItems.length})
                </Text>
                {selectedItems.map((item) => (
                  <View
                    key={item.productId}
                    className="gap-3 rounded-xl border border-slate-200 bg-white p-3"
                  >
                    <View className="flex-row items-center justify-between">
                      <View className="flex-1 pr-2">
                        <Text className="font-bold text-slate-900">{item.name}</Text>
                        <Text className="mt-0.5 text-xs text-slate-500">
                          Quantity in {item.pool === 'sealed' ? item.containerUnit : item.baseUnit}
                        </Text>
                      </View>
                      <TextInput
                        value={item.quantity}
                        onChangeText={(qty) => updateItemQty(item.productId, qty)}
                        keyboardType={item.pool === 'sealed' ? 'number-pad' : 'decimal-pad'}
                        placeholder="Qty"
                        className="h-10 w-20 rounded-xl border border-slate-300 text-center font-bold text-slate-900"
                      />
                      <Pressable onPress={() => removeItem(item.productId)} className="p-1">
                        <Feather name="trash-2" size={18} color="#EF4444" />
                      </Pressable>
                    </View>
                    {item.containerUnit ? (
                      <View className="flex-row rounded-xl bg-slate-100 p-1">
                        {(['sealed', 'opened'] as const).map((candidate) => (
                          <Pressable
                            key={candidate}
                            onPress={() => updateItemPool(item.productId, candidate)}
                            className={`flex-1 rounded-lg px-3 py-2 ${
                              item.pool === candidate ? 'bg-white shadow-sm' : ''
                            }`}
                          >
                            <Text
                              className={`text-center text-xs font-semibold ${
                                item.pool === candidate ? 'text-brand-700' : 'text-slate-500'
                              }`}
                            >
                              {candidate === 'sealed'
                                ? `Sealed ${item.containerUnit}`
                                : `Opened ${item.baseUnit}`}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>

              <Field
                label="Transfer Notes"
                value={notes}
                onChangeText={setNotes}
                placeholder="Reason for transfer, tracking #, or special instructions"
                multiline
              />

              <Button
                title={createMutation.isPending ? 'Dispatching…' : 'Dispatch Transfer'}
                disabled={
                  createMutation.isPending ||
                  !toBranchId ||
                  selectedItems.length === 0 ||
                  selectedItems.some((i) => {
                    const quantity = parseFloat(i.quantity.replace(',', '.'));
                    return !(quantity > 0) || (i.pool === 'sealed' && !Number.isInteger(quantity));
                  })
                }
                onPress={() => createMutation.mutate()}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

export default function StockTransfersScreen() {
  return (
    <AppSidebarProvider>
      <StockTransfersContent />
    </AppSidebarProvider>
  );
}
