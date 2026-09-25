import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { useBranchStore } from '@/store/branch';

interface ShiftDetail {
  id: string;
  status: string;
  openedAt: string;
  closedAt?: string;
  branchName: string;
  registerName: string;
  cashierName: string;
  startingCash: string;
  cashSales: string;
  cashRefunds: string;
  cashIn: string;
  cashOut: string;
  expectedCash?: string;
  actualCash?: string;
  variance?: string;
  notes?: string;
  transactions: number;
  salesTotal: string;
  movements: Array<{
    id: string;
    type: string;
    amount: string;
    reason: string;
    invoiceNumber?: string | null;
    createdAt: string;
    createdBy: string;
  }>;
  sales?: Array<{
    id: string;
    receiptNumber: string;
    total: string;
    status: string;
    completedAt: string;
  }>;
  payments: Array<{ method: string; payments: string; refunds: string }>;
  refunds: Array<{
    id: string;
    returnNumber: string;
    method: string;
    total: string;
    createdAt: string;
  }>;
}

function ShiftReportDetailContent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const branch = useBranchStore((state) => state.activeBranch);
  const query = useQuery({
    queryKey: ['shift-report', branch?.id, id],
    enabled: Boolean(branch),
    queryFn: () => api<ShiftDetail>(`/reports/shifts/${id}?branchId=${branch!.id}`),
  });
  const [salesVisible, setSalesVisible] = useState(false);
  if (query.isLoading || !query.data) return <LoadingState />;
  if (query.isError)
    return <ErrorState message={query.error.message} retry={() => void query.refetch()} />;
  const shift = query.data!;
  const values = [
    ['Starting cash', shift.startingCash],
    ['Cash sales', shift.cashSales],
    ['Cash refunds', shift.cashRefunds],
    ['Cash in', shift.cashIn],
    ['Cash out', shift.cashOut],
    ['Expected cash', shift.expectedCash ?? '0'],
    ['Counted cash', shift.actualCash ?? '0'],
    ['Variance', shift.variance ?? '0'],
  ];
  return (
    <Screen>
      <Header
        title={shift.registerName}
        subtitle={`${shift.cashierName} · ${shift.status}`}
        showBack
        backLabel="Shift Reports"
        fallbackHref="/shift-reports"
      />
      <ScrollView contentContainerClassName="mx-auto w-full max-w-[760px] p-5 pb-12">
        <Text className="text-sm text-slate-500">
          {shift.branchName} · Opened {new Date(shift.openedAt).toLocaleString()}
        </Text>
        <View className="mt-4 flex-row flex-wrap gap-2">
          {values.map(([label, value]) => (
            <View key={label} className="w-[48%] rounded-2xl bg-white p-4">
              <Text className="text-xs text-slate-500">{label}</Text>
              <Text className="mt-1 text-lg font-semibold text-slate-900">
                {formatMoney(value)}
              </Text>
            </View>
          ))}
        </View>
        <Text className="mb-2 mt-7 font-semibold text-slate-900">Payment Breakdown</Text>
        {shift.payments.map((payment) => (
          <View
            key={payment.method}
            className="mb-2 flex-row justify-between rounded-xl bg-white p-4"
          >
            <Text className="capitalize text-slate-700">{payment.method}</Text>
            <Text className="font-medium">{formatMoney(payment.payments)}</Text>
          </View>
        ))}
        <Text className="mb-2 mt-7 font-semibold text-slate-900">Cash Movements</Text>
        {shift.movements.length ? (
          shift.movements.map((movement) => (
            <View key={movement.id} className="mb-2 rounded-xl bg-white p-4">
              <View className="flex-row justify-between">
                <Text className="font-medium capitalize">{movement.type.replace('_', ' ')}</Text>
                <Text className={movement.type === 'cash_in' ? 'text-brand-700' : 'text-red-600'}>
                  {movement.type === 'cash_in' ? '+' : '-'}
                  {formatMoney(movement.amount)}
                </Text>
              </View>
              {movement.invoiceNumber ? (
                <Text className="mt-1 text-xs font-semibold text-brand-700">
                  Invoice #: {movement.invoiceNumber}
                </Text>
              ) : null}
              <Text className="mt-1 text-xs text-slate-500">
                {movement.reason} · {new Date(movement.createdAt).toLocaleString()} · {movement.createdBy}
              </Text>
            </View>
          ))
        ) : (
          <Text className="text-sm text-slate-500">No Cash Movements</Text>
        )}
        <View className="mb-2 mt-7 flex-row items-center justify-between">
          <Text className="font-semibold text-slate-900">Sales Invoices</Text>
          {shift.sales?.length ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={salesVisible ? 'Hide sales invoices' : `View ${shift.sales.length} sales invoices`}
              accessibilityState={{ expanded: salesVisible }}
              onPress={() => setSalesVisible((visible) => !visible)}
              className="min-h-9 flex-row items-center rounded-lg px-2.5 active:bg-brand-50"
            >
              <Text className="text-xs font-semibold text-brand-700">
                {salesVisible ? 'Hide invoices' : `View invoices (${shift.sales.length})`}
              </Text>
              <Feather name={salesVisible ? 'chevron-up' : 'chevron-down'} size={15} color="#1A593B" />
            </Pressable>
          ) : null}
        </View>
        {shift.sales?.length && salesVisible ? (
          shift.sales.map((sale) => (
            <Pressable
              key={sale.id}
              onPress={() => router.push(`/sale/${sale.id}`)}
              className="mb-2 flex-row items-center justify-between rounded-xl bg-white p-4 active:bg-brand-50"
            >
              <View>
                <Text className="font-medium text-slate-900">Invoice / Receipt #{sale.receiptNumber}</Text>
                <Text className="mt-1 text-xs text-slate-500">
                  {new Date(sale.completedAt).toLocaleString()} · {sale.status.replace('_', ' ')}
                </Text>
              </View>
              <View className="items-end">
                <Text className="font-semibold text-brand-700">{formatMoney(sale.total)}</Text>
                <Text className="mt-0.5 text-[10px] font-bold text-brand-500">View ›</Text>
              </View>
            </Pressable>
          ))
        ) : shift.sales?.length ? (
          <Text className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-500">
            {shift.sales.length} invoices are available for this shift.
          </Text>
        ) : (
          <Text className="text-sm text-slate-500">No Sales Transactions</Text>
        )}
        <Text className="mb-2 mt-7 font-semibold text-slate-900">Refunds In This Shift</Text>
        {shift.refunds.length ? (
          shift.refunds.map((refund) => (
            <View key={refund.id} className="mb-2 flex-row justify-between rounded-xl bg-white p-4">
              <View>
                <Text className="font-medium">{refund.returnNumber}</Text>
                <Text className="mt-1 text-xs capitalize text-slate-500">{refund.method}</Text>
              </View>
              <Text className="text-red-600">-{formatMoney(refund.total)}</Text>
            </View>
          ))
        ) : (
          <Text className="text-sm text-slate-500">No Refunds</Text>
        )}
      </ScrollView>
    </Screen>
  );
}

export default function ShiftReportDetailScreen() {
  return (
    <AppSidebarProvider>
      <ShiftReportDetailContent />
    </AppSidebarProvider>
  );
}
