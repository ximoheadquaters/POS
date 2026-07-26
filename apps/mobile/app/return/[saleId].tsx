import { useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button, Field, Header, LoadingState, Screen } from '@/components/ui';
import { useBranchStore } from '@/store/branch';

interface Sale {
  id: string;
  receiptNumber: string;
  items: Array<{ id: string; productName: string; quantity: number; returnedQuantity: number }>;
}

export default function ReturnFormScreen() {
  const { saleId } = useLocalSearchParams<{ saleId: string }>();
  const branch = useBranchStore((state) => state.activeBranch)!;
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
          reason,
          refundMethod: 'cash',
          items: Object.entries(quantities)
            .filter(([, value]) => Number.parseInt(value, 10) > 0)
            .map(([saleItemId, value]) => ({ saleItemId, quantity: Number.parseInt(value, 10) })),
        }),
      }),
    onSuccess: () => {
      Alert.alert('Return completed', 'Inventory and refund records were updated.');
      router.replace(`/sale/${saleId}`);
    },
    onError: (error) => Alert.alert('Return failed', error.message),
  });
  if (query.isLoading)
    return (
      <Screen>
        <Header title="Return items" showBack backLabel="Receipt" />
        <LoadingState />
      </Screen>
    );
  return (
    <Screen>
      <Header title="Return items" subtitle={query.data?.receiptNumber} showBack backLabel="Receipt" />
      <ScrollView contentContainerClassName="p-5 pb-10">
        {query.data?.items.map((item) => {
          const remaining = item.quantity - item.returnedQuantity;
          return (
            <View key={item.id} className="mb-3 flex-row items-center rounded-2xl bg-white p-4">
              <View className="flex-1">
                <Text className="font-bold">{item.productName}</Text>
                <Text className="mt-1 text-sm text-slate-500">{remaining} available to return</Text>
              </View>
              <TextInput
                value={quantities[item.id] ?? ''}
                onChangeText={(value) => setQuantities((state) => ({ ...state, [item.id]: value }))}
                keyboardType="number-pad"
                placeholder="0"
                className="h-12 w-16 rounded-xl border border-slate-200 text-center text-lg"
              />
            </View>
          );
        })}
        <Field label="Return reason" value={reason} onChangeText={setReason} multiline />
        <Button
          title={mutation.isPending ? 'Processing…' : 'Refund to cash'}
          variant="danger"
          disabled={mutation.isPending || reason.trim().length < 3}
          onPress={() =>
            Alert.alert('Confirm refund?', 'This action is audited and cannot be deleted.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Refund', style: 'destructive', onPress: () => mutation.mutate() },
            ])
          }
        />
      </ScrollView>
    </Screen>
  );
}
