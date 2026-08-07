import { useMemo, useState, type ComponentProps } from 'react';
import { FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';
import { api } from '@/lib/api';
import { liveDataQueryOptions } from '@/lib/live-data';
import { getStockStatus } from '@/lib/product-list-badges';
import { useSession } from '@/providers/session';
import { useBranchStore } from '@/store/branch';
import { ErrorState, Header, LoadingState, Screen } from '@/components/ui';

function qtyBadgeClass(status: ReturnType<typeof getStockStatus>['status']) {
  if (status === 'out_of_stock' || status === 'low_stock') {
    return { wrap: 'bg-red-100', text: 'text-red-700' };
  }
  if (status === 'warning') {
    return { wrap: 'bg-amber-100', text: 'text-amber-800' };
  }
  return { wrap: 'bg-brand-50', text: 'text-brand-700' };
}

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
type InventorySort = 'name' | 'quantity_asc' | 'quantity_desc';

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
  {
    id: 'ingredient',
    title: 'Raw stock',
    description: 'Recipe ingredients',
    icon: 'archive',
  },
  {
    id: 'both',
    title: 'Dual-use stock',
    description: 'Sold and consumed',
    icon: 'repeat',
  },
];

const INVENTORY_SORTS: Array<{
  id: InventorySort;
  title: string;
  description: string;
  icon: ComponentProps<typeof Feather>['name'];
}> = [
  { id: 'name', title: 'Name A–Z', description: 'Alphabetical by product', icon: 'type' },
  {
    id: 'quantity_asc',
    title: 'Stock: Low → High',
    description: 'Lowest quantity first',
    icon: 'arrow-up',
  },
  {
    id: 'quantity_desc',
    title: 'Stock: High → Low',
    description: 'Highest quantity first',
    icon: 'arrow-down',
  },
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
  const [sort, setSort] = useState<InventorySort>('name');
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { currentUser } = useSession();
  const branch = useBranchStore((state) => state.activeBranch);
  const inventoryEnabled = currentUser?.modules.includes('inventory') ?? false;
  const activeFilter =
    INVENTORY_FILTERS.find((filter) => filter.id === inventoryFilter) ?? INVENTORY_FILTERS[0];
  const activeSort = INVENTORY_SORTS.find((option) => option.id === sort) ?? INVENTORY_SORTS[0];
  const query = useInfiniteQuery({
    queryKey: ['inventory', branch?.id, inventoryFilter, search, sort],
    initialPageParam: 1,
    enabled: Boolean(branch) && inventoryEnabled,
    queryFn: ({ pageParam }) =>
      api<Inventory[]>(
        `/inventory?branchId=${branch!.id}&page=${pageParam}&pageSize=30&sort=${sort}${
          inventoryFilter === 'all' ? '' : `&inventoryRole=${inventoryFilter}`
        }${search ? `&search=${encodeURIComponent(search)}` : ''}`,
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
  const items = useMemo(() => {
    const rows = query.data?.pages.flat() ?? [];
    const byName = (a: Inventory, b: Inventory) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    if (sort === 'quantity_asc') {
      return [...rows].sort((a, b) => Number(a.quantity) - Number(b.quantity) || byName(a, b));
    }
    if (sort === 'quantity_desc') {
      return [...rows].sort((a, b) => Number(b.quantity) - Number(a.quantity) || byName(a, b));
    }
    return [...rows].sort(byName);
  }, [query.data, sort]);
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
  if (!inventoryEnabled) return <Redirect href="/(tabs)/more" />;

  return (
    <Screen>
      <Header title="Inventory" subtitle={branch?.name} />
      <View className="border-b border-slate-100 bg-white px-4 py-3 gap-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open repack and production"
          onPress={() => router.push('/production')}
          className="w-full flex-row items-center rounded-xl border border-brand-200 bg-brand-50 px-3 py-2.5 active:bg-brand-100"
        >
          <View className="h-9 w-9 items-center justify-center rounded-lg bg-white">
            <Feather name="repeat" size={17} color="#1A593B" />
          </View>
          <View className="ml-3 flex-1">
            <Text className="text-sm font-semibold text-brand-950">Repack / Production</Text>
            <Text numberOfLines={1} className="mt-0.5 text-xs text-brand-800">
              Consume BOM · add packs to sellable stock
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color="#1A593B" />
        </Pressable>

        <View className="min-h-11 flex-row items-center rounded-xl border border-slate-200 bg-slate-100 px-3">
          <Feather name="search" size={17} color="#81776E" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search name or SKU"
            placeholderTextColor="#81776E"
            selectionColor="#1A593B"
            style={{ outline: 'none' } as object}
            className="ml-2 flex-1 min-h-11 bg-transparent text-sm text-slate-900"
          />
          {search ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setSearch('')}>
              <Feather name="x" size={16} color="#81776E" />
            </Pressable>
          ) : null}
        </View>

        <View className="flex-row items-center gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Filter stock type"
            onPress={() => setFilterOpen(true)}
            className="min-h-11 flex-1 flex-row items-center justify-between rounded-xl border border-slate-200 bg-white px-3 active:bg-slate-50"
          >
            <View className="mr-2 flex-1 flex-row items-center gap-2">
              <Feather name={activeFilter.icon} size={15} color="#1A593B" />
              <Text numberOfLines={1} className="flex-1 text-sm font-semibold text-slate-900">
                {activeFilter.title}
              </Text>
            </View>
            <Feather name="chevron-down" size={16} color="#64748B" />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sort inventory"
            onPress={() => setSortOpen(true)}
            className="min-h-11 flex-1 flex-row items-center justify-between rounded-xl border border-slate-200 bg-white px-3 active:bg-slate-50"
          >
            <View className="mr-2 flex-1 flex-row items-center gap-2">
              <Feather name={activeSort.icon} size={15} color="#1A593B" />
              <Text numberOfLines={1} className="flex-1 text-sm font-semibold text-slate-900">
                {activeSort.title}
              </Text>
            </View>
            <Feather name="chevron-down" size={16} color="#64748B" />
          </Pressable>
        </View>

        <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1">
          <Text className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
            Qty color
          </Text>
          <View className="flex-row items-center gap-1.5">
            <View className="h-2.5 w-2.5 rounded-full bg-brand-600" />
            <Text className="text-xs font-medium text-slate-600">In stock</Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <View className="h-2.5 w-2.5 rounded-full bg-amber-500" />
            <Text className="text-xs font-medium text-slate-600">Warning</Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <View className="h-2.5 w-2.5 rounded-full bg-red-500" />
            <Text className="text-xs font-medium text-slate-600">Low stock</Text>
          </View>
        </View>
      </View>

      {query.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState message={query.error.message} retry={() => void query.refetch()} />
      ) : (
        <FlatList
          className="flex-1"
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerClassName="p-4 gap-2 grow"
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) {
              void query.fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center py-28">
              <Feather name="archive" size={42} color="#C7C0B8" />
              <Text className="mt-4 text-base font-bold text-slate-800">
                {search
                  ? 'No stock matches your search.'
                  : inventoryFilter === 'all'
                    ? 'No stock has been received yet.'
                    : 'No stock in this group.'}
              </Text>
              <Text className="mt-2 text-center text-sm text-slate-500 max-w-xs">
                {search
                  ? 'Try another name or SKU, or clear the search.'
                  : 'Receive deliveries or create products with opening stock.'}
              </Text>
              {search ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  onPress={() => setSearch('')}
                  className="mt-5 min-h-11 flex-row items-center justify-center rounded-xl border border-slate-200 bg-white px-5 active:bg-slate-50"
                >
                  <Text className="font-semibold text-slate-800">Clear search</Text>
                </Pressable>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Receive Stock"
                  onPress={() => router.push('/purchasing')}
                  className="mt-5 min-h-11 flex-row items-center justify-center rounded-xl bg-brand-700 px-5 active:bg-brand-800"
                >
                  <Feather name="truck" size={16} color="#FFFFFF" />
                  <Text className="ml-2 font-semibold text-white">Receive Stock</Text>
                </Pressable>
              )}
            </View>
          }
          renderItem={({ item }) => {
            const breakdown = containerBreakdown(item);
            const stock = getStockStatus(item.quantity, item.lowStockLevel);
            const badge = qtyBadgeClass(stock.status);
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
                <View className={`rounded-xl px-4 py-2 ${badge.wrap}`}>
                  <Text className={`text-lg font-black ${badge.text}`}>
                    {item.quantity} {item.unit}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      <Modal visible={filterOpen} transparent animationType="fade" onRequestClose={() => setFilterOpen(false)}>
        <View className="flex-1 items-center justify-center p-4">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close stock type filter"
            onPress={() => setFilterOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <View className="z-10 w-full max-w-sm rounded-3xl bg-white p-5 shadow-xl">
            <View className="mb-3 flex-row items-center justify-between border-b border-slate-100 pb-3">
              <Text className="text-base font-bold text-slate-900">Stock type</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setFilterOpen(false)}>
                <Feather name="x" size={20} color="#64748B" />
              </Pressable>
            </View>
            <View className="gap-1">
              {INVENTORY_FILTERS.map((filter) => {
                const selected = inventoryFilter === filter.id;
                return (
                  <Pressable
                    key={filter.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      setInventoryFilter(filter.id);
                      setFilterOpen(false);
                    }}
                    className={`flex-row items-center justify-between rounded-xl px-3 py-3 ${
                      selected ? 'border border-brand-200 bg-brand-50' : 'active:bg-slate-100'
                    }`}
                  >
                    <View className="flex-row items-center gap-2.5 flex-1">
                      <Feather name={filter.icon} size={17} color={selected ? '#1A593B' : '#64748B'} />
                      <View className="flex-1">
                        <Text
                          className={`text-sm ${selected ? 'font-bold text-brand-900' : 'font-medium text-slate-700'}`}
                        >
                          {filter.title}
                        </Text>
                        <Text className="mt-0.5 text-xs text-slate-500">{filter.description}</Text>
                      </View>
                    </View>
                    <View className="ml-2 flex-row items-center gap-2">
                      <Text className={`text-sm font-semibold ${selected ? 'text-brand-800' : 'text-slate-500'}`}>
                        {displayedInventoryCounts[filter.id]}
                      </Text>
                      {selected ? <Feather name="check" size={16} color="#1A593B" /> : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={sortOpen} transparent animationType="fade" onRequestClose={() => setSortOpen(false)}>
        <View className="flex-1 items-center justify-center p-4">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close sort options"
            onPress={() => setSortOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <View className="z-10 w-full max-w-sm rounded-3xl bg-white p-5 shadow-xl">
            <View className="mb-3 flex-row items-center justify-between border-b border-slate-100 pb-3">
              <Text className="text-base font-bold text-slate-900">Sort by</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setSortOpen(false)}>
                <Feather name="x" size={20} color="#64748B" />
              </Pressable>
            </View>
            <View className="gap-1">
              {INVENTORY_SORTS.map((option) => {
                const selected = sort === option.id;
                return (
                  <Pressable
                    key={option.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      setSort(option.id);
                      setSortOpen(false);
                    }}
                    className={`flex-row items-center justify-between rounded-xl px-3 py-3 ${
                      selected ? 'border border-brand-200 bg-brand-50' : 'active:bg-slate-100'
                    }`}
                  >
                    <View className="flex-row items-center gap-2.5 flex-1">
                      <Feather name={option.icon} size={17} color={selected ? '#1A593B' : '#64748B'} />
                      <View className="flex-1">
                        <Text
                          className={`text-sm ${selected ? 'font-bold text-brand-900' : 'font-medium text-slate-700'}`}
                        >
                          {option.title}
                        </Text>
                        <Text className="mt-0.5 text-xs text-slate-500">{option.description}</Text>
                      </View>
                    </View>
                    {selected ? <Feather name="check" size={16} color="#1A593B" /> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
