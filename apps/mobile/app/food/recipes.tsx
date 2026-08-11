import React from 'react';
import { View, Text, FlatList, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';
import { api } from '@/lib/api';
import { useBranchStore } from '@/store/branch';

export default function RecipesOverviewScreen() {
  const router = useRouter();
  const branch = useBranchStore((state) => state.activeBranch);

  const { data: items, isLoading, refetch } = useQuery({
    queryKey: ['food-recipes-overview', branch?.id],
    enabled: Boolean(branch),
    queryFn: async () => {
      const res = await api<any[]>(
        `/products?branchId=${branch!.id}&preparationBehavior=cook_to_order,preproduced`,
      );
      return Array.isArray(res) ? res : (res as any)?.data ?? [];
    },
  });

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-950 p-4 sm:p-6">
      <View className="flex-row items-center justify-between mb-6">
        <View>
          <Text className="text-2xl font-bold text-slate-900 dark:text-white">BOM Recipes</Text>
          <Text className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Bill of Materials recipes and ingredient costs for prepared items
          </Text>
        </View>
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
            <View className="mb-3 p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex-row items-center justify-between">
              <View className="gap-1 flex-1">
                <Text className="text-base font-semibold text-slate-900 dark:text-white">
                  {item.name}
                </Text>
                <Text className="text-xs text-slate-500 dark:text-slate-400">
                  Prep: {item.preparationBehavior === 'cook_to_order' ? 'Cook to Order' : 'Preproduced'} • Cost: ₱{item.averageCost || item.cost || '0.00'} • Price: ₱{item.sellingPrice}
                </Text>
              </View>
              <Pressable
                onPress={() => router.push(`/food/recipes/${item.id}` as any)}
                className="flex-row items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg active:bg-slate-200"
              >
                <Feather name="edit-3" size={14} color="#059669" />
                <Text className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                  {item.hasRecipe ? 'Edit Recipe' : 'Create Recipe'}
                </Text>
              </Pressable>
            </View>
          )}
          ListEmptyComponent={
            <View className="p-8 items-center justify-center">
              <Text className="text-sm text-slate-500">No recipe-eligible products found.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}
