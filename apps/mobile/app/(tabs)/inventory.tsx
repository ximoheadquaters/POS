import { useMemo, useState, type ComponentProps } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';
import { api } from '@/lib/api';
import { liveDataQueryOptions } from '@/lib/live-data';
import { useSession } from '@/providers/session';
import { useBranchStore } from '@/store/branch';
import { EmptyState, ErrorState, Header, LoadingState, Screen } from '@/components/ui';

interface Inventory {
  id: string;
  productId: string;
  name: string;
  sku: string;
  unit: string;
  inventoryRole?: 'sellable' | 'ingredient' | 'both';
  quantity: number;
  lowStockLevel: number;
  isLowStock: boolean;
  containerName?: string | null;
  containerUnit?: string | null;
  containerUnitsPerBase?: number | null;
  portioningEnabled?: boolean;
  portioningVariantId?: string | null;
  sealedQuantity?: number;
  openedQuantity?: number;
}

type InventoryFilter = 'all' | 'sellable' | 'ingredient' | 'both';

const INVENTORY_FILTERS: Array<{
  id: InventoryFilter;
  title: string;
  description: string;
  icon: ComponentProps<typeof Feather>['name'];
}> = [
  { id: 'all', title: 'All stock', description: 'Every tracked item', icon: 'grid' },
  {
    id: 'sellable',
    title: 'Sellable stock',
    description: 'Products for the POS',
    icon: 'shopping-cart',
  },
  { id: 'ingredient', title: 'Raw stock', description: 'Recipe ingredients', icon: 'archive' },
  { id: 'both', title: 'Dual-use stock', description: 'Sold and consumed', icon: 'repeat' },
];

function containerBreakdown(item: Inventory): string | null {
  if (item.portioningEnabled) {
    const containerLabel = item.containerUnit || item.containerName || 'container';
    return `${item.sealedQuantity ?? 0} sealed ${containerLabel}${Number(item.sealedQuantity ?? 0) === 1 ? '' : 's'} · ${item.openedQuantity ?? 0} ${item.unit} opened`;
  }
  const conversion = item.containerUnitsPerBase;
  if (!conversion || conversion <= 1 || item.quantity < 0) return null;
  const fullContainers = Math.floor((item.quantity + 0.000_001) / conversion);
  const remainder = Math.round((item.quantity - fullContainers * conversion) * 1_000) / 1_000;
  const containerLabel = item.containerName || item.containerUnit || 'container';
  return remainder > 0
    ? `${fullContainers} full ${containerLabel.toLowerCase()}${fullContainers === 1 ? '' : 's'} + ${remainder} ${item.unit} opened`
    : `${fullContainers} full ${containerLabel.toLowerCase()}${fullContainers === 1 ? '' : 's'}`;
}

export default function InventoryScreen() {
  const [inventoryFilter, setInventoryFilter] = useState<InventoryFilter>('all');
  const { currentUser } = useSession();
  const branch = useBranchStore((state) => state.activeBranch);
  const inventoryEnabled = currentUser?.modules.includes('inventory') ?? false;
  const query = useInfiniteQuery({
    queryKey: ['inventory', branch?.id, inventoryFilter],
    initialPageParam: 1,
    enabled: Boolean(branch) && inventoryEnabled,
    queryFn: ({ pageParam }) =>
      api<Inventory[]>(
        `/inventory?branchId=${branch!.id}&page=${pageParam}&pageSize=30${
          inventoryFilter === 'all' ? '' : `&inventoryRole=${inventoryFilter}`
        }`,
      ),
    getNextPageParam: (lastPage, pages) => (lastPage.length === 30 ? pages.length + 1 : undefined),
    ...liveDataQueryOptions,
  });
  const summaryQuery = useQuery({
    queryKey: ['inventory-summary', branch?.id],
    enabled: Boolean(branch) && inventoryEnabled,
    queryFn: () =>
      api<{ all: number; sellable: number; ingredient: number; both: number }>(
        `/inventory/summary?branchId=${branch!.id}`,
      ),
    ...liveDataQueryOptions,
  });
  const items = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);
  const inventoryCounts = useMemo(
    () => ({
      all: items.length,
      sellable: items.filter((item) => !item.inventoryRole || item.inventoryRole === 'sellable')
        .length,
      ingredient: items.filter((item) => item.inventoryRole === 'ingredient').length,
      both: items.filter((item) => item.inventoryRole === 'both').length,
    }),
    [items],
  );
  const displayedInventoryCounts = summaryQuery.data ?? inventoryCounts;
  const visibleItems = items;
  if (!inventoryEnabled) return <Redirect href="/(tabs)/more" />;
  return (
    <Screen>
      <Header title="Inventory" subtitle={branch?.name} />
      <View className="border-b border-slate-100 bg-white p-4">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open repack and production"
          onPress={() => router.push('/production')}
          className="w-full flex-row items-center rounded-2xl border border-brand-200 bg-brand-50 p-4 active:bg-brand-100"
        >
          <View className="h-11 w-11 items-center justify-center rounded-xl bg-white">
            <Feather name="repeat" size={19} color="#1A593B" />
          </View>
          <View className="ml-3 flex-1">
            <Text className="text-sm font-semibold text-brand-950">Repack / Production</Text>
            <Text className="mt-1 text-xs leading-4 text-brand-800">
              Consume a BOM once and add completed packs or prepared items to sellable stock.
            </Text>
          </View>
          <Feather name="chevron-right" size={19} color="#1A593B" />
        </Pressable>
      </View>
      {items.length ? (
        <View className="border-b border-slate-100 bg-slate-50 p-4">
          <View className="flex-row flex-wrap gap-3">
            {INVENTORY_FILTERS.map((filter) => {
              const selected = inventoryFilter === filter.id;
              return (
                <Pressable
                  key={filter.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setInventoryFilter(filter.id)}
                  className={`min-w-[145px] flex-1 rounded-2xl border p-4 active:opacity-80 ${
                    selected ? 'border-brand-700 bg-brand-700' : 'border-slate-200 bg-white'
                  }`}
                >
                  <View className="flex-row items-start justify-between">
                    <View
                      className={`h-10 w-10 items-center justify-center rounded-xl ${
                        selected ? 'bg-white/15' : 'bg-brand-50'
                      }`}
                    >
                      <Feather
                        name={filter.icon}
                        size={17}
                        color={selected ? '#FFFFFF' : '#1A593B'}
                      />
                    </View>
                    <Text
                      className={`text-xl font-semibold ${selected ? 'text-white' : 'text-slate-950'}`}
                    >
                      {displayedInventoryCounts[filter.id]}
                    </Text>
                  </View>
                  <Text
                    className={`mt-3 text-sm font-semibold ${selected ? 'text-white' : 'text-slate-900'}`}
                  >
                    {filter.title}
                  </Text>
                  <Text
                    className={`mt-1 text-xs ${selected ? 'text-brand-100' : 'text-slate-500'}`}
                  >
                    {filter.description}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
      {query.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState message={query.error.message} retry={() => void query.refetch()} />
      ) : (
        <FlatList
          data={visibleItems}
          keyExtractor={(item) => item.id}
          contentContainerClassName="p-4 gap-2"
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center py-28">
              <Feather name="archive" size={42} color="#C7C0B8" />
              <Text className="mt-4 text-base font-bold text-slate-800">
                {inventoryFilter === 'all' ? 'No stock has been received yet.' : 'No stock in this group.'}
              </Text>
              <Text className="mt-2 text-center text-sm text-slate-500 max-w-xs">
                Receive deliveries or create products with opening stock.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Receive Stock"
                onPress={() => router.push('/purchasing')}
                className="mt-5 min-h-11 flex-row items-center justify-center rounded-xl bg-brand-700 px-5 active:bg-brand-800"
              >
                <Feather name="truck" size={16} color="#FFFFFF" />
                <Text className="ml-2 font-semibold text-white">Receive Stock</Text>
              </Pressable>
            </View>
          }
          renderItem={({ item }) => {
            const breakdown = containerBreakdown(item);
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Adjust stock for ${item.name}`}
                className="flex-row items-center rounded-2xl border border-slate-100 bg-white p-4 active:border-brand-300 active:bg-brand-50"
                onPress={() =>
                  router.push({
                    pathname: '/stock-adjustment',
                    params: {
                      productId: item.productId,
                      name: item.name,
                      sku: item.sku,
                      unit: item.unit,
                      quantity: String(item.quantity),
                      portioningEnabled: item.portioningEnabled ? '1' : '0',
                      sealedQuantity: String(item.sealedQuantity ?? 0),
                      openedQuantity: String(item.openedQuantity ?? 0),
                      containerName: item.containerName ?? '',
                      containerUnit: item.containerUnit ?? '',
                      containerUnitsPerBase: String(item.containerUnitsPerBase ?? ''),
                    },
                  })
                }
              >
                <View className="flex-1">
                  <Text className="font-bold text-slate-900">{item.name}</Text>
                  <Text className="mt-1 text-xs text-slate-500">{item.sku}</Text>
                  <Text className="mt-1 text-xs font-medium text-slate-500">
                    {item.inventoryRole === 'ingredient'
                      ? 'Raw ingredient'
                      : item.inventoryRole === 'both'
                        ? 'POS + ingredient'
                        : 'Sellable product'}
                  </Text>
                  {breakdown ? (
                    <Text className="mt-1 text-xs font-medium text-brand-700">{breakdown}</Text>
                  ) : null}
                </View>
                <View
                  className={`rounded-xl px-4 py-2 ${item.isLowStock ? 'bg-red-100' : 'bg-brand-50'}`}
                >
                  <Text
                    className={`text-lg font-black ${item.isLowStock ? 'text-red-700' : 'text-brand-700'}`}
                  >
                    {item.quantity} {item.unit}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </Screen>
  );
}
