import { useMemo } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { useBranchStore } from '@/store/branch';
import { EmptyState, ErrorState, Header, LoadingState, Screen } from '@/components/ui';

interface Sale {
  id: string;
  receiptNumber: string;
  status: string;
  total: string;
  completedAt: string;
  cashierName: string;
  paymentMethods: string[];
}

export default function SalesHistoryScreen() {
  const branch = useBranchStore((state) => state.activeBranch);
  const query = useInfiniteQuery({
    queryKey: ['sales', branch?.id],
    initialPageParam: 1,
    enabled: Boolean(branch),
    queryFn: ({ pageParam }) =>
      api<Sale[]>(`/sales?branchId=${branch!.id}&page=${pageParam}&pageSize=30`),
    getNextPageParam: (lastPage, pages) => (lastPage.length === 30 ? pages.length + 1 : undefined),
  });
  const sales = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);
  return (
    <Screen>
      <Header title="Sales" subtitle={branch?.name} />
      {query.isLoading ? (
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
              className="rounded-2xl border border-slate-100 bg-white p-4 active:border-brand-300 active:bg-brand-50"
              onPress={() => router.push(`/sale/${item.id}`)}
            >
              <View className="flex-row justify-between">
                <Text className="font-bold text-slate-900">{item.receiptNumber}</Text>
                <Text className="text-lg font-black text-brand-700">{formatMoney(item.total)}</Text>
              </View>
              <Text className="mt-2 text-sm text-slate-500">
                {new Date(item.completedAt).toLocaleString()} · {item.paymentMethods.join(' + ')}
              </Text>
              <Text className="mt-1 text-xs uppercase text-slate-400">
                {item.status.replace('_', ' ')}
              </Text>
              <Text className="mt-2 text-xs font-bold text-brand-500">View receipt ›</Text>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}
