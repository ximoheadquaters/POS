import { useEffect } from 'react';
import { Alert, Platform, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { useSession } from '@/providers/session';
import { Button, ErrorState, Header, LoadingState, Screen } from '@/components/ui';

interface SaleDetail {
  id: string;
  receiptNumber: string;
  status: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  changeDue: string;
  branchName: string;
  cashierName: string;
  completedAt: string;
  items: Array<{
    id: string;
    productName: string;
    quantity: number;
    unitPrice: string;
    lineTotal: string;
    returnedQuantity: number;
  }>;
  payments: Array<{ method: string; kind: string; amount: string }>;
}

import { AppSidebarProvider } from '@/components/app-sidebar';

function SaleDetailsContent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentUser, refreshUser } = useSession();

  useEffect(() => {
    void refreshUser().catch(() => undefined);
  }, [refreshUser]);

  const query = useQuery({
    queryKey: ['sale', id],
    queryFn: () => api<SaleDetail>(`/sales/${id}`),
  });
  if (query.isLoading)
    return (
      <Screen>
        <Header
          title="Receipt details"
          showBack
          backLabel="Sales"
          fallbackHref="/(tabs)/sales"
        />
        <LoadingState />
      </Screen>
    );
  if (query.isError)
    return (
      <Screen>
        <Header
          title="Receipt details"
          showBack
          backLabel="Sales"
          fallbackHref="/(tabs)/sales"
        />
        <ErrorState message={query.error.message} retry={() => void query.refetch()} />
      </Screen>
    );
  const sale = query.data!;
  return (
    <Screen>
      <Header
        title="Receipt details"
        subtitle={sale.receiptNumber}
        showBack
        backLabel="Sales"
        fallbackHref="/(tabs)/sales"
      />
      <ScrollView contentContainerClassName="p-5 pb-10">
        <View className="rounded-2xl bg-white p-5">
          <Text className="text-sm text-slate-500">{sale.branchName}</Text>
          <Text className="mt-1 text-sm text-slate-500">
            {new Date(sale.completedAt).toLocaleString()} · {sale.cashierName}
          </Text>
          <Text className="mt-5 text-3xl font-black text-brand-700">{formatMoney(sale.total)}</Text>
          <Text className="mt-1 text-xs uppercase text-slate-400">
            {sale.status.replace('_', ' ')}
          </Text>
        </View>
        <Text className="mb-3 mt-6 text-lg font-bold">Items</Text>
        <View className="rounded-2xl bg-white">
          {sale.items.map((item) => (
            <View key={item.id} className="flex-row border-b border-slate-100 p-4">
              <View className="flex-1">
                <Text className="font-semibold text-slate-900">{item.productName}</Text>
                <Text className="mt-1 text-sm text-slate-500">
                  {item.quantity} × {formatMoney(item.unitPrice)}
                  {item.returnedQuantity ? ` · ${item.returnedQuantity} returned` : ''}
                </Text>
              </View>
              <Text className="font-bold">{formatMoney(item.lineTotal)}</Text>
            </View>
          ))}
        </View>
        <View className="mt-6 gap-3">
          {currentUser?.permissions.includes('returns:create') &&
          currentUser?.modules.includes('returns') &&
          ['completed', 'partially_refunded'].includes(sale.status) ? (
            <Button
              title="Return items"
              variant="danger"
              onPress={() => {
                if (Platform.OS === 'web' || typeof window !== 'undefined') {
                  router.push(`/return/${sale.id}`);
                } else {
                  Alert.alert('Start return?', 'The original sale will be preserved.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Continue', onPress: () => router.push(`/return/${sale.id}`) },
                  ]);
                }
              }}
            />
          ) : null}
          <Button title="Back to sales" variant="secondary" onPress={() => router.back()} />
        </View>
      </ScrollView>
    </Screen>
  );
}

export default function SaleDetailsScreen() {
  return (
    <AppSidebarProvider>
      <SaleDetailsContent />
    </AppSidebarProvider>
  );
}
