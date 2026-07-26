import { ScrollView, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatMoney, todayRange } from '@/lib/format';
import { ErrorState, Header, LoadingState, Screen } from '@/components/ui';

interface Report {
  salesTotal: string;
  transactions: number;
  averageTransaction: string;
  grossProfit: string;
  salesByPaymentMethod: Array<{ method: string; total: string }>;
  salesByBranch: Array<{ name: string; total: string; transactions: number }>;
  bestSellingProducts: Array<{ name: string; quantity: number; total: string }>;
}

export default function ReportsScreen() {
  const range = todayRange();
  const query = useQuery({
    queryKey: ['reports', range.from],
    queryFn: () =>
      api<Report>(
        `/reports/summary?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
      ),
  });
  if (query.isLoading)
    return (
      <Screen>
        <Header
          title="Reports"
          subtitle="Today"
          showBack
          backLabel="More"
          fallbackHref="/(tabs)/more"
        />
        <LoadingState />
      </Screen>
    );
  if (query.isError)
    return (
      <Screen>
        <Header
          title="Reports"
          subtitle="Today"
          showBack
          backLabel="More"
          fallbackHref="/(tabs)/more"
        />
        <ErrorState message={query.error.message} retry={() => void query.refetch()} />
      </Screen>
    );
  const report = query.data!;
  return (
    <Screen>
      <Header
        title="Reports"
        subtitle="Today"
        showBack
        backLabel="More"
        fallbackHref="/(tabs)/more"
      />
      <ScrollView contentContainerClassName="p-5 pb-10">
        <View className="flex-row flex-wrap gap-3">
          {[
            ['Sales', formatMoney(report.salesTotal)],
            ['Transactions', String(report.transactions)],
            ['Average', formatMoney(report.averageTransaction)],
            ['Gross profit', formatMoney(report.grossProfit)],
          ].map(([label, value]) => (
            <View key={label} className="w-[48%] rounded-2xl bg-white p-4">
              <Text className="text-sm text-slate-500">{label}</Text>
              <Text className="mt-2 text-xl font-black text-slate-900">{value}</Text>
            </View>
          ))}
        </View>
        <Text className="mb-3 mt-7 text-lg font-bold">Payment methods</Text>
        {report.salesByPaymentMethod.map((item) => (
          <View key={item.method} className="mb-2 flex-row justify-between rounded-xl bg-white p-4">
            <Text className="capitalize text-slate-700">{item.method}</Text>
            <Text className="font-bold">{formatMoney(item.total)}</Text>
          </View>
        ))}
        <Text className="mb-3 mt-7 text-lg font-bold">Branches</Text>
        {report.salesByBranch.map((item) => (
          <View key={item.name} className="mb-2 flex-row justify-between rounded-xl bg-white p-4">
            <Text className="text-slate-700">{item.name}</Text>
            <Text className="font-bold">{formatMoney(item.total)}</Text>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}
