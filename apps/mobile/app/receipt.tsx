import { Alert, Platform, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, Header, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { getHardwareDriver, HardwareUnavailableError } from '@/hardware/registry';
import { useSession } from '@/providers/session';

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
  const params = useLocalSearchParams<{
    id: string;
    number: string;
    total: string;
    change: string;
    offline?: string;
  }>();
  const offline = params.offline === '1';
  const printerEnabled = currentUser?.modules.includes('receipt_printer') ?? false;
  const sale = useQuery({
    queryKey: ['sale-receipt', params.id],
    queryFn: () => api<PrintableSale>(`/sales/${params.id}`),
    enabled: Boolean(params.id) && !offline,
  });
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
    onSuccess: () => {
      if (Platform.OS !== 'web') Alert.alert('Receipt printed');
    },
    onError: (error) => Alert.alert('Could not print receipt', error.message),
  });
  const handlePrint = async () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const itemsHtml = (sale.data?.items || [])
        .map(
          (item) => `
        <tr>
          <td style="text-align:left; padding: 4px 0;">${item.productName}<br/><small style="color:#666;">${item.quantity} × ₱${Number(item.unitPrice).toFixed(2)}</small></td>
          <td style="text-align:right; vertical-align:top; padding: 4px 0;">₱${Number(item.lineTotal).toFixed(2)}</td>
        </tr>`,
        )
        .join('');

      const paymentsHtml = (sale.data?.payments || [])
        .map(
          (p) => `
        <div style="display:flex; justify-space-between; margin-top:2px;">
          <span>${p.method.toUpperCase()}</span>
          <span>₱${Number(p.amount).toFixed(2)}</span>
        </div>`,
        )
        .join('');

      const printWindow = window.open('', '_blank', 'width=400,height=600');
      if (printWindow) {
        printWindow.document.write(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Receipt - ${params.number}</title>
            <style>
              @media print {
                body { margin: 0; padding: 10px; font-family: monospace; font-size: 12px; }
                @page { size: 80mm auto; margin: 0; }
              }
              body { font-family: 'Courier New', Courier, monospace; width: 300px; margin: 0 auto; padding: 15px; background: #fff; color: #000; }
              .header { text-align: center; border-bottom: 1px dashed #000; padding-bottom: 10px; margin-bottom: 10px; }
              .header h2 { margin: 0; font-size: 16px; text-transform: uppercase; }
              .header p { margin: 2px 0; font-size: 11px; color: #444; }
              .details { font-size: 11px; margin-bottom: 10px; border-bottom: 1px dashed #000; padding-bottom: 8px; }
              .items { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 11px; }
              .totals { border-top: 1px dashed #000; padding-top: 8px; font-size: 12px; }
              .totals div { display: flex; justify-content: space-between; margin-bottom: 3px; }
              .grand-total { font-weight: bold; font-size: 14px; margin-top: 5px; border-top: 1px solid #000; padding-top: 5px; }
              .footer { text-align: center; margin-top: 15px; font-size: 10px; color: #666; border-top: 1px dashed #000; padding-top: 10px; }
            </style>
          </head>
          <body>
            <div class="header">
              <h2>${currentUser?.organization.name || 'XIMO POS'}</h2>
              <p>${sale.data?.branchName || ''}</p>
              ${sale.data?.branchAddress ? `<p>${sale.data.branchAddress}</p>` : ''}
            </div>
            <div class="details">
              <div><strong>Receipt:</strong> ${params.number}</div>
              <div><strong>Date:</strong> ${sale.data?.completedAt ? new Date(sale.data.completedAt).toLocaleString() : new Date().toLocaleString()}</div>
              <div><strong>Cashier:</strong> ${sale.data?.cashierName || currentUser?.displayName || 'Cashier'}</div>
            </div>
            <table class="items">
              <tbody>
                ${itemsHtml}
              </tbody>
            </table>
            <div class="totals">
              <div><span>Subtotal:</span> <span>₱${Number(sale.data?.subtotal || params.total).toFixed(2)}</span></div>
              ${sale.data?.discountTotal && Number(sale.data.discountTotal) > 0 ? `<div><span>Discount:</span> <span>-₱${Number(sale.data.discountTotal).toFixed(2)}</span></div>` : ''}
              ${sale.data?.taxTotal && Number(sale.data.taxTotal) > 0 ? `<div><span>Tax:</span> <span>₱${Number(sale.data.taxTotal).toFixed(2)}</span></div>` : ''}
              <div class="grand-total"><span>TOTAL:</span> <span>₱${Number(params.total).toFixed(2)}</span></div>
              <div><span>Change:</span> <span>₱${Number(params.change || 0).toFixed(2)}</span></div>
            </div>
            ${paymentsHtml ? `<div style="margin-top:8px; font-size:11px;"><strong>Payments:</strong>${paymentsHtml}</div>` : ''}
            <div class="footer">
              <p>Thank you for your purchase!</p>
              <p>Powered by Ximo POS</p>
            </div>
            <script>
              window.onload = function() {
                window.print();
                setTimeout(function() { window.close(); }, 500);
              };
            </script>
          </body>
          </html>
        `);
        printWindow.document.close();
        return;
      }
    }
    print.mutate();
  };

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
                disabled={print.isPending || sale.isLoading}
                onPress={handlePrint}
              />
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
