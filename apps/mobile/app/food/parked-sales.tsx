import React from 'react';
import { View, Text, FlatList, Pressable, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { useIosAlert } from '@/providers/ios-alert';
import { useBranchStore } from '@/store/branch';
import { useCartStore } from '@/store/cart';
import { EmptyState, Header, Screen } from '@/components/ui';

interface HeldSaleItem {
  productId: string;
  variantId: string | null;
  productName: string;
  unitPrice: string;
  quantity: number;
  unit?: string;
  sku?: string;
  image?: string | null;
}

interface HeldSale {
  id: string;
  receiptNumber: string;
  status: string;
  total: string;
  note: string | null;
  createdAt: string;
  customerId: string | null;
  cashierName?: string;
  customerName?: string;
  itemCount: number;
}

export default function ParkedSalesScreen() {
  const queryClient = useQueryClient();
  const { showAlert } = useIosAlert();
  const activeBranchId = useBranchStore((state) => state.activeBranch?.id);

  const { data: sales, isLoading, refetch } = useQuery({
    queryKey: ['food-parked-sales', activeBranchId],
    queryFn: async () => {
      const res = await api<HeldSale[]>(
        `/sales/held?branchId=${activeBranchId || ''}`,
      );
      return Array.isArray(res) ? res : (res as any)?.data ?? [];
    },
  });

  const resumeMutation = useMutation({
    mutationFn: async (id: string) => {
      return api<{
        id: string;
        receiptNumber: string;
        customerId: string | null;
        note: string | null;
        items: HeldSaleItem[];
      }>(`/sales/held/${id}/resume`, { method: 'POST' });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['food-parked-sales'] });
      queryClient.invalidateQueries({ queryKey: ['pos-held-sales-count'] });

      const resumedCartItems = (data.items || []).map((item) => ({
        product: {
          id: item.productId,
          variantId: item.variantId ?? null,
          name: item.productName,
          sku: item.sku || 'N/A',
          sellingPrice: item.unitPrice,
          unit: (item.unit as any) || 'piece',
          taxRate: '0.12',
          isTaxInclusive: true,
        },
        quantity: item.quantity,
      }));

      useCartStore.getState().replaceCart(resumedCartItems, data.customerId);

      showAlert({
        title: 'Order Restored',
        message: `Order #${data.receiptNumber} (${resumedCartItems.length} items) restored to your active cart.`,
        type: 'success',
      });
      router.replace('/(tabs)/pos');
    },
    onError: (err: any) => {
      showAlert({
        title: 'Could Not Resume Sale',
        message: err.message || 'Failed to resume held sale.',
        type: 'error',
      });
    },
  });

  const discardMutation = useMutation({
    mutationFn: async (id: string) => {
      return api(`/sales/held/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['food-parked-sales'] });
      queryClient.invalidateQueries({ queryKey: ['pos-held-sales-count'] });
      showAlert({
        title: 'Order Discarded',
        message: 'The parked sale has been deleted.',
        type: 'success',
      });
    },
    onError: (err: any) => {
      showAlert({
        title: 'Could Not Discard',
        message: err.message || 'Failed to discard held sale.',
        type: 'error',
      });
    },
  });

  return (
    <Screen>
      <Header
        title="Parked Sales"
        subtitle="Active held orders and parked carts"
        showBack
        backLabel="POS"
        fallbackHref="/(tabs)/pos"
      />

      <View className="flex-1 bg-slate-50 p-4">
        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#1A593B" />
          </View>
        ) : (
          <FlatList
            data={sales || []}
            keyExtractor={(item) => item.id}
            refreshing={isLoading}
            onRefresh={refetch}
            contentContainerClassName="gap-3 pb-24"
            renderItem={({ item }) => (
              <View className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <View className="flex-row items-start justify-between">
                  <View className="flex-1 pr-3">
                    <View className="flex-row items-center gap-2">
                      <Text className="text-base font-bold text-slate-900">
                        Order #{item.receiptNumber || item.id.substring(0, 8)}
                      </Text>
                      <View className="rounded-full bg-amber-100 px-2.5 py-0.5">
                        <Text className="text-[10px] font-bold uppercase text-amber-800">
                          Parked
                        </Text>
                      </View>
                    </View>

                    {item.note ? (
                      <Text className="mt-1 text-xs font-medium text-amber-900 bg-amber-50 rounded-lg p-1.5 border border-amber-200">
                        Tag: {item.note}
                      </Text>
                    ) : null}

                    <Text className="mt-1 text-xs text-slate-500">
                      {item.customerName ? `Customer: ${item.customerName} · ` : ''}
                      {item.itemCount ? `${item.itemCount} items · ` : ''}
                      Held at {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>

                  <View className="items-end">
                    <Text className="text-lg font-black text-brand-700">
                      {formatMoney(item.total)}
                    </Text>
                  </View>
                </View>

                <View className="mt-3 flex-row items-center justify-end gap-2 border-t border-slate-100 pt-3">
                  <Pressable
                    disabled={discardMutation.isPending || resumeMutation.isPending}
                    onPress={() => discardMutation.mutate(item.id)}
                    className="flex-row items-center gap-1 rounded-xl border border-red-200 bg-red-50 px-3 py-2 active:bg-red-100"
                  >
                    <Feather name="trash-2" size={14} color="#DC2626" />
                    <Text className="text-xs font-semibold text-red-700">Discard</Text>
                  </Pressable>

                  <Pressable
                    disabled={resumeMutation.isPending || discardMutation.isPending}
                    onPress={() => resumeMutation.mutate(item.id)}
                    className="flex-row items-center gap-1.5 rounded-xl bg-brand-700 px-4 py-2 active:bg-brand-800"
                  >
                    <Feather name="play-circle" size={15} color="#FFFFFF" />
                    <Text className="text-xs font-bold text-white">
                      {resumeMutation.isPending ? 'Resuming…' : 'Resume Cart'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}
            ListEmptyComponent={
              <EmptyState
                title="No parked sales"
                message="Park active orders using the Hold button on POS to resume them later."
              />
            }
          />
        )}
      </View>
    </Screen>
  );
}
