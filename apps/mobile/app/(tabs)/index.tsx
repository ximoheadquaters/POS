import { RefreshControl, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatMoney, todayRange } from '@/lib/format';
import { useSession } from '@/providers/session';
import { useBranchStore } from '@/store/branch';
import { ErrorState, Header, LoadingState, Screen } from '@/components/ui';

interface Summary {
  salesTotal: string;
  transactions: number;
  averageTransaction: string;
  grossProfit: string;
  salesByPaymentMethod: Array<{ method: string; total: string }>;
  bestSellingProducts: Array<{ name: string; quantity: number }>;
  lowStock: Array<{ name: string; branchName: string; quantity: number }>;
}

export default function DashboardScreen() {
  const { width } = useWindowDimensions();
  const { currentUser } = useSession();
  const branch = useBranchStore((state) => state.activeBranch);
  const range = todayRange();
  const query = useQuery({
    queryKey: ['dashboard', range.from.slice(0, 10)],
    queryFn: () =>
      api<Summary>(
        `/reports/summary?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
      ),
    enabled: currentUser?.modules.includes('dashboard') ?? false,
  });
  if (!currentUser?.modules.includes('dashboard')) {
    return (
      <Screen>
        <Header title="Dashboard" subtitle={branch?.name} />
        <View className="p-5">
          <Text className="rounded-2xl bg-white p-5 text-slate-600">
            Dashboard reporting is not included in this plan. POS and product functions remain
            available.
          </Text>
        </View>
      </Screen>
    );
  }
  if (query.isLoading)
    return (
      <Screen>
        <Header title="Dashboard" subtitle={branch?.name} />
        <LoadingState label="Loading today’s activity…" />
      </Screen>
    );
  if (query.isError)
    return (
      <Screen>
        <Header title="Dashboard" subtitle={branch?.name} />
        <ErrorState message={query.error.message} retry={() => void query.refetch()} />
      </Screen>
    );
  const data = query.data!;
  const cards = [
    ['Today’s sales', formatMoney(data.salesTotal)],
    ['Transactions', String(data.transactions)],
    ['Average sale', formatMoney(data.averageTransaction)],
    ['Gross profit', formatMoney(data.grossProfit)],
  ];
  return (
    <Screen>
      <Header title="Dashboard" subtitle={branch?.name} />
      <ScrollView
        refreshControl={
          <RefreshControl
            tintColor="#1A593B"
            colors={['#1A593B']}
            refreshing={query.isRefetching}
            onRefresh={() => void query.refetch()}
          />
        }
        contentContainerClassName="p-5"
      >
        <View className="flex-row flex-wrap gap-3">
          {cards.map(([label, value]) => (
            <View
              key={label}
              style={{ width: width >= 720 ? '23%' : '48%' }}
              className="rounded-2xl border border-slate-100 bg-white p-4"
            >
              <Text className="text-sm text-slate-500">{label}</Text>
              <Text className="mt-2 text-xl font-bold text-slate-900">{value}</Text>
            </View>
          ))}
        </View>
        <Text className="mb-3 mt-7 text-lg font-bold text-slate-900">Best sellers</Text>
        <View className="rounded-2xl bg-white">
          {data.bestSellingProducts.slice(0, 5).map((product, index) => (
            <View key={product.name} className="flex-row border-b border-slate-100 p-4">
              <Text className="w-8 font-bold text-brand-700">{index + 1}</Text>
              <Text className="flex-1 text-slate-800">{product.name}</Text>
              <Text className="font-semibold text-slate-700">{product.quantity}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}
