import { useEffect, useRef } from 'react';
import { Alert, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, Header, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { getHardwareDriver, HardwareUnavailableError } from '@/hardware/registry';
import {
  applyReceiptPrinterSettings,
  DEFAULT_RECEIPT_PRINTER_SETTINGS,
  getReceiptPrinterSettings,
} from '@/hardware/receipt-printer-settings';
import { useSession } from '@/providers/session';
import { useBranchStore } from '@/store/branch';

interface PrintableSale {
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  branchName: string;
  branchAddress?: string | null;
  cashierName: string;
  completedAt: string;
  items: Array<{
    productName: string;
    quantity: number;
    unitPrice: string;
    lineTotal: string;
  }>;
  payments: Array<{ method: string; amount: string }>;
}

export default function ReceiptScreen() {
  const { currentUser } = useSession();
  const branch = useBranchStore((state) => state.activeBranch);
  const params = useLocalSearchParams<{
    id: string;
    number: string;
    total: string;
    change: string;
    offline?: string;
  }>();
  const offline = params.offline === '1';
  const printerEnabled = currentUser?.modules.includes('receipt_printer') ?? false;
  const printerSettingsQuery = useQuery({
    queryKey: ['receipt-printer-settings', currentUser?.organization.id, branch?.id],
    queryFn: () => getReceiptPrinterSettings(currentUser?.organization.id, branch?.id),
  });
  const printerSettings = printerSettingsQuery.data ?? DEFAULT_RECEIPT_PRINTER_SETTINGS;
  const sale = useQuery({
    queryKey: ['sale-receipt', params.id],
    queryFn: () => api<PrintableSale>(`/sales/${params.id}`),
    enabled: Boolean(params.id) && !offline,
  });
  const print = useMutation({
    mutationFn: async () => {
      if (!printerEnabled) {
        throw new HardwareUnavailableError(
          'receipt_printer',
          'Enable the receipt-printer module in Hardware devices before printing.',
        );
      }
      const printer = getHardwareDriver('receipt_printer');
      const status = await printer.status();
      if (status.state !== 'ready') {
        throw new HardwareUnavailableError('receipt_printer', status.detail);
      }
      await printer.print({
        saleId: params.id,
        receiptNumber: params.number,
        ...applyReceiptPrinterSettings(printerSettings),
        businessName: currentUser?.organization.name,
        branchName: sale.data?.branchName,
        branchAddress: sale.data?.branchAddress,
        cashierName: sale.data?.cashierName ?? currentUser?.displayName,
        completedAt: sale.data?.completedAt,
        currency: currentUser?.organization.currency,
        subtotal: sale.data?.subtotal,
        discountTotal: sale.data?.discountTotal,
        taxTotal: sale.data?.taxTotal,
        total: params.total,
        changeDue: params.change,
        items: sale.data?.items,
        payments: sale.data?.payments,
      });
    },
    onError: (error) => Alert.alert('Could not print receipt', error.message),
  });
  const autoPrintAttempt = useRef<string | null>(null);
  useEffect(() => {
    if (
      offline ||
      !printerEnabled ||
      !printerSettings.autoPrintAfterSale ||
      printerSettingsQuery.isLoading ||
      sale.isLoading ||
      !sale.data ||
      autoPrintAttempt.current === params.id
    ) {
      return;
    }

    autoPrintAttempt.current = params.id;
    print.mutate();
  }, [
    offline,
    params.id,
    printerEnabled,
    printerSettings.autoPrintAfterSale,
    printerSettingsQuery.isLoading,
    sale.data,
    sale.isLoading,
  ]);

  return (
    <Screen>
      <Header title={offline ? 'Sale saved offline' : 'Sale complete'} />
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
          {offline ? (
            <Text className="mt-4 rounded-xl bg-amber-50 p-3 text-center text-sm text-amber-900">
              This cash sale is stored on this device and will sync automatically when internet
              access returns.
            </Text>
          ) : null}
          <View className="mt-8 gap-3">
            {!offline ? (
              <Button
                title={
                  print.isPending
                    ? 'Printing…'
                    : sale.isLoading
                      ? 'Loading receipt…'
                      : 'Print receipt'
                }
                disabled={
                  print.isPending ||
                  sale.isLoading ||
                  printerSettingsQuery.isLoading ||
                  !printerEnabled
                }
                onPress={() => print.mutate()}
              />
            ) : null}
            {!offline && !printerEnabled ? (
              <Text className="text-center text-xs leading-4 text-amber-700">
                Enable Receipt printer under Hardware devices to print from Ximo.
              </Text>
            ) : null}
            {!offline ? (
              <Button
                title="View receipt details"
                variant="secondary"
                onPress={() => router.replace(`/sale/${params.id}`)}
              />
            ) : null}
            <Button title="New sale" onPress={() => router.replace('/(tabs)/pos')} />
          </View>
        </View>
      </View>
    </Screen>
  );
}
