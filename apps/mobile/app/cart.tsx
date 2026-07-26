import { FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { minorToMoney, moneyToMinor } from '@ximo/shared';
import { formatMoney } from '@/lib/format';
import { Button, EmptyState, Header, Screen } from '@/components/ui';
import { cartSubtotal, cartTotal, useCartStore } from '@/store/cart';

export default function CartScreen() {
  const items = useCartStore((state) => state.items);
  const setQuantity = useCartStore((state) => state.setQuantity);
  const subtotal = cartSubtotal(items);
  const total = cartTotal(items);
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
        keyExtractor={(item) => item.product.id}
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
                  {formatMoney(item.product.sellingPrice)} each
                </Text>
              </View>
              <Text className="font-bold text-slate-900">
                {formatMoney(
                  minorToMoney(moneyToMinor(item.product.sellingPrice) * BigInt(item.quantity)),
                )}
              </Text>
            </View>
            <View className="mt-4 flex-row items-center gap-3">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Decrease ${item.product.name} quantity`}
                className="h-12 w-12 items-center justify-center rounded-xl bg-slate-100"
                onPress={() => setQuantity(item.product.id, item.quantity - 1)}
              >
                <Text className="text-2xl font-bold text-slate-700">-</Text>
              </Pressable>
              <Text className="min-w-10 text-center text-lg font-bold">{item.quantity}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Increase ${item.product.name} quantity`}
                className="h-12 w-12 items-center justify-center rounded-xl bg-brand-100"
                onPress={() => setQuantity(item.product.id, item.quantity + 1)}
              >
                <Text className="text-2xl text-brand-900">+</Text>
              </Pressable>
            </View>
          </View>
        )}
      />
      <View className="absolute bottom-0 left-0 right-0 border-t border-brand-100 bg-white p-5">
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
          disabled={!items.length}
          onPress={() => router.push('/payment')}
        />
      </View>
    </Screen>
  );
}
