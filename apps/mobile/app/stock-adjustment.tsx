import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useBranchStore } from '@/store/branch';
import { Button, Field, Header, Screen } from '@/components/ui';

export default function StockAdjustmentScreen() {
  const { productId, name } = useLocalSearchParams<{ productId: string; name: string }>();
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
          quantityDelta: Number.parseInt(quantity, 10),
          reason,
        }),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['inventory', branch?.id] });
      router.back();
    },
    onError: (error) => Alert.alert('Adjustment failed', error.message),
  });
  return (
    <Screen>
      <Header
        title="Stock adjustment"
        subtitle={name}
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
