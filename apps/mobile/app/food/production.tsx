import React, { useState } from 'react';
import { appAlert } from '@/providers/ios-alert';
import { View, Text, ScrollView, Pressable, ActivityIndicator, TextInput } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';
import { api } from '@/lib/api';
import { useBranchStore } from '@/store/branch';
import { useSession } from '@/providers/session';

export default function ProductionScreen() {
  const { currentUser } = useSession();
  const activeBranchId = useBranchStore((state) => state.activeBranch?.id);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [executing, setExecuting] = useState(false);

  const profile = currentUser?.organization?.businessProfile ?? (currentUser as any)?.businessProfile ?? 'retail';
  const isRetail = profile === 'retail';
  const titleText = isRetail ? 'Repacking' : 'Batch Production';
  const subtitleText = isRetail
    ? 'Repack bulk items into smaller units or packs and automatically update inventory balances'
    : 'Produce batches of preproduced products and automatically deduct required raw ingredients';

  const { data: preproducedItems, isLoading } = useQuery({
    queryKey: ['food-production-items', activeBranchId],
    queryFn: async () => {
      const res = await api<any[]>(
        `/products?preparationBehavior=preproduced&branchId=${activeBranchId || ''}`,
      );
      return Array.isArray(res) ? res : (res as any)?.data ?? [];
    },
  });

  const selectedProduct = preproducedItems?.find((p: any) => p.id === selectedProductId);

  const handleExecuteProduction = async () => {
    if (!selectedProductId || !activeBranchId) {
      appAlert('Error', 'Select a product and active branch');
      return;
    }
    const qty = parseFloat(quantity);
    if (!qty || qty <= 0) {
      appAlert('Error', 'Enter a valid quantity');
      return;
    }

    setExecuting(true);
    try {
      await api('/inventory/production', {
        method: 'POST',
        body: JSON.stringify({
          branchId: activeBranchId,
          outputProductId: selectedProductId,
          quantityProduced: qty,
        }),
      });
      appAlert('Success', `Successfully ${isRetail ? 'repacked' : 'produced'} ${qty} ${selectedProduct?.unit || 'units'} of ${selectedProduct?.name}!`);
      setQuantity('1');
      setSelectedProductId(null);
    } catch (err: any) {
      appAlert(`${titleText} Error`, err.message || 'Operation failed');
    } finally {
      setExecuting(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-slate-50 dark:bg-slate-950 p-4 sm:p-6">
      <View className="max-w-2xl mx-auto w-full gap-6">
        <View className="border-b border-slate-200 dark:border-slate-800 pb-4">
          <Text className="text-2xl font-bold text-slate-900 dark:text-white">{titleText}</Text>
          <Text className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {subtitleText}
          </Text>
        </View>

        {isLoading ? (
          <ActivityIndicator size="large" color="#059669" />
        ) : (
          <View className="gap-4">
            <Text className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              {isRetail ? 'Select Item to Repack:' : 'Select Preproduced Item to Produce:'}
            </Text>
            <View className="gap-2">
              {preproducedItems?.map((item: any) => {
                const isSelected = selectedProductId === item.id;
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => setSelectedProductId(item.id)}
                    className={`p-4 rounded-xl border flex-row items-center justify-between ${
                      isSelected
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <View>
                      <Text className="text-base font-semibold text-slate-900 dark:text-white">
                        {item.name}
                      </Text>
                      <Text className="text-xs text-slate-500">
                        Available: {item.availableQuantity ?? '0'} {item.unit}
                      </Text>
                    </View>
                    {isSelected && <Feather name="check-circle" size={18} color="#059669" />}
                  </Pressable>
                );
              })}
            </View>

            {selectedProduct && (
              <View className="gap-4 bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                <Text className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {isRetail ? 'Repack Quantity' : 'Production Quantity'} ({selectedProduct.unit})
                </Text>
                <TextInput
                  value={quantity}
                  onChangeText={setQuantity}
                  keyboardType="decimal-pad"
                  placeholder="Enter batch quantity"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-slate-900 dark:text-white"
                />

                <Pressable
                  onPress={handleExecuteProduction}
                  disabled={executing}
                  className="mt-2 rounded-xl bg-emerald-600 px-6 py-3 items-center justify-center shadow-sm active:bg-emerald-700"
                >
                  {executing ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text className="text-sm font-bold text-white">
                      {isRetail ? 'Confirm Repacking Batch' : 'Confirm Batch Production'}
                    </Text>
                  )}
                </Pressable>
              </View>
            )}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
