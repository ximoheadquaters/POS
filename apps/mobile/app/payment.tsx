import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';
import { minorToMoney, moneyToMinor } from '@ximo/shared';
import { api } from '@/lib/api';
import { enqueueOfflineSale, getOfflineSales } from '@/lib/offline-sales';
import { confirmAction } from '@/lib/confirm';
import { formatMoney } from '@/lib/format';
import { Button, Field, Header, Screen } from '@/components/ui';
import { getHardwareDriver } from '@/hardware/registry';
import { ApiError } from '@/lib/api';
import { useIosAlert, appAlert } from '@/providers/ios-alert';
import { useSession } from '@/providers/session';
import { cartSubtotal, cartTotal, useCartStore } from '@/store/cart';
import { useBranchStore } from '@/store/branch';
import { useShiftStore } from '@/store/shift';
import { useConnectivityStore } from '@/store/connectivity';

import { evaluateCartPromotions, getQualifyingPromotions, type PromotionRule } from '@/lib/promo-evaluator';
import { expandCartItemsForApi } from '@/lib/combo-cart';

interface Receipt {
  id: string;
  receiptNumber: string;
  total: string;
  changeDue: string;
  offline?: boolean;
}

interface RegisterStatus {
  id: string;
  name: string;
  activeShiftId?: string;
  activeCashierId?: string;
}

interface Customer {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
}

function safeMoney(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    moneyToMinor(trimmed);
    return trimmed.includes('.') ? trimmed : `${trimmed}.00`;
  } catch {
    return null;
  }
}

export default function PaymentScreen() {
  const { currentUser } = useSession();
  const items = useCartStore((state) => state.items);
  const customerId = useCartStore((state) => state.customerId);
  const setCustomer = useCartStore((state) => state.setCustomer);
  const clear = useCartStore((state) => state.clear);
  const branch = useBranchStore((state) => state.activeBranch);
  const shift = useShiftStore((state) => state.activeShift);
  const setActiveShift = useShiftStore((state) => state.setActive);
  const clearShift = useShiftStore((state) => state.clear);
  const queryClient = useQueryClient();
  const isOnline = useConnectivityStore((state) => state.isOnline);
  const setPendingSales = useConnectivityStore((state) => state.setPendingSales);
  const setOfflineQueue = useConnectivityStore((state) => state.setOfflineQueue);
  const { showAlert } = useIosAlert();
  const [discount, setDiscount] = useState('0.00');
  const [cashReceived, setCashReceived] = useState('');
  const [discountMode, setDiscountMode] = useState<'fixed' | 'percent'>('fixed');
  const [percentValue, setPercentValue] = useState('');
  const [selectedPromoId, setSelectedPromoId] = useState<string | null>(null);
  const [manualClear, setManualClear] = useState(false);
  const [customerPickerVisible, setCustomerPickerVisible] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const trimmedCustomerSearch = customerSearch.trim();

  const promotionsQuery = useQuery({
    queryKey: ['pos-checkout-promotions', branch?.id],
    queryFn: async () => {
      if (!branch?.id) return [];
      const res = await api<any[]>(`/promotions?branchId=${branch.id}&pageSize=50`);
      const list = Array.isArray(res) ? res : (res as any)?.pages?.flat() ?? (res as any)?.data ?? [];
      return list.filter(
        (p: any) =>
          p.isActive &&
          (p.type === 'percentage_discount' ||
            p.type === 'fixed_discount' ||
            p.type === 'tiered_quantity' ||
            Boolean(p.discountPercentage) ||
            Boolean(p.discountAmount)),
      );
    },
    enabled: Boolean(branch?.id),
  });
  const customersQuery = useQuery({
    queryKey: ['payment-customers', branch?.id, trimmedCustomerSearch],
    queryFn: async () => {
      if (!branch?.id) return [];
      return api<Customer[]>(
        `/customers?branchId=${branch.id}&page=1&pageSize=20&search=${encodeURIComponent(trimmedCustomerSearch)}`,
      );
    },
    enabled: Boolean(branch?.id) && customerPickerVisible,
  });
  const selectedCustomer = useMemo(
    () => customersQuery.data?.find((customer) => customer.id === customerId) ?? null,
    [customerId, customersQuery.data],
  );

  const subtotal = useMemo(() => cartSubtotal(items), [items]);

  const qualifyingPromos = useMemo(() => {
    if (!promotionsQuery.data) return [];
    return getQualifyingPromotions(items, promotionsQuery.data as PromotionRule[]);
  }, [promotionsQuery.data, items]);

  // Auto-apply only product-targeted qualifying promos (not generic ones)
  useEffect(() => {
    if (manualClear || selectedPromoId || discount !== '0.00') return;
    if (!qualifyingPromos.length || !promotionsQuery.data) return;
    // Only auto-apply promos that have specific product items assigned
    const rawMap = new Map<string, any>();
    for (const p of promotionsQuery.data) rawMap.set(p.id, p);
    const targeted = qualifyingPromos.filter((qp) => {
      const raw = rawMap.get(qp.id);
      return raw?.items && raw.items.length > 0;
    });
    if (!targeted.length) return;
    const best = targeted.reduce((a, b) => (b.discountMinor > a.discountMinor ? b : a));
    if (best.discountMinor > 0n) {
      setDiscount(best.discountMoney);
      setSelectedPromoId(best.id);
    }
  }, [qualifyingPromos, promotionsQuery.data, manualClear, selectedPromoId, discount]);

  const applyPercentDiscount = (percent: number, promoId?: string) => {
    try {
      const subtotalMinor = moneyToMinor(subtotal);
      const discountMinor = (subtotalMinor * BigInt(Math.round(percent * 100))) / 10000n;
      setDiscount(minorToMoney(discountMinor));
      setPercentValue(String(percent));
      setSelectedPromoId(promoId ?? null);
      setManualClear(false);
    } catch {
      setDiscount('0.00');
    }
  };

  const applyFixedDiscount = (amount: string, promoId?: string) => {
    setDiscount(amount);
    setPercentValue('');
    setSelectedPromoId(promoId ?? null);
    setManualClear(false);
  };

  const clearDiscount = () => {
    setDiscount('0.00');
    setPercentValue('');
    setSelectedPromoId(null);
    setManualClear(true);
  };

  const total = useMemo(() => cartTotal(items, discount || '0.00'), [discount, items]);

  useEffect(() => {
    setCashReceived(total);
  }, [total]);

  const tendered = safeMoney(cashReceived) ?? '0.00';
  const changeDue = useMemo(() => {
    try {
      const diff = moneyToMinor(tendered) - moneyToMinor(total);
      return minorToMoney(diff > 0n ? diff : 0n);
    } catch {
      return '0.00';
    }
  }, [tendered, total]);
  const canComplete = useMemo(() => {
    try {
      return Boolean(items.length) && moneyToMinor(tendered) >= moneyToMinor(total);
    } catch {
      return false;
    }
  }, [items.length, tendered, total]);

  const checkout = useMutation({
    mutationFn: async () => {
      if (!branch || !currentUser) throw new Error('An active branch and account are required');
      const payments = [{ method: 'cash' as const, amount: total, tendered }];
      const idempotencyKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const checkoutItems = expandCartItemsForApi(items);
      const checkoutDiscount =
        discount && discount !== '0.00' ? { type: 'fixed' as const, value: discount } : undefined;

      if (!isOnline) {
        if (!shift || shift.branchId !== branch.id) {
          throw new Error('An open shift saved on this device is required for offline sales.');
        }
        const body = {
          branchId: branch.id,
          registerId: shift.registerId,
          shiftId: shift.id,
          customerId,
          items: checkoutItems,
          discount: checkoutDiscount,
          payments,
        };
        const offlineId = `offline-${idempotencyKey}`;
        const pending = await enqueueOfflineSale({
          id: offlineId,
          idempotencyKey,
          createdAt: new Date().toISOString(),
          total,
          body,
        });
        setPendingSales(pending);
        setOfflineQueue(await getOfflineSales());
        return {
          id: offlineId,
          receiptNumber: `OFFLINE-${Date.now().toString().slice(-6)}`,
          total,
          changeDue,
          offline: true,
        };
      }

      const registers = await api<RegisterStatus[]>(`/registers?branchId=${branch.id}`);
      let activeRegister = registers.find(
        (register) => register.activeShiftId && register.activeCashierId === currentUser.id,
      );
      if (!activeRegister && shift?.id) {
        activeRegister = registers.find((register) => register.activeShiftId === shift.id);
      }
      if (!activeRegister?.activeShiftId) {
        activeRegister = registers.find((register) => Boolean(register.activeShiftId));
      }
      if (!activeRegister?.activeShiftId) {
        await clearShift();
        throw new Error(
          'You do not have an active register shift open. Open a register shift from the main menu and try again.',
        );
      }
      const verifiedShift = {
        id: activeRegister.activeShiftId,
        registerId: activeRegister.id,
        registerName: activeRegister.name,
        branchId: branch.id,
      };
      if (!shift || shift.id !== verifiedShift.id || shift.branchId !== verifiedShift.branchId) {
        await setActiveShift(verifiedShift);
      }
      return api<Receipt>('/sales/checkout', {
        method: 'POST',
        idempotencyKey,
        body: JSON.stringify({
          branchId: branch.id,
          registerId: verifiedShift.registerId,
          shiftId: verifiedShift.id,
          customerId,
          items: checkoutItems,
          discount: checkoutDiscount,
          payments,
        }),
      });
    },
    onSuccess(receipt) {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sales'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory'] }),
        queryClient.invalidateQueries({ queryKey: ['pos-products'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['reports'] }),
      ]);
      if (currentUser?.modules.includes('cash_drawer')) {
        const drawer = getHardwareDriver('cash_drawer');
        void drawer
          .status()
          .then((status) => {
            if (status.state !== 'ready') return;
            return drawer.open();
          })
          .catch((error) =>
            appAlert(
              'Sale completed, but the drawer did not open',
              error instanceof Error ? error.message : 'Open the drawer manually.',
            ),
          );
      }
      clear();
      router.replace({
        pathname: '/receipt',
        params: {
          id: receipt.id,
          number: receipt.receiptNumber,
          total: receipt.total,
          change: receipt.changeDue,
          offline: receipt.offline ? '1' : '0',
        },
      });
    },
    onError(error) {
      let message = error.message;
      if (error instanceof ApiError && error.details) {
        const details = error.details as { fieldErrors?: Record<string, string[]> };
        if (details.fieldErrors) {
          const fieldMsgs = Object.entries(details.fieldErrors)
            .map(([field, errs]) => `${field}: ${errs.join(', ')}`)
            .join('\n');
          if (fieldMsgs) message = fieldMsgs;
        }
      }
      showAlert({
        title: 'Checkout Failed',
        message,
        type: 'error',
      });
    },
  });

  const completeSale = async () => {
    if (!canComplete) {
      showAlert({
        title: 'Not enough cash',
        message: 'Cash received must be at least the amount due.',
        type: 'warning',
      });
      return;
    }
    const confirmed = await confirmAction(
      'Complete sale?',
      'Inventory and register totals will be updated.',
      'Complete',
    );
    if (confirmed) checkout.mutate();
  };

  return (
    <Screen>
      <Header
        title="Payment"
        subtitle="Cash checkout"
        showBack
        backLabel="Cart"
        fallbackHref="/cart"
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="grow px-4 py-4 pb-10"
      >
        <View className="mx-auto w-full max-w-md gap-4">
          <View className="rounded-2xl bg-brand-700 px-5 py-5">
            <Text className="text-sm font-medium text-brand-100">Amount Due</Text>
            <Text className="mt-1 text-4xl font-black text-white">{formatMoney(total)}</Text>
            {discount !== '0.00' && discount.trim() ? (
              <Text className="mt-2 text-xs text-brand-100">
                Subtotal {formatMoney(subtotal)} · Discount {formatMoney(discount)}
              </Text>
            ) : (
              <Text className="mt-2 text-xs text-brand-100">
                {items.length} Item{items.length === 1 ? '' : 's'} · Cash Only
              </Text>
            )}
          </View>

          <View className="rounded-2xl border border-slate-200 bg-white p-4">
            <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-600">
              Customer
            </Text>
            <View className="flex-row items-center gap-2">
              <Pressable
                accessibilityRole="button"
                onPress={() => setCustomerPickerVisible(true)}
                className="min-h-12 flex-1 flex-row items-center rounded-xl border border-slate-200 bg-slate-50 px-3 active:bg-slate-100"
              >
                <Feather name="user" size={16} color="#1A593B" />
                <View className="ml-2 min-w-0 flex-1">
                  <Text className="text-sm font-semibold text-slate-900" numberOfLines={1}>
                    {selectedCustomer?.name ?? (customerId ? 'Selected Customer' : 'Walk-In Customer')}
                  </Text>
                  <Text className="mt-0.5 text-xs text-slate-500" numberOfLines={1}>
                    {selectedCustomer?.phone || selectedCustomer?.email || 'Tap to link a customer'}
                  </Text>
                </View>
                <Feather name="chevron-down" size={16} color="#64748B" />
              </Pressable>
              {customerId ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear Customer"
                  onPress={() => setCustomer(null)}
                  className="h-12 w-12 items-center justify-center rounded-xl border border-slate-200 bg-white active:bg-slate-50"
                >
                  <Feather name="x" size={16} color="#64748B" />
                </Pressable>
              ) : null}
            </View>
          </View>

          <View className="rounded-2xl border border-slate-200 bg-white p-4 gap-3">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-1.5">
                <Feather name="tag" size={16} color="#1A593B" />
                <Text className="text-sm font-bold text-slate-900">Promotions & Discounts</Text>
              </View>
              {discount !== '0.00' && discount.trim() ? (
                <Pressable
                  onPress={clearDiscount}
                  className="flex-row items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1 active:bg-red-100"
                >
                  <Feather name="x" size={12} color="#DC2626" />
                  <Text className="text-xs font-semibold text-red-700">Clear Discount</Text>
                </Pressable>
              ) : null}
            </View>

            {(() => {
              if (!qualifyingPromos.length) return null;
              // Build a lookup from the raw promo data for labels
              const promoMap = new Map<string, any>();
              for (const p of promotionsQuery.data ?? []) promoMap.set(p.id, p);
              return (
                <View className="gap-1.5">
                  <Text className="text-[11px] font-semibold uppercase text-slate-500">
                    Qualifying Promotions
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
                    {qualifyingPromos.map((qp) => {
                      const raw = promoMap.get(qp.id);
                      const isSelected = selectedPromoId === qp.id;
                      const discountLabel = raw?.discountPercentage
                        ? `${raw.discountPercentage}% OFF`
                        : raw?.discountAmount
                          ? `\u20b1${raw.discountAmount} OFF`
                          : qp.name;
                      const volumeLabel = raw?.type === 'tiered_quantity' && raw?.minOrderQuantity
                        ? `Min ${raw.minOrderQuantity}+ \u00b7 `
                        : '';
                      return (
                        <Pressable
                          key={qp.id}
                          onPress={() => {
                            if (raw?.discountPercentage) {
                              applyPercentDiscount(Number(raw.discountPercentage), qp.id);
                            } else if (raw?.discountAmount) {
                              applyFixedDiscount(raw.discountAmount, qp.id);
                            }
                          }}
                          className={`flex-row items-center gap-1.5 rounded-xl border px-3 py-2 ${
                            isSelected
                              ? 'border-brand-600 bg-brand-50'
                              : 'border-slate-200 bg-slate-50 active:bg-slate-100'
                          }`}
                        >
                          <Feather
                            name={raw?.type === 'tiered_quantity' ? 'trending-up' : 'gift'}
                            size={13}
                            color={isSelected ? '#1A593B' : '#64748B'}
                          />
                          <Text
                            className={`text-xs font-bold ${
                              isSelected ? 'text-brand-900' : 'text-slate-700'
                            }`}
                          >
                            {qp.name} ({volumeLabel}{discountLabel})
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              );
            })()}

            <View className="gap-1.5">
              <Text className="text-[11px] font-semibold uppercase text-slate-500">
                Quick Discount Presets
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {[
                  { label: '5% OFF', percent: 5 },
                  { label: '10% OFF', percent: 10 },
                  { label: '15% OFF', percent: 15 },
                  { label: '20% Senior / PWD', percent: 20 },
                ].map((preset) => {
                  const isSelected = percentValue === String(preset.percent);
                  return (
                    <Pressable
                      key={preset.label}
                      onPress={() => applyPercentDiscount(preset.percent)}
                      className={`rounded-xl border px-3 py-1.5 ${
                        isSelected
                          ? 'border-brand-600 bg-brand-50'
                          : 'border-slate-200 bg-slate-50 active:bg-slate-100'
                      }`}
                    >
                      <Text
                        className={`text-xs font-semibold ${
                          isSelected ? 'text-brand-900' : 'text-slate-700'
                        }`}
                      >
                        {preset.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Field
              label="Custom Discount Amount (₱)"
              value={discount}
              onChangeText={(val) => {
                setDiscount(val);
                setPercentValue('');
                setSelectedPromoId(null);
              }}
              keyboardType="decimal-pad"
              placeholder="0.00"
            />
          </View>

          <View className="rounded-2xl border border-slate-200 bg-white p-4">
            <View className="mb-1 flex-row items-center justify-between">
              <Text className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                Cash Received
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Use Exact Amount"
                onPress={() => setCashReceived(total)}
                className="rounded-lg bg-brand-50 px-2.5 py-1 active:bg-brand-100"
              >
                <Text className="text-xs font-semibold text-brand-800">Exact</Text>
              </Pressable>
            </View>
            <Field
              label=""
              value={cashReceived}
              onChangeText={setCashReceived}
              keyboardType="decimal-pad"
              placeholder={total}
            />

            <View className="mt-1 flex-row flex-wrap gap-2">
              {['50', '100', '200', '500', '1000'].map((amount) => (
                <Pressable
                  key={amount}
                  accessibilityRole="button"
                  accessibilityLabel={`Tender ${amount}`}
                  onPress={() => setCashReceived(`${amount}.00`)}
                  className="min-h-10 flex-1 basis-[30%] items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-2 active:bg-slate-100"
                >
                  <Text className="text-sm font-semibold text-slate-800">₱{amount}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View
            className={`flex-row items-center justify-between rounded-2xl border px-4 py-3.5 ${
              canComplete
                ? 'border-brand-200 bg-brand-50'
                : 'border-amber-200 bg-amber-50'
            }`}
          >
            <View>
              <Text
                className={`text-xs font-semibold uppercase tracking-wide ${
                  canComplete ? 'text-brand-700' : 'text-amber-800'
                }`}
              >
                Change
              </Text>
              <Text
                className={`mt-0.5 text-xl font-black ${
                  canComplete ? 'text-brand-900' : 'text-amber-900'
                }`}
              >
                {formatMoney(changeDue)}
              </Text>
            </View>
            <Text
              className={`text-sm font-semibold ${
                canComplete ? 'text-brand-800' : 'text-amber-800'
              }`}
            >
              {canComplete ? 'Ready' : 'Need more cash'}
            </Text>
          </View>

          <Button
            title={
              checkout.isPending ? 'Completing Sale…' : `Complete · ${formatMoney(total)}`
            }
            disabled={checkout.isPending || !canComplete}
            onPress={() => void completeSale()}
          />
        </View>
      </ScrollView>

      <Modal
        visible={customerPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCustomerPickerVisible(false)}
      >
        <View className="flex-1 items-center justify-center bg-black/40 p-4">
          <Pressable className="absolute inset-0" onPress={() => setCustomerPickerVisible(false)} />
          <View className="max-h-[82%] w-full max-w-md rounded-3xl bg-white p-5">
            <View className="mb-4 flex-row items-start justify-between gap-3">
              <View className="min-w-0 flex-1">
                <Text className="text-lg font-bold text-slate-950">Select Customer</Text>
                <Text className="mt-1 text-sm text-slate-500">
                  Link this sale to an existing customer record.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close Customer Picker"
                onPress={() => setCustomerPickerVisible(false)}
                className="h-9 w-9 items-center justify-center rounded-full bg-slate-100"
              >
                <Feather name="x" size={18} color="#475569" />
              </Pressable>
            </View>

            <TextInput
              value={customerSearch}
              onChangeText={setCustomerSearch}
              placeholder="Search Customers"
              placeholderTextColor="#81776E"
              selectionColor="#1A593B"
              style={{ outline: 'none' }}
              className="mb-3 min-h-12 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 focus:border-brand-600 focus:ring-2 focus:ring-brand-200"
            />

            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setCustomer(null);
                  setCustomerPickerVisible(false);
                }}
                className={`mb-2 rounded-xl border px-4 py-3 ${
                  !customerId ? 'border-brand-200 bg-brand-50' : 'border-slate-200 bg-white'
                }`}
              >
                <Text className="text-sm font-bold text-slate-900">Walk-In Customer</Text>
                <Text className="mt-1 text-xs text-slate-500">Do not link this transaction.</Text>
              </Pressable>

              {customersQuery.isLoading ? (
                <Text className="px-1 py-4 text-center text-sm text-slate-500">
                  Loading Customers…
                </Text>
              ) : customersQuery.isError ? (
                <Text className="rounded-xl bg-red-50 px-3 py-3 text-sm text-red-700">
                  Could Not Load Customers
                </Text>
              ) : customersQuery.data?.length ? (
                customersQuery.data.map((customer) => {
                  const selected = customer.id === customerId;
                  return (
                    <Pressable
                      key={customer.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => {
                        setCustomer(customer.id);
                        setCustomerPickerVisible(false);
                      }}
                      className={`mb-2 rounded-xl border px-4 py-3 ${
                        selected ? 'border-brand-200 bg-brand-50' : 'border-slate-200 bg-white'
                      }`}
                    >
                      <Text className="text-sm font-bold text-slate-900">{customer.name}</Text>
                      <Text className="mt-1 text-xs text-slate-500" numberOfLines={1}>
                        {customer.phone || customer.email || 'No Contact Details'}
                      </Text>
                    </Pressable>
                  );
                })
              ) : (
                <Text className="px-1 py-4 text-center text-sm text-slate-500">
                  No customers found.
                </Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
