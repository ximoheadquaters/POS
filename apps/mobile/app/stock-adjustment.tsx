import { Alert, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useBranchStore } from '@/store/branch';
import { Button, Field, Header, Screen } from '@/components/ui';

import { AppSidebarProvider } from '@/components/app-sidebar';

function StockAdjustmentContent() {
  const { productId, name, unit } = useLocalSearchParams<{
    productId: string;
    name: string;
    unit?: string;
  }>();
  const branch = useBranchStore((state) => state.activeBranch);
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      api('/inventory/adjustments', {
        method: 'POST',
        body: JSON.stringify({
          branchId: branch!.id,
          productId,
          quantityDelta: Number(quantity.replace(',', '.')),
          reason,
        }),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['inventory', branch?.id] });
      router.back();
    },
    onError: (error) => Alert.alert('Adjustment failed', error.message),
  });
  const commonDeductionReasons = ['Waste', 'Spillage', 'Staff consumption', 'Expired'];
  return (
    <Screen>
      <Header
        title="Stock adjustment"
        subtitle={`${name} · ${unit ?? 'unit'}`}
        showBack
        backLabel="Inventory"
        fallbackHref="/(tabs)/inventory"
      />
      <View className="p-5">
        <Field
          label="Quantity change"
          placeholder="Use a negative number to deduct"
          keyboardType="numbers-and-punctuation"
          value={quantity}
          onChangeText={setQuantity}
        />
        <Field label="Reason" value={reason} onChangeText={setReason} multiline />
        <View className="mb-5 flex-row flex-wrap gap-2">
          {commonDeductionReasons.map((item) => (
            <Pressable
              key={item}
              accessibilityRole="button"
              onPress={() => setReason(item)}
              className={`min-h-10 items-center justify-center rounded-full border px-4 ${
                reason === item ? 'border-brand-700 bg-brand-700' : 'border-slate-200 bg-white'
              }`}
            >
              <Text
                className={`text-xs font-medium ${reason === item ? 'text-white' : 'text-slate-700'}`}
              >
                {item}
              </Text>
            </Pressable>
          ))}
        </View>
        <Button
          title={mutation.isPending ? 'Saving…' : 'Save adjustment'}
          disabled={mutation.isPending || !quantity || reason.trim().length < 3}
          onPress={() =>
            Alert.alert('Confirm adjustment?', `${quantity} units · ${reason}`, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Adjust', onPress: () => mutation.mutate() },
            ])
          }
        />
      </View>
    </Screen>
  );
}

export default function StockAdjustmentScreen() {
  return (
    <AppSidebarProvider>
      <StockAdjustmentContent />
    </AppSidebarProvider>
  );
}
