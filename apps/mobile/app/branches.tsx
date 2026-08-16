import { useMemo, useState } from 'react';
import { appAlert } from '@/providers/ios-alert';
import { Modal, Pressable, ScrollView, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { branchSchema, type BranchInput } from '@ximo/shared';
import type { z } from 'zod';
import { AppSidebarProvider } from '@/components/app-sidebar';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  Header,
  LoadingState,
  Screen,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/providers/session';
import { useBranchStore } from '@/store/branch';

interface BranchRecord extends BranchInput {
  id: string;
  staffCount?: number;
  inventoryItems?: number;
  registerCount?: number;
  openShiftCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

type StatusFilter = 'all' | 'active' | 'inactive';

const defaults: BranchInput = {
  name: '',
  code: '',
  address: '',
  phone: '',
  isActive: true,
};

function BranchesContent() {
  const { width } = useWindowDimensions();
  const { currentUser, refreshUser } = useSession();
  const activeBranch = useBranchStore((state) => state.activeBranch);
  const selectBranch = useBranchStore((state) => state.select);
  const client = useQueryClient();
  const canManage = currentUser?.permissions?.includes('branches:manage') ?? false;
  const canManageRegisters =
    Boolean(currentUser?.permissions?.includes('registers:manage')) ||
    ['owner', 'administrator', 'manager'].includes(currentUser?.role ?? '');
  const canViewUsers = currentUser?.permissions?.includes('users:read') ?? false;
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [editing, setEditing] = useState<BranchRecord | null>(null);
  const [formVisible, setFormVisible] = useState(false);
  const [counterBranch, setCounterBranch] = useState<BranchRecord | null>(null);
  const [counterName, setCounterName] = useState('');
  const [counterCode, setCounterCode] = useState('');
  const form = useForm<z.input<typeof branchSchema>, unknown, BranchInput>({
    resolver: zodResolver(branchSchema),
    defaultValues: defaults,
  });
  const query = useQuery({
    queryKey: ['branches', 'management'],
    queryFn: () => api<BranchRecord[]>('/branches'),
  });

  const addCounter = useMutation({
    mutationFn: async () => {
      if (!counterBranch) return;
      const code = (
        counterCode.trim() || `CTR-${(counterBranch.registerCount ?? 0) + 1}`
      ).toUpperCase();
      return api('/registers', {
        method: 'POST',
        body: JSON.stringify({
          branchId: counterBranch.id,
          name: counterName.trim(),
          code,
        }),
      });
    },
    onSuccess: () => {
      const branchName = counterBranch?.name;
      setCounterBranch(null);
      setCounterName('');
      setCounterCode('');
      void client.invalidateQueries({ queryKey: ['branches'] });
      void client.invalidateQueries({ queryKey: ['registers'] });
      appAlert('Counter added', `Cashier counter has been added to ${branchName ?? 'the branch'}.`);
    },
    onError: (error) => appAlert('Could not add counter', error.message),
  });

  function openCreate() {
    setEditing(null);
    form.reset(defaults);
    setFormVisible(true);
  }

  function openEdit(branch: BranchRecord) {
    setEditing(branch);
    form.reset({
      name: branch.name,
      code: branch.code,
      address: branch.address ?? '',
      phone: branch.phone ?? '',
      isActive: branch.isActive,
    });
    setFormVisible(true);
  }

  async function refreshBranchContext(updated?: BranchRecord) {
    const refreshed = await refreshUser();
    if (!updated || activeBranch?.id !== updated.id) return;
    if (updated.isActive) {
      await selectBranch({ id: updated.id, name: updated.name, code: updated.code });
      return;
    }
    const next = refreshed.branches.find((branch) => branch.id !== updated.id);
    if (next) await selectBranch(next);
  }

  const save = useMutation({
    mutationFn: (input: BranchInput) =>
      api<BranchRecord>(editing ? `/branches/${editing.id}` : '/branches', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...input,
          name: input.name.trim(),
          code: input.code.trim().toUpperCase(),
          address: input.address?.trim() || undefined,
          phone: input.phone?.trim() || undefined,
        }),
      }),
    onSuccess: async (branch) => {
      setFormVisible(false);
      form.reset(defaults);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['branches'] }),
        client.invalidateQueries({ queryKey: ['organization', 'current'] }),
        refreshBranchContext(branch),
      ]);
      appAlert(editing ? 'Branch updated' : 'Branch created', `${branch.name} is ready.`);
      setEditing(null);
    },
    onError: (error) => appAlert('Could not save branch', error.message),
  });

  const toggle = useMutation({
    mutationFn: (branch: BranchRecord) =>
      api<BranchRecord>(`/branches/${branch.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !branch.isActive }),
      }),
    onSuccess: async (branch) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['branches'] }),
        client.invalidateQueries({ queryKey: ['organization', 'current'] }),
        refreshBranchContext(branch),
      ]);
    },
    onError: (error) => appAlert('Could not update branch', error.message),
  });

  function confirmToggle(branch: BranchRecord) {
    if (!branch.isActive) {
      toggle.mutate(branch);
      return;
    }
    appAlert(
      `Deactivate ${branch.name}?`,
      (branch.openShiftCount ?? 0) > 0
        ? 'This branch still has an open cashier shift. Close it before deactivating the branch.'
        : 'The branch will disappear from branch selection. Historical sales and inventory records will remain available.',
      (branch.openShiftCount ?? 0) > 0
        ? [{ text: 'OK' }]
        : [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Deactivate', style: 'destructive', onPress: () => toggle.mutate(branch) },
          ],
    );
  }

  const branches = useMemo(
    () =>
      (query.data ?? []).map((branch) => ({
        ...branch,
        staffCount: Number(branch.staffCount ?? 0),
        inventoryItems: Number(branch.inventoryItems ?? 0),
        registerCount: Number(branch.registerCount ?? 0),
        openShiftCount: Number(branch.openShiftCount ?? 0),
      })),
    [query.data],
  );
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return branches.filter((branch) => {
      if (status === 'active' && !branch.isActive) return false;
      if (status === 'inactive' && branch.isActive) return false;
      if (!term) return true;
      return [branch.name, branch.code, branch.address, branch.phone]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [branches, search, status]);
  const activeCount = branches.filter((branch) => branch.isActive).length;
  const staffAssignments = branches.reduce((total, branch) => total + branch.staffCount, 0);
  const compact = width < 640;

  return (
    <Screen>
      <Header
        title="Branches"
        subtitle="Locations, access and operational status"
        showBack
        backLabel="More"
        fallbackHref="/(tabs)/more"
        action={canManage ? <Button title="+ New branch" onPress={openCreate} /> : null}
      />
      <ScrollView contentContainerClassName="items-center p-4 pb-12">
        <View className="w-full max-w-5xl gap-5">
          <View className={`gap-3 ${compact ? '' : 'flex-row'}`}>
            {[
              ['Locations', String(branches.length), 'map-pin' as const],
              ['Active', String(activeCount), 'check-circle' as const],
              ['Staff assignments', String(staffAssignments), 'users' as const],
            ].map(([label, value, icon]) => (
              <View
                key={label}
                className="min-h-28 flex-1 rounded-2xl border border-slate-200 bg-white p-4"
              >
                <View className="h-9 w-9 items-center justify-center rounded-xl bg-brand-50">
                  <Feather name={icon as keyof typeof Feather.glyphMap} size={16} color="#1A593B" />
                </View>
                <Text className="mt-3 text-xl font-semibold text-slate-950">{value}</Text>
                <Text className="mt-1 text-xs text-slate-500">{label}</Text>
              </View>
            ))}
          </View>

          <View className="rounded-2xl border border-slate-200 bg-white p-3">
            <View className={`gap-3 ${compact ? '' : 'flex-row items-center'}`}>
              <View className="min-h-12 flex-1 flex-row items-center rounded-xl bg-slate-100 px-4">
                <Feather name="search" size={16} color="#81776E" />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search branch name, code or address"
                  placeholderTextColor="#81776E"
                  className="ml-2 flex-1 text-sm text-slate-900 outline-none"
                />
              </View>
              <View className="flex-row gap-2">
                {(['all', 'active', 'inactive'] as const).map((value) => (
                  <Pressable
                    key={value}
                    onPress={() => setStatus(value)}
                    className={`min-h-10 flex-1 items-center justify-center rounded-xl px-4 ${
                      status === value ? 'bg-brand-700' : 'bg-slate-100'
                    }`}
                  >
                    <Text
                      className={`text-xs font-medium capitalize ${
                        status === value ? 'text-white' : 'text-slate-600'
                      }`}
                    >
                      {value}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>

          {query.isLoading ? (
            <View className="min-h-72 rounded-3xl border border-slate-200 bg-white">
              <LoadingState label="Loading branches…" />
            </View>
          ) : query.isError ? (
            <View className="min-h-72 rounded-3xl border border-slate-200 bg-white">
              <ErrorState message={query.error.message} retry={() => void query.refetch()} />
            </View>
          ) : filtered.length === 0 ? (
            <View className="min-h-72 rounded-3xl border border-slate-200 bg-white">
              <EmptyState
                title={branches.length ? 'No matching branches' : 'No branches yet'}
                message={
                  branches.length
                    ? 'Try a different search or status filter.'
                    : 'Create the first location for this organization.'
                }
              />
            </View>
          ) : (
            <View className="gap-3">
              {filtered.map((branch) => {
                const selected = activeBranch?.id === branch.id;
                return (
                  <View
                    key={branch.id}
                    className={`rounded-2xl border bg-white p-5 ${
                      selected ? 'border-brand-300' : 'border-slate-200'
                    } ${branch.isActive ? '' : 'opacity-70'}`}
                  >
                    <View className={`gap-4 ${compact ? '' : 'flex-row items-start'}`}>
                      <View className="flex-1 flex-row items-start">
                        <View className="mr-4 h-12 w-12 items-center justify-center rounded-2xl bg-brand-50">
                          <Feather name="map-pin" size={20} color="#1A593B" />
                        </View>
                        <View className="flex-1">
                          <View className="flex-row flex-wrap items-center gap-2">
                            <Text className="text-base font-semibold text-slate-950">
                              {branch.name}
                            </Text>
                            <View
                              className={`rounded-full px-2 py-1 ${
                                branch.isActive ? 'bg-brand-50' : 'bg-slate-100'
                              }`}
                            >
                              <Text
                                className={`text-[10px] font-medium uppercase ${
                                  branch.isActive ? 'text-brand-700' : 'text-slate-500'
                                }`}
                              >
                                {branch.isActive ? 'Active' : 'Inactive'}
                              </Text>
                            </View>
                            {selected ? (
                              <View className="rounded-full bg-blue-50 px-2 py-1">
                                <Text className="text-[10px] font-medium uppercase text-blue-700">
                                  Current
                                </Text>
                              </View>
                            ) : null}
                          </View>
                          <Text className="mt-1 text-xs font-medium uppercase tracking-wider text-slate-500">
                            {branch.code}
                          </Text>
                          <Text className="mt-2 text-sm text-slate-600">
                            {branch.address || 'No address added'}
                          </Text>
                          {branch.phone ? (
                            <Text className="mt-1 text-xs text-slate-500">{branch.phone}</Text>
                          ) : null}
                        </View>
                      </View>
                      {canManage || canManageRegisters ? (
                        <View className="flex-row flex-wrap items-center gap-2">
                          {canManageRegisters ? (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Add counter to ${branch.name}`}
                              onPress={() => {
                                setCounterBranch(branch);
                                const nextNum = (branch.registerCount ?? 0) + 1;
                                setCounterName(`Counter ${nextNum}`);
                                setCounterCode(`CTR-${nextNum}`);
                              }}
                              className="min-h-10 flex-row items-center justify-center rounded-xl border border-brand-200 bg-brand-50 px-3 active:bg-brand-100"
                            >
                              <Feather name="plus-circle" size={14} color="#1A593B" />
                              <Text className="ml-1.5 text-xs font-semibold text-brand-800">
                                + Counter
                              </Text>
                            </Pressable>
                          ) : null}
                          {canManage ? (
                            <>
                              <Pressable
                                onPress={() => openEdit(branch)}
                                className="min-h-10 flex-row items-center justify-center rounded-xl border border-slate-200 px-3 active:bg-slate-50"
                              >
                                <Feather name="edit-2" size={14} color="#1A593B" />
                                <Text className="ml-1.5 text-xs font-medium text-brand-700">Edit</Text>
                              </Pressable>
                              <Switch
                                value={branch.isActive}
                                disabled={toggle.isPending}
                                onValueChange={() => confirmToggle(branch)}
                                trackColor={{ false: '#D7D2CC', true: '#A7D2BC' }}
                                thumbColor={branch.isActive ? '#1A593B' : '#FFFFFF'}
                              />
                            </>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                    <View className="mt-4 flex-row flex-wrap gap-2 border-t border-slate-100 pt-4">
                      {[
                        ['Staff', branch.staffCount, 'users' as const],
                        ['Inventory items', branch.inventoryItems, 'package' as const],
                        ['Registers', branch.registerCount, 'monitor' as const],
                        ['Open shifts', branch.openShiftCount, 'clock' as const],
                      ].map(([label, value, icon]) => (
                        <View
                          key={label}
                          className="min-h-10 flex-row items-center rounded-xl bg-slate-50 px-3"
                        >
                          <Feather
                            name={icon as keyof typeof Feather.glyphMap}
                            size={13}
                            color="#64748B"
                          />
                          <Text className="ml-2 text-xs text-slate-600">
                            {label}:{' '}
                            <Text className="font-semibold text-slate-900">{String(value)}</Text>
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {canViewUsers ? (
            <Pressable
              onPress={() => router.push('/users')}
              className="min-h-14 flex-row items-center justify-center rounded-2xl border border-slate-200 bg-white px-4"
            >
              <Feather name="users" size={16} color="#1A593B" />
              <Text className="ml-2 text-sm font-medium text-brand-700">
                Manage staff branch assignments
              </Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>

      <Modal
        visible={formVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setFormVisible(false)}
      >
        <View className="flex-1 items-center justify-center bg-black/40 p-4">
          <View className="w-full max-w-xl overflow-hidden rounded-3xl bg-white">
            <View className="flex-row items-center border-b border-slate-100 p-5">
              <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-brand-50">
                <Feather name={editing ? 'edit-2' : 'plus'} size={18} color="#1A593B" />
              </View>
              <View className="flex-1">
                <Text className="text-lg font-semibold text-slate-950">
                  {editing ? 'Edit branch' : 'Create branch'}
                </Text>
                <Text className="mt-1 text-xs text-slate-500">
                  Branch codes are short identifiers used in reports and operations.
                </Text>
              </View>
              <Pressable onPress={() => setFormVisible(false)} className="p-2">
                <Feather name="x" size={20} color="#64748B" />
              </Pressable>
            </View>
            <ScrollView contentContainerClassName="gap-4 p-5 pb-6">
              <Controller
                control={form.control}
                name="name"
                render={({ field, fieldState }) => (
                  <Field
                    label="Branch name"
                    value={field.value}
                    placeholder="e.g. Main Branch"
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                    error={fieldState.error?.message}
                  />
                )}
              />
              <Controller
                control={form.control}
                name="code"
                render={({ field, fieldState }) => (
                  <Field
                    label="Branch code"
                    value={field.value}
                    placeholder="e.g. MAIN"
                    autoCapitalize="characters"
                    onChangeText={(value) => field.onChange(value.toUpperCase())}
                    onBlur={field.onBlur}
                    error={fieldState.error?.message}
                  />
                )}
              />
              <Controller
                control={form.control}
                name="address"
                render={({ field, fieldState }) => (
                  <Field
                    label="Address (optional)"
                    value={field.value ?? ''}
                    placeholder="Street, barangay, city"
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                    error={fieldState.error?.message}
                  />
                )}
              />
              <Controller
                control={form.control}
                name="phone"
                render={({ field, fieldState }) => (
                  <Field
                    label="Phone (optional)"
                    value={field.value ?? ''}
                    placeholder="Branch contact number"
                    keyboardType="phone-pad"
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                    error={fieldState.error?.message}
                  />
                )}
              />
              <Controller
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <View className="flex-row items-center rounded-2xl border border-slate-200 p-4">
                    <View className="flex-1">
                      <Text className="font-medium text-slate-900">Active branch</Text>
                      <Text className="mt-1 text-xs text-slate-500">
                        Active branches can be selected for sales and inventory operations.
                      </Text>
                    </View>
                    <Switch
                      value={field.value}
                      onValueChange={field.onChange}
                      trackColor={{ false: '#D7D2CC', true: '#A7D2BC' }}
                      thumbColor={field.value ? '#1A593B' : '#FFFFFF'}
                    />
                  </View>
                )}
              />
              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Button
                    title="Cancel"
                    variant="secondary"
                    onPress={() => setFormVisible(false)}
                  />
                </View>
                <View className="flex-1">
                  <Button
                    title={save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create branch'}
                    disabled={save.isPending}
                    onPress={form.handleSubmit((value) => save.mutate(value))}
                  />
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={Boolean(counterBranch)}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!addCounter.isPending) setCounterBranch(null);
        }}
      >
        <View className="flex-1 items-center justify-center bg-black/40 p-5">
          <View className="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl gap-4">
            <View className="flex-row items-start justify-between">
              <View className="mr-4 flex-1">
                <Text className="text-lg font-semibold text-slate-950">Add Cashier Counter</Text>
                <Text className="mt-1 text-sm leading-5 text-slate-500">
                  Create a new cash register / counter for {counterBranch?.name}.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close modal"
                disabled={addCounter.isPending}
                onPress={() => setCounterBranch(null)}
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
                disabled={addCounter.isPending}
                onPress={() => setCounterBranch(null)}
                className="min-h-12 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white"
              >
                <Text className="font-medium text-slate-700">Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={addCounter.isPending || counterName.trim().length < 2}
                onPress={() => addCounter.mutate()}
                className={`min-h-12 flex-[2] items-center justify-center rounded-xl bg-brand-700 ${
                  addCounter.isPending || counterName.trim().length < 2
                    ? 'opacity-50'
                    : 'active:opacity-80'
                }`}
              >
                <Text className="font-medium text-white">
                  {addCounter.isPending ? 'Adding…' : 'Add Counter'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

export default function BranchesScreen() {
  return (
    <AppSidebarProvider>
      <BranchesContent />
    </AppSidebarProvider>
  );
}
