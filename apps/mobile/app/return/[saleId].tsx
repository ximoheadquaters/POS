import { useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';
import { minorToMoney, moneyToMinor } from '@ximo/shared';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { Button, Field, Header, LoadingState, Screen } from '@/components/ui';
import { useBranchStore } from '@/store/branch';
import { useShiftStore } from '@/store/shift';

interface SaleItem {
  id: string;
  productName: string;
  unit?: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  returnedQuantity: number;
}

interface Sale {
  id: string;
  receiptNumber: string;
  items: SaleItem[];
}

import { AppSidebarProvider } from '@/components/app-sidebar';

function ReturnFormContent() {
  const { saleId } = useLocalSearchParams<{ saleId: string }>();
  const branch = useBranchStore((state) => state.activeBranch)!;
  const shift = useShiftStore((state) => state.activeShift);
  const [reason, setReason] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});

  const query = useQuery({
    queryKey: ['sale', saleId],
    queryFn: () => api<Sale>(`/sales/${saleId}`),
  });

  const mutation = useMutation({
    mutationFn: () =>
      api(`/returns/sales/${saleId}`, {
        method: 'POST',
        body: JSON.stringify({
          branchId: branch.id,
          registerId: shift!.registerId,
          shiftId: shift!.id,
          reason,
          refundMethod: 'cash',
          items: Object.entries(quantities)
            .filter(([, value]) => Number(value.replace(',', '.')) > 0)
            .map(([saleItemId, value]) => ({
              saleItemId,
              quantity: Number(value.replace(',', '.')),
            })),
        }),
      }),
    onSuccess: () => {
      Alert.alert('Return completed', 'Inventory and refund records were updated.');
      router.replace(`/sale/${saleId}`);
    },
    onError: (error) => Alert.alert('Return failed', error.message),
  });

  const handleQuantityChange = (itemId: string, newQty: number, maxQty: number) => {
    const clamped = Math.max(0, Math.min(maxQty, newQty));
    setQuantities((prev) => ({
      ...prev,
      [itemId]: clamped > 0 ? String(clamped) : '',
    }));
  };

  const calculateTotalRefund = (): string => {
    if (!query.data) return '0.00';
    let totalMinor = 0n;
    for (const item of query.data.items) {
      const qtyStr = quantities[item.id] ?? '0';
      const qty = parseFloat(qtyStr.replace(',', '.')) || 0;
      if (qty > 0) {
        const unitPriceMinor = moneyToMinor(item.unitPrice);
        const qtyMinor = BigInt(Math.round(qty * 100));
        totalMinor += (qtyMinor * unitPriceMinor) / 100n;
      }
    }
    return minorToMoney(totalMinor);
  };

  const totalRefund = calculateTotalRefund();
  const hasItemsToReturn = Object.values(quantities).some(
    (val) => (parseFloat(val.replace(',', '.')) || 0) > 0,
  );

  if (query.isLoading)
    return (
      <Screen>
        <Header title="Return items" showBack backLabel="Receipt" />
        <LoadingState />
      </Screen>
    );

  return (
    <Screen>
      <Header
        title="Return items"
        subtitle={query.data?.receiptNumber}
        showBack
        backLabel="Receipt"
      />
      <ScrollView contentContainerClassName="p-5 pb-10">
        {!shift ? (
          <View className="mb-4 rounded-2xl bg-brand-50 p-4">
            <Text className="font-semibold text-brand-900">An open shift is required</Text>
            <Text className="mt-1 text-sm text-slate-600">
              Open a register shift to issue a cash refund.
            </Text>
            <Pressable
              onPress={() => router.push('/registers')}
              className="mt-3 min-h-10 items-center justify-center rounded-xl bg-brand-700 px-4 active:bg-brand-800"
            >
              <Text className="text-sm font-semibold text-white">Open registers & shifts</Text>
            </Pressable>
          </View>
        ) : null}

        <View className="gap-3">
          {query.data?.items.map((item) => {
            const remaining = item.quantity - item.returnedQuantity;
            const currentQtyNum = parseFloat((quantities[item.id] ?? '0').replace(',', '.')) || 0;
            const disabled = remaining <= 0;

            return (
              <View
                key={item.id}
                className={`rounded-2xl border border-slate-100 bg-white p-4 ${
                  disabled ? 'opacity-60' : ''
                }`}
              >
                <View className="flex-row items-start justify-between">
                  <View className="flex-1 pr-3">
                    <Text className="text-base font-bold text-slate-900">{item.productName}</Text>
                    <Text className="mt-1 text-xs text-slate-500">
                      {formatMoney(item.unitPrice)} each · {item.quantity} originally purchased
                      {item.returnedQuantity ? ` (${item.returnedQuantity} returned)` : ''}
                    </Text>
                    <Text className="mt-1 text-xs font-medium text-brand-700">
                      {remaining > 0
                        ? `${remaining} ${item.unit ?? 'unit'}${remaining > 1 ? 's' : ''} available to return`
                        : 'Fully returned'}
                    </Text>
                  </View>
                  <Text className="text-base font-bold text-slate-900">
                    {formatMoney(item.lineTotal)}
                  </Text>
                </View>

                {remaining > 0 ? (
                  <View className="mt-4 flex-row items-center border-t border-slate-100 pt-3">
                    <Text className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Return qty:
                    </Text>

                    <View className="ml-auto flex-row items-center gap-2">
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Decrease return quantity for ${item.productName}`}
                        disabled={currentQtyNum <= 0}
                        onPress={() => handleQuantityChange(item.id, currentQtyNum - 1, remaining)}
                        className="h-10 w-10 items-center justify-center rounded-xl bg-slate-100 active:bg-slate-200 disabled:opacity-30"
                      >
                        <Feather name="minus" size={16} color="#334155" />
                      </Pressable>

                      <TextInput
                        value={quantities[item.id] ?? ''}
                        onChangeText={(val) => {
                          const parsed = parseFloat(val.replace(',', '.')) || 0;
                          handleQuantityChange(item.id, parsed, remaining);
                        }}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        className="h-10 w-16 rounded-xl border border-slate-200 text-center text-base font-bold text-slate-900"
                      />

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Increase return quantity for ${item.productName}`}
                        disabled={currentQtyNum >= remaining}
                        onPress={() => handleQuantityChange(item.id, currentQtyNum + 1, remaining)}
                        className="h-10 w-10 items-center justify-center rounded-xl bg-brand-100 active:bg-brand-200 disabled:opacity-30"
                      >
                        <Feather name="plus" size={16} color="#1A593B" />
                      </Pressable>

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Select all remaining for ${item.productName}`}
                        onPress={() => handleQuantityChange(item.id, remaining, remaining)}
                        className="ml-1 rounded-xl bg-slate-100 px-3 py-2.5 active:bg-slate-200"
                      >
                        <Text className="text-xs font-bold text-slate-700">Max</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>

        <View className="mt-5 rounded-2xl bg-white p-4">
          <Field
            label="Return reason"
            value={reason}
            onChangeText={setReason}
            placeholder="Reason for return (e.g., damaged item, wrong size, customer request)"
            multiline
          />
        </View>

        <View className="mt-5 rounded-2xl bg-brand-50 p-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-base font-medium text-brand-900">Total Refund Amount</Text>
            <Text className="text-2xl font-bold text-brand-700">{formatMoney(totalRefund)}</Text>
          </View>
        </View>

        <View className="mt-5">
          <Button
            title={mutation.isPending ? 'Processing refund…' : `Refund ${formatMoney(totalRefund)} to cash`}
            variant="danger"
            disabled={!shift || mutation.isPending || !hasItemsToReturn || reason.trim().length < 3}
            onPress={() => {
              const confirmMsg = `Refund ${formatMoney(totalRefund)} to cash for ${query.data?.receiptNumber}?`;
              if (Platform.OS === 'web' || typeof window !== 'undefined') {
                if (window.confirm(confirmMsg)) {
                  mutation.mutate();
                }
              } else {
                Alert.alert('Confirm refund?', confirmMsg, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Refund', style: 'destructive', onPress: () => mutation.mutate() },
                ]);
              }
            }}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

export default function ReturnFormScreen() {
  return (
    <AppSidebarProvider>
      <ReturnFormContent />
    </AppSidebarProvider>
  );
}
