import React from 'react';
import { View, Text, FlatList, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';
import { api } from '@/lib/api';
import { useBranchStore } from '@/store/branch';

export default function MenuItemsScreen() {
  const router = useRouter();
  const activeBranchId = useBranchStore((state) => state.activeBranch?.id);

  const { data: items, isLoading, refetch } = useQuery({
    queryKey: ['food-menu-items', activeBranchId],
    queryFn: async () => {
      const res = await api<any[]>(
        `/products?preparationBehavior=cook_to_order,preproduced&branchId=${activeBranchId || ''}`,
      );
      return Array.isArray(res) ? res : (res as any)?.data ?? [];
    },
  });

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-950 p-4 sm:p-6">
      <View className="flex-row items-center justify-between mb-6">
        <View>
          <Text className="text-2xl font-bold text-slate-900 dark:text-white">Menu Items</Text>
          <Text className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Cook-to-order and preproduced items offered to customers
          </Text>
        </View>
        <Pressable
          onPress={() => router.push('/food/menu-items/new' as any)}
          className="flex-row items-center gap-2 bg-emerald-600 px-4 py-2.5 rounded-xl active:bg-emerald-700 shadow-sm"
        >
          <Feather name="plus" size={16} color="#fff" />
          <Text className="text-xs font-bold text-white">Add Menu Item</Text>
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
              onPress={() => router.push(`/food/menu-items/${item.id}` as any)}
              className="mb-3 p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex-row items-center justify-between"
            >
              <View className="gap-1 flex-1">
                <View className="flex-row items-center gap-2">
                  <Text className="text-base font-semibold text-slate-900 dark:text-white">
                    {item.name}
                  </Text>
                  <View
                    className={`px-2 py-0.5 rounded-full ${
                      item.preparationBehavior === 'cook_to_order'
                        ? 'bg-amber-100 dark:bg-amber-950'
                        : 'bg-emerald-100 dark:bg-emerald-950'
                    }`}
                  >
                    <Text
                      className={`text-[10px] font-bold uppercase ${
                        item.preparationBehavior === 'cook_to_order'
                          ? 'text-amber-800 dark:text-amber-300'
                          : 'text-emerald-800 dark:text-emerald-300'
                      }`}
                    >
                      {item.preparationBehavior === 'cook_to_order' ? 'Cook to Order' : 'Preproduced'}
                    </Text>
                  </View>
                </View>
                <Text className="text-xs text-slate-500 dark:text-slate-400">
                  Cost: ₱{item.averageCost || item.cost || '0.00'} • Category: {item.categoryName || 'General'}
                </Text>
              </View>
              <View className="items-end gap-1">
                <Text className="text-base font-bold text-emerald-700 dark:text-emerald-400">
                  ₱{item.sellingPrice}
                </Text>
                {item.hasRecipe ? (
                  <View className="flex-row items-center gap-1">
                    <Feather name="check-circle" size={12} color="#059669" />
                    <Text className="text-[10px] font-semibold text-emerald-600">Has Recipe</Text>
                  </View>
                ) : (
                  <Text className="text-[10px] text-slate-400">No Recipe</Text>
                )}
              </View>
            </Pressable>
          )}
          ListEmptyComponent={
            <View className="p-8 items-center justify-center">
              <Text className="text-sm text-slate-500">No menu items found.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}
