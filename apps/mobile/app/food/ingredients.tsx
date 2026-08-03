import React from 'react';
import { View, Text, FlatList, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';
import { api } from '@/lib/api';
import { useBranchStore } from '@/store/branch';

export default function IngredientsScreen() {
  const router = useRouter();
  const activeBranchId = useBranchStore((state) => state.activeBranch?.id);

  const { data: items, isLoading, refetch } = useQuery({
    queryKey: ['food-ingredients', activeBranchId],
    queryFn: async () => {
      const res = await api<any[]>(
        `/products?inventoryRole=ingredient,both&branchId=${activeBranchId || ''}`,
      );
      return Array.isArray(res) ? res : (res as any)?.data ?? [];
    },
  });

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-950 p-4 sm:p-6">
      <View className="flex-row items-center justify-between mb-6">
        <View>
          <Text className="text-2xl font-bold text-slate-900 dark:text-white">Raw Ingredients</Text>
          <Text className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Raw materials used in kitchen recipes and batch production
          </Text>
        </View>
        <Pressable
          onPress={() => router.push('/food/ingredients/new' as any)}
          className="flex-row items-center gap-2 bg-emerald-600 px-4 py-2.5 rounded-xl active:bg-emerald-700 shadow-sm"
        >
          <Feather name="plus" size={16} color="#fff" />
          <Text className="text-xs font-bold text-white">Add Ingredient</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#059669" />
        </View>
      ) : (
        <FlatList
          data={items || []}
          keyExtractor={(item) => item.id}
          refreshing={isLoading}
          onRefresh={refetch}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/food/ingredients/${item.id}` as any)}
              className="mb-3 p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex-row items-center justify-between"
            >
              <View className="gap-1 flex-1">
                <View className="flex-row items-center gap-2">
                  <Text className="text-base font-semibold text-slate-900 dark:text-white">
                    {item.name}
                  </Text>
                  <View className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800">
                    <Text className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase">
                      {item.unit}
                    </Text>
                  </View>
                </View>
                <Text className="text-xs text-slate-500 dark:text-slate-400">
                  Cost per {item.unit}: ₱{item.cost}
                </Text>
              </View>
              <View className="items-end gap-1">
                <Text className="text-sm font-bold text-slate-900 dark:text-white">
                  {item.availableQuantity !== null && item.availableQuantity !== undefined ? item.availableQuantity : '—'} {item.unit}
                </Text>
                <Text className="text-[10px] text-slate-500">In Stock</Text>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={
            <View className="p-8 items-center justify-center">
              <Text className="text-sm text-slate-500">No raw ingredients found.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}
