import { useEffect, useState } from 'react';
import { appAlert } from '@/providers/ios-alert';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { minorToMoney, moneyToMinor } from '@ximo/shared';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { Button, EmptyState, ErrorState, Field, Header, LoadingState, Screen } from '@/components/ui';
import { useBranchStore } from '@/store/branch';
import { useShiftStore } from '@/store/shift';
import { useSession } from '@/providers/session';
import { useConnectivityStore } from '@/store/connectivity';

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

interface ActiveShiftDetail {
  id: string;
  status: string;
  openedAt: string;
  startingCash: string;
  cashSales: string;
  cashRefunds: string;
  cashIn: string;
  cashOut: string;
  transactions: number;
}

function validMoney(value: string) {
  return /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(value.trim());
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
      {children}
    </Text>
  );
}

import { AppSidebarProvider } from '@/components/app-sidebar';

function RegistersContent() {
  const { currentUser } = useSession();
  const branch = useBranchStore((state) => state.activeBranch);
  const branchHydrated = useBranchStore((state) => state.hydrated);
  const hydrateBranch = useBranchStore((state) => state.hydrate);
  const selectBranch = useBranchStore((state) => state.select);
  const shift = useShiftStore((state) => state.activeShift);
  const hydrate = useShiftStore((state) => state.hydrate);
  const setActive = useShiftStore((state) => state.setActive);
  const clear = useShiftStore((state) => state.clear);
  const pendingOfflineSales = useConnectivityStore((state) => state.pendingSales);
  const failedOfflineSales = useConnectivityStore((state) => state.failedSales);
  const [startingCash, setStartingCash] = useState('0.00');
  const [actualCash, setActualCash] = useState('');
  const [movementType, setMovementType] = useState<'cash_in' | 'cash_out'>('cash_in');
  const [movementAmount, setMovementAmount] = useState('');
  const [movementReason, setMovementReason] = useState('');
  const [closeReviewOpen, setCloseReviewOpen] = useState(false);
  const [addCounterOpen, setAddCounterOpen] = useState(false);
  const [counterName, setCounterName] = useState('');
  const [counterCode, setCounterCode] = useState('');
  const client = useQueryClient();

  const canManageRegisters =
    Boolean(currentUser?.permissions?.includes('registers:manage')) ||
    ['owner', 'administrator', 'manager'].includes(currentUser?.role ?? '');

  useEffect(() => void hydrateBranch(), [hydrateBranch]);
  useEffect(() => void hydrate(), [hydrate]);

  // Auto-select the first branch if none is set
  useEffect(() => {
    if (!branchHydrated || branch) return;
    if (currentUser?.branches && currentUser.branches.length > 0) {
      void selectBranch(currentUser.branches[0]);
    }
  }, [branch, branchHydrated, currentUser, selectBranch]);

  const query = useQuery({
    queryKey: ['registers', branch?.id],
    queryFn: () => {
      if (!branch) throw new Error('Select a branch before opening registers.');
      return api<Register[]>(`/registers?branchId=${branch.id}`);
    },
    enabled: Boolean(branch),
  });

  const shiftDetailQuery = useQuery({
    queryKey: ['shift-report', shift?.id],
    queryFn: () => api<ActiveShiftDetail>(`/reports/shifts/${shift!.id}?branchId=${branch!.id}`),
    enabled: Boolean(shift?.id),
    refetchInterval: 5000,
  });

  const shiftDetail = shiftDetailQuery.data;
  const isModuleEnabled = currentUser?.modules.includes('registers');

  const refreshShiftData = async () => {
    if (!branch) return;
    await Promise.all([
      client.invalidateQueries({ queryKey: ['registers', branch.id] }),
      client.invalidateQueries({ queryKey: ['shift-report'] }),
      client.invalidateQueries({ queryKey: ['shift-reports'] }),
      client.invalidateQueries({ queryKey: ['reports'] }),
    ]);
  };

  const createRegister = useMutation({
    mutationFn: async () => {
      if (!branch) throw new Error('Select a branch before adding a counter.');
      const code = (counterCode.trim() || `CTR-${(query.data?.length ?? 0) + 1}`).toUpperCase();
      return api('/registers', {
        method: 'POST',
        body: JSON.stringify({
          branchId: branch.id,
          name: counterName.trim(),
          code,
        }),
      });
    },
    onSuccess: () => {
      setAddCounterOpen(false);
      setCounterName('');
      setCounterCode('');
      void refreshShiftData();
      appAlert('Counter added', 'New cashier counter has been created for this branch.');
    },
    onError: (error) => appAlert('Could not add counter', error.message),
  });

  useEffect(() => {
    if (!branch || !query.data || !currentUser) return;
    const activeRegister = query.data.find(
      (register) => register.activeShiftId && register.activeCashierId === currentUser.id,
    );
    if (activeRegister?.activeShiftId) {
      if (shift?.id !== activeRegister.activeShiftId || shift.branchId !== branch.id) {
        void setActive({
          id: activeRegister.activeShiftId,
          registerId: activeRegister.id,
          registerName: activeRegister.name,
          branchId: branch.id,
        });
      }
    } else if (shift?.branchId === branch.id) {
      void clear();
    }
  }, [branch, clear, currentUser, query.data, setActive, shift]);

  const open = useMutation({
    mutationFn: async (register: Register) => {
      if (!branch) throw new Error('Select a branch before opening a shift.');
      const opened = await api<{ id: string }>('/registers/shifts/open', {
        method: 'POST',
        body: JSON.stringify({
          branchId: branch.id,
          registerId: register.id,
          startingCash: startingCash.trim(),
        }),
      });
      await setActive({
        id: opened.id,
        registerId: register.id,
        registerName: register.name,
        branchId: branch.id,
      });
    },
    onSuccess: () => {
      void refreshShiftData();
      appAlert('Shift opened', 'You can now start accepting sales.');
    },
    onError: (error) => appAlert('Could not open shift', error.message),
  });

  const close = useMutation({
    mutationFn: () => {
      if (!shift) throw new Error('No active shift was found.');
      return api<ClosedShift>(`/registers/shifts/${shift.id}/close`, {
        method: 'POST',
        body: JSON.stringify({ actualCash: actualCash.trim() }),
      });
    },
    onSuccess: async (closed) => {
      setCloseReviewOpen(false);
      await clear();
      setActualCash('');
      await refreshShiftData();
      appAlert(
        'Shift closed',
        `Expected ${formatMoney(closed.expectedCash)}\nCounted ${formatMoney(closed.actualCash)}\nVariance ${formatMoney(closed.variance)}`,
      );
    },
    onError: (error) => appAlert('Could not close shift', error.message),
  });

  const cashMovement = useMutation({
    mutationFn: () => {
      if (!branch) throw new Error('Select a branch before recording cash movement.');
      if (!shift) throw new Error('No active shift was found.');
      return api('/registers/cash-movements', {
        method: 'POST',
        body: JSON.stringify({
          branchId: branch.id,
          shiftId: shift.id,
          type: movementType,
          amount: movementAmount.trim(),
          reason: movementReason.trim(),
        }),
      });
    },
    onSuccess: () => {
      setMovementAmount('');
      setMovementReason('');
      void refreshShiftData();
      appAlert(
        movementType === 'cash_in' ? 'Cash added' : 'Cash removed',
        'The drawer movement was recorded.',
      );
    },
    onError: (error) => appAlert('Could not record cash movement', error.message),
  });

  if (!isModuleEnabled) {
    return (
      <Screen>
        <Header title="Registers & Shifts" showBack backLabel="Back" />
        <View className="flex-1 items-center justify-center p-8">
          <View className="mb-4 h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 border border-amber-200">
            <Feather name="lock" size={26} color="#B45309" />
          </View>
          <Text className="text-xl font-bold text-slate-900">Module Access Disabled</Text>
          <Text className="mt-2 max-w-xs text-center text-xs text-slate-500 leading-relaxed">
            The Registers & Shifts module is disabled for your organization. Contact your administrator or store owner to enable register management.
          </Text>
          <View className="mt-6 w-full max-w-xs">
            <Button title="Return to POS" onPress={() => router.push('/(tabs)/pos')} />
          </View>
        </View>
      </Screen>
    );
  }

  const runningExpectedCash = shiftDetail
    ? minorToMoney(
        moneyToMinor(shiftDetail.startingCash) +
          moneyToMinor(shiftDetail.cashSales) +
          moneyToMinor(shiftDetail.cashIn) -
          moneyToMinor(shiftDetail.cashOut) -
          moneyToMinor(shiftDetail.cashRefunds),
      )
    : null;

  const offlineSales = pendingOfflineSales + failedOfflineSales;
  const countedCashValid = validMoney(actualCash);
  const startingCashValid = validMoney(startingCash);
  const movementValid =
    validMoney(movementAmount) && Number(movementAmount) > 0 && movementReason.trim().length >= 3;
  const closeDisabled = close.isPending || !countedCashValid || offlineSales > 0;

  if (!branch) {
    // Still hydrating or auto-selecting — show loading
    if (!branchHydrated || (currentUser?.branches && currentUser.branches.length > 0)) {
      return (
        <Screen>
          <Header
            title="Registers & shifts"
            subtitle="Loading…"
            showBack
            backLabel="More"
            fallbackHref="/(tabs)/more"
          />
          <LoadingState label="Setting up your branch…" />
        </Screen>
      );
    }
    return (
      <Screen>
        <Header
          title="Registers & shifts"
          subtitle="Branch required"
          showBack
          backLabel="More"
          fallbackHref="/(tabs)/more"
        />
        <View className="flex-1 p-4">
          <EmptyState
            title="No branches available"
            message="Ask an administrator to assign you to a branch."
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Header
        title="Registers & shifts"
        subtitle={branch.name}
        showBack
        backLabel="More"
        fallbackHref="/(tabs)/more"
      />

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="px-4 py-6 pb-12"
      >
        <View className="w-full max-w-3xl self-center">
          {shift ? (
            <>
              <SectionLabel>Active shift</SectionLabel>
              <View className="mb-7 overflow-hidden rounded-3xl border border-slate-200 bg-white">
                <View className="flex-row items-start justify-between p-5">
                  <View className="mr-4 flex-1 flex-row items-center">
                    <View className="mr-3 h-11 w-11 items-center justify-center rounded-2xl bg-brand-50">
                      <Feather name="briefcase" size={20} color="#1A593B" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-lg font-semibold text-slate-950">
                        {shift.registerName}
                      </Text>
                      <Text className="mt-1 text-sm leading-5 text-slate-500">
                        Count the drawer at the end of your duty. Ximo calculates the expected cash
                        and any difference.
                      </Text>
                    </View>
                  </View>
                  <View className="flex-row items-center rounded-full bg-emerald-50 px-3 py-2">
                    <View className="mr-2 h-2 w-2 rounded-full bg-emerald-600" />
                    <Text className="text-xs font-medium text-emerald-800">Open</Text>
                  </View>
                </View>

                {shiftDetail ? (
                  <View className="border-t border-slate-100 bg-slate-50/80 p-5">
                    <Text className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
                      Live Drawer Balance
                    </Text>
                    <View className="flex-row flex-wrap gap-2">
                      <View className="w-[48%] rounded-2xl border border-slate-200/60 bg-white p-3">
                        <Text className="text-xs text-slate-500">Starting cash</Text>
                        <Text className="mt-1 text-base font-semibold text-slate-900">
                          {formatMoney(shiftDetail.startingCash)}
                        </Text>
                      </View>
                      <View className="w-[48%] rounded-2xl border border-slate-200/60 bg-white p-3">
                        <Text className="text-xs text-slate-500">
                          Cash sales ({shiftDetail.transactions})
                        </Text>
                        <Text className="mt-1 text-base font-semibold text-emerald-700">
                          +{formatMoney(shiftDetail.cashSales)}
                        </Text>
                      </View>
                      <View className="w-[48%] rounded-2xl border border-slate-200/60 bg-white p-3">
                        <Text className="text-xs text-slate-500">Net cash moved</Text>
                        <Text className="mt-1 text-base font-semibold text-slate-900">
                          {formatMoney(
                            minorToMoney(
                              moneyToMinor(shiftDetail.cashIn) - moneyToMinor(shiftDetail.cashOut),
                            ),
                          )}
                        </Text>
                      </View>
                      <View className="w-[48%] rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
                        <Text className="text-xs font-medium text-emerald-800">
                          Live Expected Cash
                        </Text>
                        <Text className="mt-1 text-base font-bold text-emerald-900">
                          {formatMoney(runningExpectedCash ?? '0')}
                        </Text>
                      </View>
                    </View>
                  </View>
                ) : null}

                <View className="border-t border-slate-100 p-5">
                  <View className="mb-3 flex-row items-center">
                    <Feather name="repeat" size={15} color="#64748B" />
                    <Text className="ml-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
                      Cash movement
                    </Text>
                  </View>
                  <Text className="mb-4 text-sm leading-5 text-slate-500">
                    Record money added to or removed from the drawer outside of a sale.
                  </Text>

                  <View className="mb-5 flex-row rounded-xl bg-slate-100 p-1">
                    {(['cash_in', 'cash_out'] as const).map((type) => {
                      const selected = movementType === type;
                      const cashIn = type === 'cash_in';
                      return (
                        <Pressable
                          key={type}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          onPress={() => setMovementType(type)}
                          className={`min-h-11 flex-1 flex-row items-center justify-center rounded-lg ${
                            selected ? 'bg-brand-700' : ''
                          }`}
                        >
                          <Feather
                            name={cashIn ? 'arrow-down-left' : 'arrow-up-right'}
                            size={16}
                            color={selected ? '#FFFFFF' : '#64748B'}
                          />
                          <Text
                            className={`ml-2 text-sm font-medium ${
                              selected ? 'text-white' : 'text-slate-600'
                            }`}
                          >
                            {cashIn ? 'Cash in' : 'Cash out'}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <View className="md:flex-row md:gap-3">
                    <View className="md:flex-1">
                      <Field
                        label="Amount"
                        value={movementAmount}
                        onChangeText={setMovementAmount}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        error={
                          movementAmount && !validMoney(movementAmount)
                            ? 'Enter an amount with up to two decimal places.'
                            : undefined
                        }
                      />
                    </View>
                    <View className="md:flex-[2]">
                      <Field
                        label="Reason"
                        value={movementReason}
                        onChangeText={setMovementReason}
                        placeholder={
                          movementType === 'cash_in'
                            ? 'Example: Additional change fund'
                            : 'Example: Paid a delivery'
                        }
                      />
                    </View>
                  </View>
                  <Button
                    title={
                      cashMovement.isPending
                        ? 'Recording…'
                        : `Record ${movementType === 'cash_in' ? 'cash in' : 'cash out'}`
                    }
                    variant="secondary"
                    disabled={cashMovement.isPending || !movementValid}
                    onPress={() => cashMovement.mutate()}
                  />
                </View>
              </View>

              <SectionLabel>Close shift</SectionLabel>
              <View className="mb-7 rounded-3xl border border-slate-200 bg-white p-5">
                <View className="mb-4 flex-row items-start">
                  <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-slate-100">
                    <Feather name="archive" size={18} color="#64748B" />
                  </View>
                  <View className="flex-1">
                    <Text className="font-medium text-slate-900">Count the physical drawer</Text>
                    <Text className="mt-1 text-sm leading-5 text-slate-500">
                      Enter the cash you can physically count—not the expected amount. Enter 0 if
                      the drawer is empty.
                    </Text>
                  </View>
                </View>
                <Field
                  label="Counted cash in drawer"
                  value={actualCash}
                  onChangeText={setActualCash}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  error={
                    actualCash && !countedCashValid
                      ? 'Enter a valid amount with up to two decimal places.'
                      : undefined
                  }
                />
                {offlineSales > 0 ? (
                  <View className="mb-4 flex-row rounded-xl bg-amber-50 p-3">
                    <Feather name="alert-triangle" size={17} color="#92400E" />
                    <Text className="ml-2 flex-1 text-sm leading-5 text-amber-900">
                      {offlineSales} offline {offlineSales === 1 ? 'sale must' : 'sales must'} sync
                      or be resolved before this shift can close.
                    </Text>
                  </View>
                ) : null}
                <Button
                  title={close.isPending ? 'Closing shift…' : 'Review and close shift'}
                  variant="danger"
                  disabled={closeDisabled}
                  onPress={() => setCloseReviewOpen(true)}
                />
                {!actualCash ? (
                  <Text className="mt-2 text-center text-xs text-slate-500">
                    Enter the counted cash to enable closing.
                  </Text>
                ) : null}
              </View>
            </>
          ) : (
            <>
              <SectionLabel>Step 1 · Starting cash</SectionLabel>
              <View className="mb-7 rounded-3xl border border-slate-200 bg-white p-5">
                <View className="mb-4 flex-row items-start">
                  <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-brand-50">
                    <Feather name="inbox" size={18} color="#1A593B" />
                  </View>
                  <View className="flex-1">
                    <Text className="font-medium text-slate-900">Count the opening drawer</Text>
                    <Text className="mt-1 text-sm leading-5 text-slate-500">
                      Enter the cash already inside before accepting your first sale.
                    </Text>
                  </View>
                </View>
                <Field
                  label="Starting cash in drawer"
                  value={startingCash}
                  onChangeText={setStartingCash}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  error={
                    startingCash && !startingCashValid
                      ? 'Enter a valid amount with up to two decimal places.'
                      : undefined
                  }
                />
              </View>
            </>
          )}

          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-xs font-semibold uppercase tracking-widest text-slate-500">
              {shift ? 'Registers' : 'Step 2 · Choose a register'}
            </Text>
            {canManageRegisters ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add cashier counter"
                onPress={() => {
                  const nextNum = (query.data?.length ?? 0) + 1;
                  setCounterName(`Counter ${nextNum}`);
                  setCounterCode(`CTR-${nextNum}`);
                  setAddCounterOpen(true);
                }}
                className="flex-row items-center gap-1.5 rounded-xl bg-brand-50 px-3 py-1.5 active:bg-brand-100"
              >
                <Feather name="plus-circle" size={14} color="#1A593B" />
                <Text className="text-xs font-semibold text-brand-800">+ Add Counter</Text>
              </Pressable>
            ) : null}
          </View>
          {query.isLoading ? (
            <View className="min-h-40 rounded-3xl border border-slate-200 bg-white">
              <LoadingState label="Loading registers…" />
            </View>
          ) : query.isError ? (
            <View className="min-h-40 rounded-3xl border border-slate-200 bg-white">
              <ErrorState message={query.error.message} retry={() => void query.refetch()} />
            </View>
          ) : query.data?.length ? (
            <View className="gap-3">
              {query.data.map((register) => {
                const current = register.id === shift?.registerId;
                const occupied = Boolean(register.activeShiftId);
                const disabled =
                  Boolean(shift) || occupied || open.isPending || !startingCashValid;
                const status = current
                  ? 'Your active shift'
                  : occupied
                    ? 'In use by another cashier'
                    : shift
                      ? 'Available after you close your shift'
                      : 'Available · Tap to open';
                return (
                  <Pressable
                    key={register.id}
                    accessibilityRole="button"
                    accessibilityState={{ disabled, selected: current }}
                    disabled={disabled}
                    onPress={() => open.mutate(register)}
                    className={`min-h-20 flex-row items-center rounded-2xl border bg-white p-4 ${
                      current
                        ? 'border-brand-200'
                        : disabled
                          ? 'border-slate-100 opacity-60'
                          : 'border-slate-200 active:border-brand-300 active:bg-brand-50'
                    }`}
                  >
                    <View
                      className={`mr-3 h-11 w-11 items-center justify-center rounded-xl ${
                        current ? 'bg-brand-50' : 'bg-slate-100'
                      }`}
                    >
                      <Feather
                        name="credit-card"
                        size={19}
                        color={current ? '#1A593B' : '#64748B'}
                      />
                    </View>
                    <View className="flex-1">
                      <View className="flex-row items-center">
                        <Text className="font-medium text-slate-950">{register.name}</Text>
                        {current ? (
                          <View className="ml-2 rounded-full bg-brand-50 px-2 py-1">
                            <Text className="text-[10px] font-medium uppercase text-brand-700">
                              Open
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <Text className="mt-1 text-sm text-slate-500">
                        {register.code} · {status}
                      </Text>
                    </View>
                    {!disabled ? <Feather name="chevron-right" size={20} color="#1A593B" /> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <EmptyState
              title="No registers"
              message="Ask an administrator to create a register for this branch."
            />
          )}
          {!shift && !startingCashValid ? (
            <Text className="mt-3 text-center text-xs text-slate-500">
              Enter a valid starting cash amount before choosing a register.
            </Text>
          ) : null}
        </View>
      </ScrollView>

      <Modal
        visible={closeReviewOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!close.isPending) setCloseReviewOpen(false);
        }}
      >
        <View className="flex-1 items-center justify-center bg-black/40 p-5">
          <View className="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl">
            <View className="mb-4 flex-row items-start justify-between">
              <View className="mr-4 flex-1">
                <Text className="text-lg font-semibold text-slate-950">Close this shift?</Text>
                <Text className="mt-1 text-sm leading-5 text-slate-500">
                  Ximo will calculate the expected cash and show any shortage or overage after
                  closing.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel closing shift"
                disabled={close.isPending}
                onPress={() => setCloseReviewOpen(false)}
                className="h-10 w-10 items-center justify-center rounded-full bg-slate-100"
              >
                <Feather name="x" size={20} color="#475569" />
              </Pressable>
            </View>
            <View className="mb-5 rounded-2xl bg-slate-50 p-4">
              <Text className="text-xs uppercase tracking-wider text-slate-500">Register</Text>
              <Text className="mt-1 font-medium text-slate-900">
                {shift?.registerName ?? 'Active register'}
              </Text>
              <View className="my-3 h-px bg-slate-200" />
              <Text className="text-xs uppercase tracking-wider text-slate-500">Counted cash</Text>
              <Text className="mt-1 text-xl font-semibold text-slate-950">
                {formatMoney(actualCash || '0')}
              </Text>
            </View>
            <View className="flex-row gap-3">
              <Pressable
                accessibilityRole="button"
                disabled={close.isPending}
                onPress={() => setCloseReviewOpen(false)}
                className="min-h-12 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white"
              >
                <Text className="font-medium text-slate-700">Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={close.isPending}
                onPress={() => close.mutate()}
                className={`min-h-12 flex-[2] items-center justify-center rounded-xl bg-red-700 ${
                  close.isPending ? 'opacity-50' : 'active:opacity-80'
                }`}
              >
                <Text className="font-medium text-white">
                  {close.isPending ? 'Closing…' : 'Confirm and close'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={addCounterOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!createRegister.isPending) setAddCounterOpen(false);
        }}
      >
        <View className="flex-1 items-center justify-center bg-black/40 p-5">
          <View className="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl gap-4">
            <View className="flex-row items-start justify-between">
              <View className="mr-4 flex-1">
                <Text className="text-lg font-semibold text-slate-950">Add Cashier Counter</Text>
                <Text className="mt-1 text-sm leading-5 text-slate-500">
                  Create a new cash register / counter for {branch.name}.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close modal"
                disabled={createRegister.isPending}
                onPress={() => setAddCounterOpen(false)}
                className="h-10 w-10 items-center justify-center rounded-full bg-slate-100"
              >
                <Feather name="x" size={20} color="#475569" />
              </Pressable>
            </View>

            <Field
              label="Counter Name"
              value={counterName}
              onChangeText={setCounterName}
              placeholder="e.g. Counter 2 or Express Counter"
            />

            <Field
              label="Counter Code"
              value={counterCode}
              onChangeText={(val) => setCounterCode(val.toUpperCase())}
              placeholder="e.g. CTR-02"
              autoCapitalize="characters"
            />

            <View className="flex-row gap-3 pt-2">
              <Pressable
                accessibilityRole="button"
                disabled={createRegister.isPending}
                onPress={() => setAddCounterOpen(false)}
                className="min-h-12 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white"
              >
                <Text className="font-medium text-slate-700">Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={createRegister.isPending || counterName.trim().length < 2}
                onPress={() => createRegister.mutate()}
                className={`min-h-12 flex-[2] items-center justify-center rounded-xl bg-brand-700 ${
                  createRegister.isPending || counterName.trim().length < 2
                    ? 'opacity-50'
                    : 'active:opacity-80'
                }`}
              >
                <Text className="font-medium text-white">
                  {createRegister.isPending ? 'Adding…' : 'Add Counter'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

export default function RegistersScreen() {
  return (
    <AppSidebarProvider>
      <RegistersContent />
    </AppSidebarProvider>
  );
}
