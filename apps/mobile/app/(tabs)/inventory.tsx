import { useMemo } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
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
  quantity: number;
  lowStockLevel: number;
  isLowStock: boolean;
  containerName?: string | null;
  containerUnit?: string | null;
  containerUnitsPerBase?: number | null;
}

function containerBreakdown(item: Inventory): string | null {
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
  const { currentUser } = useSession();
  const branch = useBranchStore((state) => state.activeBranch);
  const inventoryEnabled = currentUser?.modules.includes('inventory') ?? false;
  const query = useInfiniteQuery({
    queryKey: ['inventory', branch?.id],
    initialPageParam: 1,
    enabled: Boolean(branch) && inventoryEnabled,
    queryFn: ({ pageParam }) =>
      api<Inventory[]>(`/inventory?branchId=${branch!.id}&page=${pageParam}&pageSize=30`),
    getNextPageParam: (lastPage, pages) => (lastPage.length === 30 ? pages.length + 1 : undefined),
    ...liveDataQueryOptions,
  });
  const items = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);
  if (!inventoryEnabled) return <Redirect href="/(tabs)/more" />;
  return (
    <Screen>
      <Header title="Inventory" subtitle={branch?.name} />
      {query.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState message={query.error.message} retry={() => void query.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerClassName="p-4 gap-2"
          ListEmptyComponent={
            <EmptyState title="No inventory" message="Create products and opening stock first." />
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
                    params: { productId: item.productId, name: item.name, unit: item.unit },
                  })
                }
              >
                <View className="flex-1">
                  <Text className="font-bold text-slate-900">{item.name}</Text>
                  <Text className="mt-1 text-xs text-slate-500">{item.sku}</Text>
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
