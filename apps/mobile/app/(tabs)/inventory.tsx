import { useMemo, useState, type ComponentProps } from 'react';
import { FlatList, Modal, Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';
import { api } from '@/lib/api';
import { liveDataQueryOptions } from '@/lib/live-data';
import { getStockStatus } from '@/lib/product-list-badges';
import { useSession } from '@/providers/session';
import { useBranchStore } from '@/store/branch';
import { QuickAccess } from '@/components/quick-access';
import { ExpandableSection, ErrorState, Header, LoadingState, Screen } from '@/components/ui';

function stockStatusPresentation(
  status: ReturnType<typeof getStockStatus>['status'],
  quantity: number,
): {
  icon: ComponentProps<typeof Feather>['name'];
  label: string;
  needsAlert: boolean;
} {
  if (status === 'out_of_stock') {
    return { icon: 'inbox', label: 'Out of stock', needsAlert: true };
  }
  if (status === 'warning' || status === 'low_stock') {
    return { icon: 'package', label: `Low stock · ${quantity} left`, needsAlert: true };
  }
  return { icon: 'package', label: `${quantity} in stock`, needsAlert: false };
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
  const { width } = useWindowDimensions();
  const phone = width < 640;
  const [inventoryFilter, setInventoryFilter] = useState<InventoryFilter>('all');
  const [sort, setSort] = useState<InventorySort>('name');
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { currentUser } = useSession();
  const branch = useBranchStore((state) => state.activeBranch);
  const inventoryEnabled = currentUser?.modules.includes('inventory') ?? false;
  const trimmedSearch = search.trim();
  const activeFilter =
    INVENTORY_FILTERS.find((filter) => filter.id === inventoryFilter) ?? INVENTORY_FILTERS[0];
  const activeSort = INVENTORY_SORTS.find((option) => option.id === sort) ?? INVENTORY_SORTS[0];
  const query = useInfiniteQuery({
    queryKey: ['inventory', branch?.id, inventoryFilter, trimmedSearch, sort],
    initialPageParam: 1,
    enabled: Boolean(branch) && inventoryEnabled,
    queryFn: ({ pageParam }) =>
      api<Inventory[]>(
        `/inventory?branchId=${branch!.id}&page=${pageParam}&pageSize=30&sort=${sort}${
          inventoryFilter === 'all' ? '' : `&inventoryRole=${inventoryFilter}`
        }${trimmedSearch ? `&search=${encodeURIComponent(trimmedSearch)}` : ''}`,
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
      <Header title="Stock overview" subtitle={branch?.name} />
      <View
        className={`border-b border-slate-100 bg-white ${phone ? 'gap-2 px-3 py-2' : 'gap-3 px-4 py-3'}`}
      >
        <ExpandableSection
          title="Stock tools"
          summary="Restock, adjust, transfer or repack stock"
        >
          <QuickAccess
            title=""
            minimum={1}
            routes={['/purchasing', '/stock-adjustment', '/stock-transfers', '/retail/repacking']}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open Repack And Production"
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
        </ExpandableSection>

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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear Search"
              onPress={() => setSearch('')}
            >
              <Feather name="x" size={16} color="#81776E" />
            </Pressable>
          ) : null}
        </View>

        <View className="flex-row items-center gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Filter Stock Type"
            onPress={() => setFilterOpen(true)}
            className="min-h-11 flex-1 flex-row items-center justify-between rounded-xl border border-slate-200 bg-white px-3 active:bg-slate-50"
          >
            <View className="mr-2 flex-1 flex-row items-center gap-2">
              <Feather name={activeFilter.icon} size={15} color="#1A593B" />
              <Text
                numberOfLines={1}
                className={`flex-1 ${phone ? 'text-[13px]' : 'text-sm'} font-semibold text-slate-900`}
              >
                {activeFilter.title}
              </Text>
            </View>
            <Feather name="chevron-down" size={16} color="#64748B" />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sort Inventory"
            onPress={() => setSortOpen(true)}
            className="min-h-11 flex-1 flex-row items-center justify-between rounded-xl border border-slate-200 bg-white px-3 active:bg-slate-50"
          >
            <View className="mr-2 flex-1 flex-row items-center gap-2">
              <Feather name={activeSort.icon} size={15} color="#1A593B" />
              <Text
                numberOfLines={1}
                className={`flex-1 ${phone ? 'text-[13px]' : 'text-sm'} font-semibold text-slate-900`}
              >
                {activeSort.title}
              </Text>
            </View>
            <Feather name="chevron-down" size={16} color="#64748B" />
          </Pressable>
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
          contentContainerClassName={phone ? 'grow gap-2 p-3' : 'grow gap-2 p-4'}
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
                  accessibilityLabel="Clear Search"
                  onPress={() => setSearch('')}
                  className="mt-5 min-h-11 flex-row items-center justify-center rounded-xl border border-slate-200 bg-white px-5 active:bg-slate-50"
                >
                  <Text className="font-semibold text-slate-800">Clear Search</Text>
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
            const status = stockStatusPresentation(stock.status, item.quantity);
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Adjust stock for ${item.name}`}
                className={`rounded-2xl border border-slate-200 bg-white active:border-brand-300 active:bg-brand-50 ${
                  phone ? 'p-3' : 'p-4'
                }`}
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
                <View className="flex-row items-start">
                  <View className={`mr-3 items-center justify-center rounded-xl bg-slate-100 ${phone ? 'h-10 w-10' : 'h-11 w-11'}`}>
                    <Feather name="package" size={phone ? 18 : 20} color="#64748B" />
                  </View>
                  <View className="min-w-0 flex-1 pr-2">
                    <Text numberOfLines={1} className="font-semibold text-slate-900">{item.name}</Text>
                    <Text numberOfLines={1} className={`${phone ? 'mt-0.5' : 'mt-1'} text-xs text-slate-500`}>{item.sku}</Text>
                  </View>
                  <Feather name="chevron-right" size={18} color="#94A3B8" />
                </View>
                <View className="mt-3 flex-row items-center justify-between border-t border-slate-100 pt-2.5">
                  <View className="min-w-0 flex-1 pr-3">
                    <Text numberOfLines={1} className="text-xs font-medium text-slate-500">
                      {item.inventoryRole === 'ingredient'
                        ? 'Raw ingredient'
                        : item.inventoryRole === 'both'
                          ? 'POS + ingredient'
                          : 'Sellable product'}
                    </Text>
                    {breakdown ? (
                      <Text numberOfLines={1} className="mt-0.5 text-xs font-medium text-brand-700">{breakdown}</Text>
                    ) : null}
                  </View>
                  <View className="flex-row items-center gap-1.5">
                    <View className="relative">
                      <Feather name={status.icon} size={phone ? 15 : 16} color="#64748B" />
                      {status.needsAlert ? (
                        <View className="absolute -right-1.5 -top-1.5 h-3 w-3 items-center justify-center rounded-full bg-slate-600">
                          <Text className="text-[9px] font-bold leading-none text-white">!</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text className={`${phone ? 'text-sm' : 'text-base'} font-semibold text-slate-700`}>
                      {status.label}
                    </Text>
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      <Modal
        visible={filterOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setFilterOpen(false)}
      >
        <View className="flex-1 items-center justify-center p-4">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close Stock Type Filter"
            onPress={() => setFilterOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <View className="z-10 w-full max-w-sm rounded-3xl bg-white p-5 shadow-xl">
            <View className="mb-3 flex-row items-center justify-between border-b border-slate-100 pb-3">
              <Text className="text-base font-bold text-slate-900">Stock Type</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => setFilterOpen(false)}
              >
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
                      <Feather
                        name={filter.icon}
                        size={17}
                        color={selected ? '#1A593B' : '#64748B'}
                      />
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
                      <Text
                        className={`text-sm font-semibold ${selected ? 'text-brand-800' : 'text-slate-500'}`}
                      >
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

      <Modal
        visible={sortOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSortOpen(false)}
      >
        <View className="flex-1 items-center justify-center p-4">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close Sort Options"
            onPress={() => setSortOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <View className="z-10 w-full max-w-sm rounded-3xl bg-white p-5 shadow-xl">
            <View className="mb-3 flex-row items-center justify-between border-b border-slate-100 pb-3">
              <Text className="text-base font-bold text-slate-900">Sort By</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => setSortOpen(false)}
              >
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
                      <Feather
                        name={option.icon}
                        size={17}
                        color={selected ? '#1A593B' : '#64748B'}
                      />
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
