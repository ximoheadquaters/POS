import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { Button, EmptyState, Field, Header, Screen } from '@/components/ui';
import { QuantityInput } from '@/components/quantity-input';
import { useIosAlert } from '@/providers/ios-alert';
import { useBranchStore } from '@/store/branch';
import { useShiftStore } from '@/store/shift';
import { evaluateCartPromotions, type PromotionRule } from '@/lib/promo-evaluator';
import { comboIncludesLabel, expandCartItemsForApi } from '@/lib/combo-cart';
import {
  cartLineTotal,
  cartProductKey,
  cartSubtotal,
  cartTotal,
  hasCartStockConflict,
  quantityStep,
  useCartStore,
} from '@/store/cart';

export default function CartScreen() {
  const queryClient = useQueryClient();
  const branch = useBranchStore((state) => state.activeBranch);
  const activeShift = useShiftStore((state) => state.activeShift);
  const items = useCartStore((state) => state.items);
  const setQuantity = useCartStore((state) => state.setQuantity);
  const clearCart = useCartStore((state) => state.clear);
  const { showAlert } = useIosAlert();
  const [holdModalVisible, setHoldModalVisible] = useState(false);
  const [holdNote, setHoldNote] = useState('');

  const promotionsQuery = useQuery({
    queryKey: ['pos-checkout-promotions', branch?.id],
    queryFn: async () => {
      if (!branch?.id) return [];
      const res = await api<any[]>(`/promotions?branchId=${branch.id}&pageSize=50`);
      const list = Array.isArray(res) ? res : (res as any)?.pages?.flat() ?? (res as any)?.data ?? [];
      return list.filter((p: any) => p.isActive);
    },
    enabled: Boolean(branch?.id),
  });

  const activePromo = useMemo(
    () => evaluateCartPromotions(items, (promotionsQuery.data ?? []) as PromotionRule[]),
    [items, promotionsQuery.data],
  );

  const subtotal = cartSubtotal(items);
  const total = useMemo(
    () => cartTotal(items, activePromo?.discountMoney || '0.00'),
    [items, activePromo],
  );
  const hasStockConflict = hasCartStockConflict(items);

  const heldSalesQuery = useQuery({
    queryKey: ['pos-held-sales-count', branch?.id],
    queryFn: async () => {
      if (!branch?.id) return [];
      const res = await api<any[]>(`/sales/held?branchId=${branch.id}`);
      return Array.isArray(res) ? res : (res as any)?.data ?? [];
    },
    enabled: Boolean(branch?.id),
  });
  const heldCount = heldSalesQuery.data?.length ?? 0;

  const holdMutation = useMutation({
    mutationFn: () =>
      api<{ receiptNumber: string }>('/sales/hold', {
        method: 'POST',
        idempotencyKey: `hold-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        body: JSON.stringify({
          branchId: branch?.id,
          registerId: activeShift?.registerId,
          shiftId: activeShift?.id,
          customerId: useCartStore.getState().customerId,
          note: holdNote.trim() || undefined,
          items: expandCartItemsForApi(items).map((item) => ({
            productId: item.productId,
            variantId: item.variantId ?? undefined,
            quantity: item.quantity,
            ...(item.unitPrice ? { unitPrice: item.unitPrice } : {}),
            ...(item.promoId ? { promoId: item.promoId } : {}),
          })),
        }),
      }),
    onSuccess: (data) => {
      setHoldModalVisible(false);
      setHoldNote('');
      clearCart();
      queryClient.invalidateQueries({ queryKey: ['pos-held-sales-count'] });
      queryClient.invalidateQueries({ queryKey: ['food-parked-sales'] });
      showAlert({
        title: 'Sale Parked',
        message: `Order parked as ${data.receiptNumber}. You can resume it anytime from Parked Sales.`,
        type: 'success',
      });
      router.replace('/(tabs)/pos');
    },
    onError: (error) =>
      showAlert({
        title: 'Could Not Hold Sale',
        message: error.message,
        type: 'error',
      }),
  });

  return (
    <Screen>
      <Header
        title="Cart"
        subtitle={`${items.reduce((sum, item) => sum + item.quantity, 0)} items`}
        showBack
        backLabel="Shop"
        fallbackHref="/(tabs)/pos"
      />
      <FlatList
        data={items}
        keyExtractor={(item) => cartProductKey(item.product)}
        contentContainerClassName="p-4 gap-3 pb-64"
        ListEmptyComponent={
          <EmptyState title="Cart is empty" message="Add products from the POS screen." />
        }
        renderItem={({ item }) => {
          const hasPromo = activePromo?.appliedProductIds.has(item.product.id);
          return (
            <View className="rounded-2xl border border-slate-100 bg-white p-4">
              <View className="flex-row">
                <View className="flex-1">
                  <View className="flex-row items-center gap-1.5">
                    {item.product.isComboBundle ? (
                      <View className="rounded-md bg-brand-50 px-1.5 py-0.5">
                        <Text className="text-[9px] font-bold uppercase text-brand-800">Combo</Text>
                      </View>
                    ) : null}
                    <Text className="flex-1 font-bold text-slate-900" numberOfLines={2}>
                      {item.product.isComboBundle
                        ? item.product.promoName || item.product.name
                        : item.product.name}
                    </Text>
                  </View>
                  <Text className="mt-1 text-slate-500" numberOfLines={2}>
                    {item.product.isComboBundle
                      ? comboIncludesLabel(item.product.comboComponents)
                      : `${formatMoney(item.product.sellingPrice)} per ${item.product.unit ?? 'piece'}`}
                  </Text>
                  {hasPromo && !item.product.isComboBundle ? (
                    <View className="mt-1.5 flex-row items-center gap-1 self-start rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5">
                      <Feather name="trending-up" size={11} color="#047857" />
                      <Text className="text-[11px] font-bold text-emerald-800">
                        {activePromo?.name || 'Volume Discount Applied'}
                      </Text>
                    </View>
                  ) : null}
                  {!item.product.isComboBundle &&
                  item.product.availableQuantity !== null &&
                  item.product.availableQuantity !== undefined ? (
                    <Text
                      className={`mt-1 text-xs font-bold ${
                        item.quantity > item.product.availableQuantity
                          ? 'text-red-700'
                          : 'text-brand-500'
                      }`}
                    >
                      {item.product.availableQuantity} currently in stock
                    </Text>
                  ) : null}
                </View>
                <Text className="font-bold text-slate-900">{formatMoney(cartLineTotal(item))}</Text>
              </View>
              <View className="mt-4 flex-row items-center gap-3">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Decrease ${item.product.name} quantity`}
                  className="h-12 w-12 items-center justify-center rounded-xl bg-slate-100"
                  onPress={() =>
                    setQuantity(
                      cartProductKey(item.product),
                      item.quantity - quantityStep(item.product),
                    )
                  }
                >
                  <Text className="text-2xl font-bold text-slate-700">-</Text>
                </Pressable>
                <QuantityInput
                  product={item.product}
                  quantity={item.quantity}
                  onChange={(quantity) => setQuantity(cartProductKey(item.product), quantity)}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Increase ${item.product.name} quantity`}
                  accessibilityState={{
                    disabled:
                      !item.product.isComboBundle &&
                      item.product.availableQuantity !== null &&
                      item.product.availableQuantity !== undefined &&
                      item.quantity >= item.product.availableQuantity,
                  }}
                  disabled={
                    !item.product.isComboBundle &&
                    item.product.availableQuantity !== null &&
                    item.product.availableQuantity !== undefined &&
                    item.quantity >= item.product.availableQuantity
                  }
                  className={`h-12 w-12 items-center justify-center rounded-xl bg-brand-100 ${
                    !item.product.isComboBundle &&
                    item.product.availableQuantity !== null &&
                    item.product.availableQuantity !== undefined &&
                    item.quantity >= item.product.availableQuantity
                      ? 'opacity-40'
                      : ''
                  }`}
                  onPress={() =>
                    setQuantity(
                      cartProductKey(item.product),
                      item.quantity + quantityStep(item.product),
                    )
                  }
                >
                  <Text className="text-2xl text-brand-900">+</Text>
                </Pressable>
              </View>
            </View>
          );
        }}
      />
      <View className="absolute bottom-0 left-0 right-0 border-t border-brand-100 bg-white p-3 gap-2 shadow-lg">
        {hasStockConflict ? (
          <Text className="rounded-xl bg-red-50 p-2 text-xs font-bold text-red-700">
            Stock changed on another register. Reduce highlighted quantities.
          </Text>
        ) : null}
        <View className="gap-1 px-1">
          <View className="flex-row items-center justify-between">
            <Text className="text-xs text-slate-500">Subtotal: {formatMoney(subtotal)}</Text>
            {activePromo ? (
              <View className="flex-row items-center gap-1">
                <Feather name="trending-up" size={11} color="#047857" />
                <Text className="text-xs font-bold text-emerald-700">
                  {activePromo.name}: -{formatMoney(activePromo.discountMoney)}
                </Text>
              </View>
            ) : null}
          </View>
          <View className="flex-row items-center justify-between border-t border-slate-100 pt-1">
            <Text className="text-xs font-semibold text-slate-600">Total:</Text>
            <Text className="text-base font-black text-brand-700">{formatMoney(total)}</Text>
          </View>
        </View>

        <View className="flex-row items-center gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open parked sales${heldCount ? `, ${heldCount} parked` : ''}`}
            onPress={() => router.push('/food/parked-sales')}
            className="min-h-11 flex-row items-center justify-center rounded-xl border border-amber-200 bg-amber-50 px-3 active:bg-amber-100"
          >
            <Feather name="pause-circle" size={16} color="#B45309" />
            <Text className="ml-1 text-xs font-bold text-amber-900">
              Parked{heldCount > 0 ? ` (${heldCount})` : ''}
            </Text>
          </Pressable>
          <View className="flex-1">
            <Button
              title="Continue to payment"
              disabled={!items.length || hasStockConflict}
              onPress={() => router.push('/payment')}
            />
          </View>

        </View>

        {items.length > 0 ? (
          <View className="flex-row items-center gap-2">
            <Pressable
              onPress={() => setHoldModalVisible(true)}
              disabled={holdMutation.isPending}
              className={`min-h-10 flex-1 flex-row items-center justify-center rounded-xl bg-amber-600 px-3.5 ${
                holdMutation.isPending ? 'opacity-50' : 'active:bg-amber-700'
              }`}
            >
              <Feather name="pause-circle" size={15} color="#FFFFFF" />
              <Text className="ml-1.5 text-xs font-bold text-white">
                {holdMutation.isPending ? 'Holding…' : 'Hold current sale'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Clear current order"
              onPress={() => {
                clearCart();
                router.back();
              }}
              className="min-h-10 flex-row items-center justify-center rounded-xl border border-red-200 bg-red-50 px-3 active:bg-red-100"
            >
              <Feather name="trash-2" size={15} color="#DC2626" />
              <Text className="ml-1.5 text-xs font-bold text-red-700">Clear</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <Modal visible={holdModalVisible} transparent animationType="fade">
        <View className="flex-1 items-center justify-center bg-black/40 p-5">
          <View className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
            <View className="mb-4 flex-row items-start justify-between">
              <View className="mr-4 flex-1">
                <Text className="text-lg font-bold text-slate-950">Hold Current Sale?</Text>
                <Text className="mt-1 text-sm text-slate-500">
                  Park this order to free up checkout for other customers. You can resume it anytime from Parked Sales.
                </Text>
              </View>
              <Pressable onPress={() => setHoldModalVisible(false)} className="h-9 w-9 items-center justify-center rounded-full bg-slate-100">
                <Feather name="x" size={18} color="#475569" />
              </Pressable>
            </View>
            <View className="mb-5">
              <Field
                label="Optional Customer Tag / Reason"
                value={holdNote}
                onChangeText={setHoldNote}
                placeholder="e.g. Customer stepped out for cash"
              />
            </View>
            <View className="flex-row gap-3">
              <Pressable
                disabled={holdMutation.isPending}
                onPress={() => setHoldModalVisible(false)}
                className="min-h-12 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white"
              >
                <Text className="font-semibold text-slate-700">Cancel</Text>
              </Pressable>
              <Pressable
                disabled={holdMutation.isPending}
                onPress={() => holdMutation.mutate()}
                className={`min-h-12 flex-[2] items-center justify-center rounded-xl bg-amber-600 ${
                  holdMutation.isPending ? 'opacity-50' : 'active:bg-amber-700'
                }`}
              >
                <Text className="font-bold text-white">
                  {holdMutation.isPending ? 'Holding…' : 'Confirm & Park Cart'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
