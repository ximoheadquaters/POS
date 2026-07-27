import { Alert, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { Button, Header, Screen } from '@/components/ui';
import { formatMoney } from '@/lib/format';
import { getHardwareDriver, HardwareUnavailableError } from '@/hardware/registry';
import { useSession } from '@/providers/session';

export default function ReceiptScreen() {
  const { currentUser } = useSession();
  const params = useLocalSearchParams<{
    id: string;
    number: string;
    total: string;
    change: string;
  }>();
  const printerEnabled = currentUser?.modules.includes('receipt_printer') ?? false;
  const print = useMutation({
    mutationFn: async () => {
      const printer = getHardwareDriver('receipt_printer');
      const status = await printer.status();
      if (status.state !== 'ready') {
        throw new HardwareUnavailableError('receipt_printer', status.detail);
      }
      await printer.print({
        saleId: params.id,
        receiptNumber: params.number,
        total: params.total,
        changeDue: params.change,
      });
    },
    onSuccess: () => Alert.alert('Receipt printed'),
    onError: (error) => Alert.alert('Could not print receipt', error.message),
  });
  return (
    <Screen>
      <Header title="Sale complete" />
      <View className="flex-1 items-center justify-center px-6">
        <View className="w-full max-w-lg rounded-3xl bg-white p-7">
          <View className="mx-auto h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <Text className="text-3xl text-emerald-700">✓</Text>
          </View>
          <Text className="mt-5 text-center text-sm text-slate-500">Receipt</Text>
          <Text className="text-center text-xl font-bold text-slate-900">{params.number}</Text>
          <Text className="mt-7 text-center text-4xl font-black text-brand-700">
            {formatMoney(params.total)}
          </Text>
          <Text className="mt-2 text-center text-slate-500">
            Change: {formatMoney(params.change)}
          </Text>
          <View className="mt-8 gap-3">
            {printerEnabled ? (
              <Button
                title={print.isPending ? 'Printing…' : 'Print receipt'}
                disabled={print.isPending}
                onPress={() => print.mutate()}
              />
            ) : null}
            <Button
              title="View receipt details"
              variant="secondary"
              onPress={() => router.replace(`/sale/${params.id}`)}
            />
            <Button title="New sale" onPress={() => router.replace('/(tabs)/pos')} />
          </View>
        </View>
      </View>
    </Screen>
  );
}
