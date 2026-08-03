import React from 'react';
import { View, Text, FlatList, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';
import { api } from '@/lib/api';
import { useBranchStore } from '@/store/branch';

export default function ParkedSalesScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const activeBranchId = useBranchStore((state) => state.activeBranch?.id);

  const { data: sales, isLoading, refetch } = useQuery({
    queryKey: ['food-parked-sales', activeBranchId],
    queryFn: async () => {
      const res = await api<any[]>(
        `/sales/held?branchId=${activeBranchId || ''}`,
      );
      return Array.isArray(res) ? res : (res as any)?.data ?? [];
    },
  });

  const resumeMutation = useMutation({
    mutationFn: async (id: string) => {
      return api(`/sales/held/${id}/resume`, { method: 'POST' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['food-parked-sales'] });
      Alert.alert('Success', 'Cart restored to active checkout session');
      router.push('/(tabs)/pos' as any);
    },
    onError: (err: any) => {
      Alert.alert('Error', err.message || 'Failed to resume held sale');
    },
  });

  const discardMutation = useMutation({
    mutationFn: async (id: string) => {
      return api(`/sales/held/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['food-parked-sales'] });
      Alert.alert('Success', 'Parked sale discarded');
    },
  });

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-950 p-4 sm:p-6">
      <View className="border-b border-slate-200 dark:border-slate-800 pb-4 mb-6">
        <Text className="text-2xl font-bold text-slate-900 dark:text-white">Parked Sales</Text>
        <Text className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Active kitchen or table orders held for later checkout
        </Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#059669" />
        </View>
      ) : (
        <FlatList
          data={sales || []}
          keyExtractor={(item) => item.id}
          refreshing={isLoading}
          onRefresh={refetch}
          renderItem={({ item }) => (
            <View className="mb-3 p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex-row items-center justify-between">
              <View className="gap-1 flex-1">
                <Text className="text-base font-semibold text-slate-900 dark:text-white">
                  Order #{item.receiptNumber || item.id.substring(0, 8)}
                </Text>
                <Text className="text-xs text-slate-500">
                  Customer: {item.customerName || 'Walk-in'} • Held: {new Date(item.createdAt).toLocaleTimeString()}
                </Text>
                <Text className="text-sm font-bold text-emerald-700 dark:text-emerald-400 mt-1">
                  Total: ₱{item.totalAmount}
                </Text>
              </View>

              <View className="flex-row items-center gap-2">
                <Pressable
                  onPress={() => resumeMutation.mutate(item.id)}
                  className="bg-emerald-600 px-3 py-1.5 rounded-lg flex-row items-center gap-1 active:bg-emerald-700"
                >
                  <Feather name="play" size={14} color="#fff" />
                  <Text className="text-xs font-bold text-white">Resume</Text>
                </Pressable>
                <Pressable
                  onPress={() => discardMutation.mutate(item.id)}
                  className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 px-2.5 py-1.5 rounded-lg active:bg-red-100"
                >
                  <Feather name="trash-2" size={14} color="#ef4444" />
                </Pressable>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View className="p-8 items-center justify-center">
              <Text className="text-sm text-slate-500">No parked sales found.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}
