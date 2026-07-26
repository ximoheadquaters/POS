import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { minorToMoney, moneyToMinor } from '@ximo/shared';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { Button, Field, Header, Screen } from '@/components/ui';
import { cartTotal, useCartStore } from '@/store/cart';
import { useBranchStore } from '@/store/branch';
import { useShiftStore } from '@/store/shift';

interface Receipt {
  id: string;
  receiptNumber: string;
  total: string;
  changeDue: string;
}

export default function PaymentScreen() {
  const items = useCartStore((state) => state.items);
  const customerId = useCartStore((state) => state.customerId);
  const clear = useCartStore((state) => state.clear);
  const branch = useBranchStore((state) => state.activeBranch);
  const shift = useShiftStore((state) => state.activeShift);
  const [discount, setDiscount] = useState('0.00');
  const [cash, setCash] = useState('');
  const [cashReceived, setCashReceived] = useState('');
  const [card, setCard] = useState('');
  const [ewallet, setEwallet] = useState('');
  const total = useMemo(() => cartTotal(items, discount || '0.00'), [discount, items]);
  const remaining = useMemo(() => {
    try {
      const paid = [cash, card, ewallet]
        .filter(Boolean)
        .reduce((sum, value) => sum + moneyToMinor(value), 0n);
      return minorToMoney(moneyToMinor(total) - paid);
    } catch {
      return total;
    }
  }, [card, cash, ewallet, total]);
  const paymentMatches = remaining === '0.00';

  const fillPayment = (method: 'cash' | 'card' | 'ewallet') => {
    setCash(method === 'cash' ? total : '');
    setCashReceived(method === 'cash' ? total : '');
    setCard(method === 'card' ? total : '');
    setEwallet(method === 'ewallet' ? total : '');
  };

  const checkout = useMutation({
    mutationFn: async () => {
      if (!branch || !shift) throw new Error('An active branch and shift are required');
      const payments = [
        cash ? { method: 'cash' as const, amount: cash, tendered: cashReceived || cash } : null,
        card ? { method: 'card' as const, amount: card } : null,
        ewallet ? { method: 'ewallet' as const, amount: ewallet } : null,
      ].filter(Boolean);
      return api<Receipt>('/sales/checkout', {
        method: 'POST',
        idempotencyKey: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        body: JSON.stringify({
          branchId: branch.id,
          registerId: shift.registerId,
          shiftId: shift.id,
          customerId,
          items: items.map((item) => ({ productId: item.product.id, quantity: item.quantity })),
          discount:
            discount && discount !== '0.00' ? { type: 'fixed', value: discount } : undefined,
          payments,
        }),
      });
    },
    onSuccess(receipt) {
      clear();
      router.replace({
        pathname: '/receipt',
        params: {
          id: receipt.id,
          number: receipt.receiptNumber,
          total: receipt.total,
          change: receipt.changeDue,
        },
      });
    },
    onError(error) {
      Alert.alert('Checkout failed', error.message);
    },
  });

  return (
    <Screen>
      <Header
        title="Payment"
        subtitle="Split payments must equal the final total."
        showBack
        backLabel="Cart"
        fallbackHref="/cart"
      />
      <ScrollView contentContainerClassName="p-5 pb-10">
        <View className="mb-6 rounded-2xl bg-brand-700 p-6">
          <Text className="text-brand-100">Amount due</Text>
          <Text className="mt-2 text-4xl font-black text-white">{formatMoney(total)}</Text>
        </View>
        <Field
          label="Fixed discount"
          value={discount}
          onChangeText={setDiscount}
          keyboardType="decimal-pad"
        />
        <Text className="mb-3 mt-2 text-lg font-bold text-slate-900">Quick payment</Text>
        <View className="mb-6 flex-row gap-2">
          {(
            [
              ['cash', 'Cash'],
              ['card', 'Card'],
              ['ewallet', 'E-wallet'],
            ] as const
          ).map(([method, label]) => (
            <Pressable
              key={method}
              accessibilityRole="button"
              onPress={() => fillPayment(method)}
              className="min-h-12 flex-1 items-center justify-center rounded-xl bg-brand-50 px-2 active:bg-brand-100"
            >
              <Text className="text-sm font-bold text-brand-700">{label}</Text>
            </Pressable>
          ))}
        </View>
        <Text className="mb-1 text-lg font-bold text-slate-900">Payment split</Text>
        <Text className="mb-4 text-sm leading-5 text-slate-500">
          Use one method above, or divide the total across multiple methods below.
        </Text>
        <Field
          label="Cash payment amount"
          value={cash}
          onChangeText={setCash}
          keyboardType="decimal-pad"
        />
        {cash ? (
          <Field
            label="Cash received"
            value={cashReceived}
            onChangeText={setCashReceived}
            keyboardType="decimal-pad"
            placeholder={cash}
          />
        ) : null}
        <Field label="Card amount" value={card} onChangeText={setCard} keyboardType="decimal-pad" />
        <Field
          label="E-wallet amount"
          value={ewallet}
          onChangeText={setEwallet}
          keyboardType="decimal-pad"
        />
        <View
          className={`mb-5 flex-row items-center justify-between rounded-2xl p-4 ${paymentMatches ? 'bg-brand-50' : 'bg-slate-100'}`}
        >
          <Text className={`font-bold ${paymentMatches ? 'text-brand-700' : 'text-slate-600'}`}>
            {paymentMatches ? 'Payment matches total' : 'Remaining'}
          </Text>
          <Text
            className={`text-lg font-black ${paymentMatches ? 'text-brand-700' : 'text-slate-900'}`}
          >
            {paymentMatches ? 'Ready' : formatMoney(remaining)}
          </Text>
        </View>
        <Button
          title={checkout.isPending ? 'Completing sale…' : `Complete · ${formatMoney(total)}`}
          disabled={checkout.isPending || !items.length || !paymentMatches}
          onPress={() =>
            Alert.alert('Complete sale?', 'Inventory and register totals will be updated.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Complete', onPress: () => checkout.mutate() },
            ])
          }
        />
      </ScrollView>
    </Screen>
  );
}
