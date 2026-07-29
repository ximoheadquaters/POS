import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { Button, Header, Screen } from '@/components/ui';
import {
  getOfflineSales,
  removeOfflineSale,
  retryOfflineSale,
  syncOfflineSales,
  type QueuedCheckout,
} from '@/lib/offline-sales';
import { getOfflineSnapshot } from '@/lib/offline-snapshot';
import { formatMoney } from '@/lib/format';
import { useBranchStore } from '@/store/branch';
import { useConnectivityStore } from '@/store/connectivity';

function OfflineSyncContent() {
  const branch = useBranchStore((state) => state.activeBranch);
  const isOnline = useConnectivityStore((state) => state.isOnline);
  const setOfflineQueue = useConnectivityStore((state) => state.setOfflineQueue);
  const [queue, setQueue] = useState<QueuedCheckout[]>([]);
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const refresh = useCallback(async () => {
    const [sales, snapshot] = await Promise.all([
      getOfflineSales(),
      getOfflineSnapshot(branch?.id),
    ]);
    setQueue(sales);
    setOfflineQueue(sales);
    setSnapshotAt(snapshot?.syncedAt ?? null);
  }, [branch?.id, setOfflineQueue]);
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );
  const sync = async () => {
    setSyncing(true);
    try {
      const result = await syncOfflineSales();
      await refresh();
      Alert.alert(
        'Synchronization finished',
        `${result.synced} synced · ${result.pending} pending · ${result.failed} need attention`,
      );
    } finally {
      setSyncing(false);
    }
  };
  return (
    <Screen>
      <Header
        title="Offline synchronization"
        subtitle={isOnline ? 'Connected' : 'Offline'}
        showBack
        backLabel="More"
        fallbackHref="/(tabs)/more"
      />
      <View className="border-b border-slate-200 bg-white p-4">
        <View className="mx-auto w-full max-w-[720px] rounded-2xl bg-brand-50 p-4">
          <View className="flex-row items-center">
            <Feather name={isOnline ? 'wifi' : 'wifi-off'} size={20} color="#1A593B" />
            <View className="ml-3 flex-1">
              <Text className="font-medium text-brand-900">
                {isOnline ? 'Online and ready to sync' : 'Working from saved branch data'}
              </Text>
              <Text className="mt-1 text-xs text-slate-600">
                Branch snapshot:{' '}
                {snapshotAt ? new Date(snapshotAt).toLocaleString() : 'not downloaded yet'}
              </Text>
            </View>
          </View>
          <View className="mt-4">
            <Button
              title={syncing ? 'Synchronizing…' : 'Sync now'}
              disabled={!isOnline || syncing || !queue.some((sale) => sale.status !== 'failed')}
              onPress={() => void sync()}
            />
          </View>
        </View>
      </View>
      <FlatList
        data={queue}
        keyExtractor={(item) => item.id}
        contentContainerClassName="mx-auto w-full max-w-[720px] gap-2 p-4 pb-12"
        ListEmptyComponent={
          <View className="items-center py-16">
            <Feather name="check-circle" size={38} color="#1A593B" />
            <Text className="mt-3 font-medium text-slate-800">Everything is synchronized</Text>
            <Text className="mt-1 text-sm text-slate-500">There are no offline sales waiting.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View
            className={`rounded-2xl border bg-white p-4 ${
              item.status === 'failed' ? 'border-red-200' : 'border-slate-100'
            }`}
          >
            <View className="flex-row justify-between">
              <View>
                <Text className="font-medium text-slate-900">
                  {item.status === 'failed' ? 'Needs attention' : 'Waiting to sync'}
                </Text>
                <Text className="mt-1 text-xs text-slate-500">
                  {new Date(item.createdAt).toLocaleString()} · {item.attempts ?? 0} attempts
                </Text>
              </View>
              <Text className="font-semibold text-brand-700">{formatMoney(item.total)}</Text>
            </View>
            {item.lastError ? (
              <Text className="mt-3 rounded-xl bg-red-50 p-3 text-xs leading-5 text-red-700">
                {item.lastError}
              </Text>
            ) : null}
            {item.status === 'failed' ? (
              <View className="mt-3 flex-row gap-2">
                <Pressable
                  onPress={() => void retryOfflineSale(item.id).then(refresh)}
                  className="min-h-10 flex-1 items-center justify-center rounded-xl bg-brand-50"
                >
                  <Text className="font-medium text-brand-700">Retry</Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    Alert.alert(
                      'Remove unsynced sale?',
                      'Only remove it after confirming the transaction should not be recorded.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Remove',
                          style: 'destructive',
                          onPress: () => void removeOfflineSale(item.id).then(refresh),
                        },
                      ],
                    )
                  }
                  className="min-h-10 flex-1 items-center justify-center rounded-xl bg-red-50"
                >
                  <Text className="font-medium text-red-700">Remove</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        )}
      />
    </Screen>
  );
}

export default function OfflineSyncScreen() {
  return (
    <AppSidebarProvider>
      <OfflineSyncContent />
    </AppSidebarProvider>
  );
}
