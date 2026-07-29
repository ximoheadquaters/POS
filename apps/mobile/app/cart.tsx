import { FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { formatMoney } from '@/lib/format';
import { Button, EmptyState, Header, Screen } from '@/components/ui';
import { QuantityInput } from '@/components/quantity-input';
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
  const items = useCartStore((state) => state.items);
  const setQuantity = useCartStore((state) => state.setQuantity);
  const subtotal = cartSubtotal(items);
  const total = cartTotal(items);
  const hasStockConflict = hasCartStockConflict(items);
  return (
    <Screen>
      <Header
        title="Cart"
        subtitle={`${items.length} products`}
        showBack
        backLabel="Shop"
        fallbackHref="/(tabs)/pos"
      />
      <FlatList
        data={items}
        keyExtractor={(item) => cartProductKey(item.product)}
        contentContainerClassName="p-4 gap-3 pb-52"
        ListEmptyComponent={
          <EmptyState title="Cart is empty" message="Add products from the POS screen." />
        }
        renderItem={({ item }) => (
          <View className="rounded-2xl border border-slate-100 bg-white p-4">
            <View className="flex-row">
              <View className="flex-1">
                <Text className="font-bold text-slate-900">{item.product.name}</Text>
                <Text className="mt-1 text-slate-500">
                  {formatMoney(item.product.sellingPrice)} per {item.product.unit ?? 'piece'}
                </Text>
                {item.product.availableQuantity !== null &&
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
                    item.product.availableQuantity !== null &&
                    item.product.availableQuantity !== undefined &&
                    item.quantity >= item.product.availableQuantity,
                }}
                disabled={
                  item.product.availableQuantity !== null &&
                  item.product.availableQuantity !== undefined &&
                  item.quantity >= item.product.availableQuantity
                }
                className={`h-12 w-12 items-center justify-center rounded-xl bg-brand-100 ${
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
        )}
      />
      <View className="absolute bottom-0 left-0 right-0 border-t border-brand-100 bg-white p-5">
        {hasStockConflict ? (
          <Text className="mb-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">
            Stock changed on another register. Reduce the highlighted quantities before payment.
          </Text>
        ) : null}
        <View className="mb-2 flex-row justify-between">
          <Text className="text-slate-500">Subtotal before tax</Text>
          <Text className="font-semibold">{formatMoney(subtotal)}</Text>
        </View>
        <View className="mb-4 flex-row justify-between">
          <Text className="text-lg font-bold">Estimated total</Text>
          <Text className="text-xl font-black text-brand-700">{formatMoney(total)}</Text>
        </View>
        <Button
          title="Continue to payment"
          disabled={!items.length || hasStockConflict}
          onPress={() => router.push('/payment')}
        />
      </View>
    </Screen>
  );
}
