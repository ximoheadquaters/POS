import { useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { Button, EmptyState, ErrorState, Field, Header, LoadingState, Screen } from '@/components/ui';
import { useBranchStore } from '@/store/branch';
import { useShiftStore } from '@/store/shift';

interface Register {
  id: string;
  name: string;
  code: string;
  activeShiftId?: string;
  activeCashierId?: string;
}

interface ClosedShift {
  expectedCash: string;
  actualCash: string;
  variance: string;
}

export default function RegistersScreen() {
  const branch = useBranchStore((state) => state.activeBranch)!;
  const shift = useShiftStore((state) => state.activeShift);
  const hydrate = useShiftStore((state) => state.hydrate);
  const setActive = useShiftStore((state) => state.setActive);
  const clear = useShiftStore((state) => state.clear);
  const [startingCash, setStartingCash] = useState('0.00');
  const [actualCash, setActualCash] = useState('');
  const client = useQueryClient();
  useEffect(() => void hydrate(), [hydrate]);
  const query = useQuery({
    queryKey: ['registers', branch.id],
    queryFn: () => api<Register[]>(`/registers?branchId=${branch.id}`),
  });
  const open = useMutation({
    mutationFn: (register: Register) =>
      api<{ id: string }>('/registers/shifts/open', {
        method: 'POST',
        body: JSON.stringify({ branchId: branch.id, registerId: register.id, startingCash }),
      }).then(async (opened) => {
        await setActive({
          id: opened.id,
          registerId: register.id,
          registerName: register.name,
          branchId: branch.id,
        });
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['registers', branch.id] }),
    onError: (error) => Alert.alert('Could not open shift', error.message),
  });
  const close = useMutation({
    mutationFn: () =>
      api<ClosedShift>(`/registers/shifts/${shift!.id}/close`, {
        method: 'POST',
        body: JSON.stringify({ actualCash }),
      }),
    onSuccess: async (closed) => {
      await clear();
      setActualCash('');
      await client.invalidateQueries({ queryKey: ['registers', branch.id] });
      Alert.alert(
        'Shift closed',
        `Expected ${formatMoney(closed.expectedCash)}\nCounted ${formatMoney(closed.actualCash)}\nVariance ${formatMoney(closed.variance)}`,
      );
    },
    onError: (error) => Alert.alert('Could not close shift', error.message),
  });
  return (
    <Screen>
      <Header
        title="Registers & shifts"
        subtitle={branch.name}
        showBack
        backLabel="More"
        fallbackHref="/(tabs)/more"
      />
      {shift ? (
        <View className="m-4 rounded-3xl border border-brand-100 bg-white p-5">
          <View className="mb-4 flex-row items-center justify-between">
            <View className="flex-1">
              <Text className="text-xs font-bold uppercase tracking-wider text-brand-500">
                Active shift
              </Text>
              <Text className="mt-1 text-xl font-black text-brand-900">{shift.registerName}</Text>
            </View>
            <Text className="rounded-full bg-brand-50 px-3 py-2 text-xs font-bold text-brand-700">
              Open
            </Text>
          </View>
          <Text className="mb-4 leading-5 text-slate-500">
            At the end of your duty, count the physical cash in the drawer. Ximo will calculate the
            expected amount and any difference.
          </Text>
          <Field
            label="Counted cash in drawer"
            value={actualCash}
            onChangeText={setActualCash}
            keyboardType="decimal-pad"
            placeholder="0.00"
          />
          <Button
            title={close.isPending ? 'Closing…' : 'Close shift'}
            variant="danger"
            disabled={!actualCash || close.isPending}
            onPress={() =>
              Alert.alert(
                'Close shift?',
                'Expected cash and shortage/overage will be calculated.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Close shift', style: 'destructive', onPress: () => close.mutate() },
                ],
              )
            }
          />
        </View>
      ) : (
        <View className="px-4 pt-4">
          <View className="mb-4 rounded-2xl bg-brand-50 p-4">
            <Text className="font-bold text-brand-900">Open a shift before selling</Text>
            <Text className="mt-1 leading-5 text-slate-600">
              Enter the cash already in the drawer, then choose an available register below.
            </Text>
          </View>
          <Field
            label="Starting cash in drawer"
            value={startingCash}
            onChangeText={setStartingCash}
            keyboardType="decimal-pad"
            placeholder="0.00"
          />
        </View>
      )}
      {query.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState message={query.error.message} retry={() => void query.refetch()} />
      ) : (
        <FlatList
          data={query.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerClassName="p-4 gap-3"
          ListEmptyComponent={
            <EmptyState
              title="No registers"
              message="Ask an administrator to create a register for this branch."
            />
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{
                disabled: Boolean(shift || item.activeShiftId || open.isPending),
              }}
              disabled={Boolean(shift || item.activeShiftId || open.isPending)}
              className={`min-h-20 flex-row items-center rounded-2xl border border-slate-100 bg-white p-5 ${shift || item.activeShiftId || open.isPending ? 'opacity-50' : 'active:border-brand-300 active:bg-brand-50'}`}
              onPress={() => open.mutate(item)}
            >
              <View className="flex-1">
                <Text className="font-bold text-slate-900">{item.name}</Text>
                <Text className="mt-1 text-sm text-slate-500">
                  {item.activeShiftId ? 'Currently in use' : `${item.code} · Tap to open`}
                </Text>
              </View>
              <Text className="text-2xl font-bold text-brand-700">{'\u203A'}</Text>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}
