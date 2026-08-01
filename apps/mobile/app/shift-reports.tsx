import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { Button, ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { useBranchStore } from '@/store/branch';
import { useSession } from '@/providers/session';

interface ShiftSummary {
  shiftCount: number;
  openShiftCount: number;
  cashSales: string;
  cashRefunds: string;
  cashIn: string;
  cashOut: string;
  expectedCash: string;
  actualCash: string;
  variance: string;
}

interface ShiftRow {
  id: string;
  status: 'open' | 'closed';
  openedAt: string;
  closedAt?: string;
  branchName: string;
  registerName: string;
  cashierName: string;
  cashSales: string;
  cashRefunds: string;
  expectedCash?: string;
  actualCash?: string;
  variance?: string;
  transactions: number;
}

interface ShiftReportResponse {
  summary: ShiftSummary;
  shifts: ShiftRow[];
  total: number;
}

const periods = [
  { label: 'Today', days: 1 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: 'All time', days: null },
] as const;

function ShiftReportsContent() {
  const { currentUser } = useSession();
  const branch = useBranchStore((state) => state.activeBranch);
  const [period, setPeriod] = useState(2);
  const isModuleEnabled = currentUser?.modules.includes('registers');
  const range = useMemo(() => {
    const to = new Date();
    to.setHours(0, 0, 0, 0);
    to.setDate(to.getDate() + 1);
    const from =
      periods[period]!.days === null
        ? new Date('2000-01-01T00:00:00.000Z')
        : new Date(to.getTime());
    if (periods[period]!.days !== null) from.setDate(from.getDate() - periods[period]!.days!);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [period]);
  const query = useQuery({
    queryKey: ['shift-reports', branch?.id, range.from, range.to],
    queryFn: () =>
      api<ShiftReportResponse>(
        `/reports/shifts?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(
          range.to,
        )}&page=1&pageSize=100${branch?.id ? `&branchId=${branch.id}` : ''}`,
      ),
    enabled: Boolean(isModuleEnabled),
  });

  if (!isModuleEnabled) {
    return (
      <Screen>
        <Header title="Shift History" showBack backLabel="Back" />
        <View className="flex-1 items-center justify-center p-8">
          <View className="mb-4 h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 border border-amber-200">
            <Feather name="lock" size={26} color="#B45309" />
          </View>
          <Text className="text-xl font-bold text-slate-900">Module Access Disabled</Text>
          <Text className="mt-2 max-w-xs text-center text-xs text-slate-500 leading-relaxed">
            The Registers & Shifts module is disabled for your organization. Contact your administrator or store owner to enable register management.
          </Text>
          <View className="mt-6 w-full max-w-xs">
            <Button title="Return to POS" onPress={() => router.push('/(tabs)/pos')} />
          </View>
        </View>
      </Screen>
    );
  }
  return (
    <Screen>
      <Header
        title="Cash and shift reports"
        subtitle={branch?.name ?? 'All accessible branches'}
        showBack
        backLabel="Reports"
        fallbackHref="/reports"
      />
      <View className="border-b border-slate-200 bg-white p-4">
        <View className="flex-row gap-2">
          {periods.map((item, index) => (
            <Pressable
              key={item.label}
              onPress={() => setPeriod(index)}
              className={`min-h-10 flex-1 items-center justify-center rounded-xl ${
                period === index ? 'bg-brand-700' : 'bg-slate-100'
              }`}
            >
              <Text className={`text-xs ${period === index ? 'text-white' : 'text-slate-700'}`}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
        {query.data ? (
          <View className="mt-4 flex-row flex-wrap gap-2">
            {[
              ['Cash sales', query.data.summary.cashSales],
              ['Cash refunds', query.data.summary.cashRefunds],
              ['Cash in', query.data.summary.cashIn],
              ['Cash out', query.data.summary.cashOut],
              ['Counted cash', query.data.summary.actualCash],
              ['Variance', query.data.summary.variance],
            ].map(([label, value]) => (
              <View key={label} className="w-[32%] min-w-28 rounded-xl bg-slate-50 p-3">
                <Text className="text-xs text-slate-500">{label}</Text>
                <Text className="mt-1 font-semibold text-slate-900">{formatMoney(value)}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
      {query.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState message={query.error.message} retry={() => void query.refetch()} />
      ) : (
        <FlatList
          data={query.data?.shifts ?? []}
          keyExtractor={(item) => item.id}
          contentContainerClassName="gap-2 p-4 pb-12"
          renderItem={({ item }) => (
            <Pressable
              onPress={() =>
                router.push({ pathname: '/shift-report/[id]', params: { id: item.id } })
              }
              className="flex-row items-center rounded-2xl border border-slate-100 bg-white p-4"
            >
              <View
                className={`mr-3 h-11 w-11 items-center justify-center rounded-xl ${
                  item.status === 'open' ? 'bg-amber-100' : 'bg-brand-50'
                }`}
              >
                <Feather
                  name="monitor"
                  size={18}
                  color={item.status === 'open' ? '#92400E' : '#1A593B'}
                />
              </View>
              <View className="flex-1">
                <Text className="font-medium text-slate-900">
                  {item.registerName} · {item.cashierName}
                </Text>
                <Text className="mt-1 text-xs text-slate-500">
                  {new Date(item.openedAt).toLocaleString()} · {item.transactions} transactions
                </Text>
                <Text className="mt-1 text-xs capitalize text-brand-700">{item.status}</Text>
              </View>
              <View className="items-end">
                <Text className="font-semibold text-slate-900">{formatMoney(item.cashSales)}</Text>
                {item.status === 'closed' ? (
                  <Text
                    className={`mt-1 text-xs ${
                      Number(item.variance) === 0 ? 'text-brand-700' : 'text-red-600'
                    }`}
                  >
                    Variance {formatMoney(item.variance ?? '0')}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}

export default function ShiftReportsScreen() {
  return (
    <AppSidebarProvider>
      <ShiftReportsContent />
    </AppSidebarProvider>
  );
}
