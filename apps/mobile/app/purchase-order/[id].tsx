import { useEffect, useMemo, useRef, useState } from 'react';
import { appAlert } from '@/providers/ios-alert';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { Button, ErrorState, Field, Header, LoadingState, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import { formatMoney } from '@/lib/format';
import {
  PURCHASE_STATUS_LABELS,
  statusColors,
  type PurchaseOrderDetail,
  type SupplierInvoice,
  type SupplierPaymentSource,
} from '@/lib/purchasing';
import { useSession } from '@/providers/session';
import { useShiftStore } from '@/store/shift';

type WorkMode = 'receive' | 'return' | null;
type SupplierReturnRecord = PurchaseOrderDetail['returns'][number];
type SupplierPaymentRecord = SupplierInvoice['payments'][number];

const PAYMENT_SOURCES: Array<{
  value: SupplierPaymentSource;
  label: string;
  description: string;
}> = [
  {
    value: 'cashier_drawer',
    label: 'Cashier drawer',
    description: 'Creates a Cash Out in your active shift',
  },
  { value: 'owner_cash', label: 'Owner cash', description: 'Cash outside the register' },
  { value: 'bank_transfer', label: 'Bank transfer', description: 'Does not affect the drawer' },
  { value: 'ewallet', label: 'E-wallet', description: 'Does not affect the drawer' },
  { value: 'cheque', label: 'Cheque', description: 'Does not affect the drawer' },
];

function localDateInput(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function payableStatusStyle(status: SupplierInvoice['status']): string {
  if (status === 'paid') return 'bg-brand-50 text-brand-700';
  if (status === 'overdue') return 'bg-red-50 text-red-700';
  if (status === 'partially_paid') return 'bg-amber-50 text-amber-700';
  if (status === 'disputed') return 'bg-purple-50 text-purple-700';
  return 'bg-slate-100 text-slate-600';
}

function QuantityField({
  value,
  onChange,
  maximum,
}: {
  value: string;
  onChange(value: string): void;
  maximum: number;
}) {
  return (
    <View className="flex-row items-center gap-2">
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        className="min-h-11 w-28 rounded-xl bg-slate-100 px-3 text-right text-slate-900"
      />
      <Pressable
        onPress={() => onChange(String(maximum))}
        className="min-h-10 justify-center rounded-xl bg-brand-50 px-3"
      >
        <Text className="text-xs font-medium text-brand-700">All</Text>
      </Pressable>
    </View>
  );
}

function PurchaseOrderContent() {
  const { id, action } = useLocalSearchParams<{ id: string; action?: 'return' }>();
  const { currentUser } = useSession();
  const activeShift = useShiftStore((state) => state.activeShift);
  const client = useQueryClient();
  const scrollViewRef = useRef<ScrollView>(null);
  const initialActionHandled = useRef(false);
  const [mode, setMode] = useState<WorkMode>(null);
  const [workPanelOffset, setWorkPanelOffset] = useState(0);
  const [returnConfirmationVisible, setReturnConfirmationVisible] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [deliveryInvoiceNumber, setDeliveryInvoiceNumber] = useState('');
  const [supplierReturnReference, setSupplierReturnReference] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [resolution, setResolution] = useState<'refund' | 'replacement' | 'supplier_credit'>(
    'supplier_credit',
  );
  const [invoiceModalVisible, setInvoiceModalVisible] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(localDateInput());
  const [invoiceDueDate, setInvoiceDueDate] = useState('');
  const [invoiceTotal, setInvoiceTotal] = useState('');
  const [invoiceNotes, setInvoiceNotes] = useState('');
  const [paymentInvoice, setPaymentInvoice] = useState<SupplierInvoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentSource, setPaymentSource] = useState<SupplierPaymentSource>('cashier_drawer');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [paymentIdempotencyKey, setPaymentIdempotencyKey] = useState('');
  const [refundReturn, setRefundReturn] = useState<SupplierReturnRecord | null>(null);
  const [refundPayment, setRefundPayment] = useState<SupplierPaymentRecord | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReference, setRefundReference] = useState('');
  const [refundNotes, setRefundNotes] = useState('');
  const [refundIdempotencyKey, setRefundIdempotencyKey] = useState('');
  const query = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: () => api<PurchaseOrderDetail>(`/purchase-orders/${id}`),
    enabled: Boolean(id),
  });
  const order = query.data;
  useEffect(() => {
    if (!order || !mode) return;
    setQuantities(
      Object.fromEntries(
        order.items.map((item) => [
          item.id,
          String(
            mode === 'receive' ? Math.max(0, item.orderedQuantity - item.receivedQuantity) : 0,
          ),
        ]),
      ),
    );
  }, [mode, order]);
  useEffect(() => {
    if (
      initialActionHandled.current ||
      action !== 'return' ||
      !order ||
      !currentUser?.permissions.includes('purchasing:return')
    ) {
      return;
    }
    initialActionHandled.current = true;
    if (
      ['partially_received', 'received'].includes(order.status) &&
      order.items.some((item) => item.receivedQuantity > item.returnedQuantity)
    ) {
      setMode('return');
    }
  }, [action, currentUser?.permissions, order]);
  useEffect(() => {
    if (!mode || !workPanelOffset) return;
    const timer = setTimeout(() => {
      scrollViewRef.current?.scrollTo({
        y: Math.max(workPanelOffset - 16, 0),
        animated: true,
      });
    }, 100);
    return () => clearTimeout(timer);
  }, [mode, workPanelOffset]);
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['purchase-order', id] }),
      client.invalidateQueries({ queryKey: ['purchase-orders'] }),
      client.invalidateQueries({ queryKey: ['returnable-purchase-orders'] }),
      client.invalidateQueries({ queryKey: ['purchase-returns'] }),
      client.invalidateQueries({ queryKey: ['inventory'] }),
      client.invalidateQueries({ queryKey: ['pos-products'] }),
    ]);
  };
  const transition = useMutation({
    mutationFn: async (action: 'send' | 'cancel') => {
      const approved = await confirmAction(
        action === 'send' ? 'Send purchase order?' : 'Cancel purchase order?',
        action === 'send'
          ? 'The order becomes available for stock receiving. Inventory will not change yet.'
          : 'This draft/order will remain in history and cannot be received.',
        action === 'send' ? 'Send order' : 'Cancel order',
      );
      if (!approved) return null;
      return api(`/purchase-orders/${id}/${action}`, { method: 'POST' });
    },
    onSuccess: async (result) => {
      if (result) await refresh();
    },
    onError: (error) => appAlert('Could not update order', error.message),
  });
  const receive = useMutation({
    mutationFn: () =>
      api(`/purchase-orders/${id}/receipts`, {
        method: 'POST',
        body: JSON.stringify({
          supplierInvoiceNumber: deliveryInvoiceNumber,
          notes,
          items: Object.entries(quantities)
            .filter(([, quantity]) => Number(quantity) > 0)
            .map(([purchaseOrderItemId, quantity]) => ({
              purchaseOrderItemId,
              quantity: Number(quantity),
            })),
        }),
      }),
    onSuccess: async () => {
      setMode(null);
      setDeliveryInvoiceNumber('');
      setNotes('');
      await refresh();
      appAlert('Stock received', 'Branch inventory and the movement ledger were updated.');
    },
    onError: (error) => appAlert('Could not receive stock', error.message),
  });
  const createReturn = useMutation({
    mutationFn: () => {
      const returnedLines = Object.entries(quantities)
        .filter(([, quantity]) => Number(quantity) > 0)
        .map(([purchaseOrderItemId, quantity]) => ({
          purchaseOrderItemId,
          quantity: Number(quantity),
        }));
      return api(`/purchase-orders/${id}/returns`, {
        method: 'POST',
        body: JSON.stringify({
          reason,
          resolution,
          supplierReference: supplierReturnReference,
          notes,
          items: returnedLines,
        }),
      });
    },
    onSuccess: async () => {
      setReturnConfirmationVisible(false);
      setMode(null);
      setReason('');
      setSupplierReturnReference('');
      setNotes('');
      await refresh();
      appAlert(
        'Supplier return recorded',
        'Returned quantities were removed from branch stock.',
      );
    },
    onError: () => setReturnConfirmationVisible(false),
  });
  const createInvoice = useMutation({
    mutationFn: () => {
      const matchingReceipt = order?.receipts.find(
        (receipt) =>
          receipt.supplierInvoiceNumber &&
          receipt.supplierInvoiceNumber.trim() === invoiceNumber.trim(),
      );
      return api(`/purchase-orders/${id}/invoices`, {
        method: 'POST',
        body: JSON.stringify({
          stockReceiptId: matchingReceipt?.id ?? null,
          invoiceNumber,
          invoiceDate,
          dueDate: invoiceDueDate.trim() || null,
          total: Number(invoiceTotal).toFixed(2),
          notes: invoiceNotes,
        }),
      });
    },
    onSuccess: async () => {
      setInvoiceModalVisible(false);
      setInvoiceNumber('');
      setInvoiceDueDate('');
      setInvoiceNotes('');
      await refresh();
      appAlert('Supplier invoice recorded', 'The amount is now tracked as payable.');
    },
  });
  const payInvoice = useMutation({
    mutationFn: () => {
      if (!paymentInvoice) throw new Error('Select a supplier invoice');
      if (paymentSource === 'cashier_drawer') {
        if (!activeShift || activeShift.branchId !== order?.branchId) {
          throw new Error(
            'Open a register shift for this branch before using money from the cashier drawer.',
          );
        }
      }
      return api(`/purchase-orders/invoices/${paymentInvoice.id}/payments`, {
        method: 'POST',
        idempotencyKey: paymentIdempotencyKey,
        body: JSON.stringify({
          amount: Number(paymentAmount).toFixed(2),
          source: paymentSource,
          registerId: paymentSource === 'cashier_drawer' ? activeShift?.registerId : null,
          shiftId: paymentSource === 'cashier_drawer' ? activeShift?.id : null,
          reference: paymentReference,
          notes: paymentNotes,
        }),
      });
    },
    onSuccess: async () => {
      setPaymentInvoice(null);
      setPaymentReference('');
      setPaymentNotes('');
      await refresh();
      appAlert(
        'Supplier payment recorded',
        paymentSource === 'cashier_drawer'
          ? 'The payable and cashier shift Cash Out were updated.'
          : 'The payable balance was updated. The cashier drawer was not affected.',
      );
    },
  });
  const recordSupplierRefund = useMutation({
    mutationFn: () => {
      if (!refundReturn || !refundPayment) throw new Error('Select the original supplier payment');
      const drawerRefund = refundPayment.source === 'cashier_drawer';
      if (drawerRefund && (!activeShift || activeShift.branchId !== order?.branchId)) {
        throw new Error(
          'Open a register shift for this branch before receiving cash back into the drawer.',
        );
      }
      return api(`/purchase-orders/returns/${refundReturn.id}/refunds`, {
        method: 'POST',
        idempotencyKey: refundIdempotencyKey,
        body: JSON.stringify({
          supplierPaymentId: refundPayment.id,
          amount: Number(refundAmount).toFixed(2),
          registerId: drawerRefund ? activeShift?.registerId : null,
          shiftId: drawerRefund ? activeShift?.id : null,
          reference: refundReference,
          notes: refundNotes,
        }),
      });
    },
    onSuccess: async () => {
      const drawerRefund = refundPayment?.source === 'cashier_drawer';
      setRefundReturn(null);
      setRefundPayment(null);
      setRefundReference('');
      setRefundNotes('');
      await refresh();
      appAlert(
        'Supplier refund recorded',
        drawerRefund
          ? 'The actual refund amount was added to the active cashier shift as Cash In.'
          : 'The refund was recorded against its original payment source. The cashier drawer was not changed.',
      );
    },
  });
  const openInvoiceModal = () => {
    const receiptInvoice =
      order?.receipts.find((receipt) => receipt.supplierInvoiceNumber)?.supplierInvoiceNumber ?? '';
    setInvoiceNumber(receiptInvoice);
    setInvoiceDate(localDateInput());
    setInvoiceDueDate('');
    setInvoiceTotal(order?.subtotal ?? '');
    setInvoiceNotes('');
    createInvoice.reset();
    setInvoiceModalVisible(true);
  };
  const openPaymentModal = (invoice: SupplierInvoice) => {
    setPaymentInvoice(invoice);
    setPaymentAmount(Number(invoice.balance).toFixed(2));
    setPaymentSource(activeShift?.branchId === order?.branchId ? 'cashier_drawer' : 'owner_cash');
    setPaymentReference('');
    setPaymentNotes('');
    setPaymentIdempotencyKey(`${Date.now()}-${Math.random().toString(36).slice(2)}`);
    payInvoice.reset();
  };
  const openRefundModal = (supplierReturn: SupplierReturnRecord) => {
    const preferred =
      refundablePayments.find(
        (payment) =>
          payment.source !== 'cashier_drawer' || activeShift?.branchId === order?.branchId,
      ) ??
      refundablePayments[0] ??
      null;
    setRefundReturn(supplierReturn);
    setRefundPayment(preferred);
    setRefundAmount(
      preferred
        ? Math.min(
            Number(supplierReturn.remainingRefund),
            Number(preferred.refundableAmount),
          ).toFixed(2)
        : '',
    );
    setRefundReference('');
    setRefundNotes('');
    setRefundIdempotencyKey(`${Date.now()}-${Math.random().toString(36).slice(2)}`);
    recordSupplierRefund.reset();
  };
  const selectedCount = useMemo(
    () => Object.values(quantities).filter((quantity) => Number(quantity) > 0).length,
    [quantities],
  );
  const selectedReturnQuantity = useMemo(
    () =>
      Object.values(quantities).reduce(
        (total, quantity) => total + (Number(quantity) > 0 ? Number(quantity) : 0),
        0,
      ),
    [quantities],
  );
  const refundablePayments = useMemo(
    () =>
      order?.supplierInvoices
        .flatMap((invoice) =>
          invoice.payments.map((payment) => ({
            ...payment,
            invoiceNumber: invoice.invoiceNumber,
          })),
        )
        .filter((payment) => Number(payment.refundableAmount) > 0) ?? [],
    [order],
  );
  if (query.isLoading) {
    return (
      <Screen>
        <Header title="Purchase order" showBack backLabel="Purchasing" fallbackHref="/purchasing" />
        <LoadingState />
      </Screen>
    );
  }
  if (query.isError || !order) {
    return (
      <Screen>
        <Header title="Purchase order" showBack backLabel="Purchasing" fallbackHref="/purchasing" />
        <ErrorState
          message={query.error?.message ?? 'Purchase order was not found'}
          retry={() => void query.refetch()}
        />
      </Screen>
    );
  }
  const canReceive =
    currentUser?.permissions.includes('purchasing:receive') &&
    ['ordered', 'partially_received'].includes(order.status);
  const canReturn =
    currentUser?.permissions.includes('purchasing:return') &&
    ['partially_received', 'received'].includes(order.status) &&
    order.items.some((item) => item.receivedQuantity > item.returnedQuantity);
  return (
    <Screen>
      <Header
        title={order.orderNumber}
        subtitle={`${order.supplierName} · ${order.branchName}`}
        showBack
        backLabel="Purchasing"
        fallbackHref="/purchasing"
      />
      <ScrollView ref={scrollViewRef} contentContainerClassName="items-center p-4 pb-12">
        <View className="w-full max-w-5xl gap-5">
          <View className="rounded-2xl border border-slate-200 bg-white p-5">
            <View className="flex-row flex-wrap items-start justify-between gap-4">
              <View>
                <View
                  className={`self-start rounded-full px-3 py-1.5 ${statusColors(order.status)}`}
                >
                  <Text className="text-xs font-medium">
                    {PURCHASE_STATUS_LABELS[order.status]}
                  </Text>
                </View>
                <Text className="mt-3 text-xl font-semibold text-slate-900">
                  {order.supplierName}
                </Text>
                <Text className="mt-1 text-sm text-slate-500">
                  Created by {order.createdBy} · {new Date(order.createdAt).toLocaleString()}
                </Text>
                {order.expectedAt ? (
                  <Text className="mt-1 text-sm text-slate-500">
                    Expected {new Date(order.expectedAt).toLocaleDateString()}
                  </Text>
                ) : null}
              </View>
              <View className="items-end">
                <Text className="text-sm text-slate-500">Order total</Text>
                <Text className="mt-1 text-2xl font-semibold text-brand-900">
                  {formatMoney(order.subtotal)}
                </Text>
              </View>
            </View>
            {order.notes || order.supplierReference ? (
              <View className="mt-5 border-t border-slate-100 pt-4">
                {order.supplierReference ? (
                  <Text className="text-sm text-slate-600">
                    Supplier reference: {order.supplierReference}
                  </Text>
                ) : null}
                {order.notes ? (
                  <Text className="mt-1 text-sm text-slate-500">{order.notes}</Text>
                ) : null}
              </View>
            ) : null}
            <View className="mt-5 flex-row flex-wrap gap-2">
              {order.status === 'draft' &&
              currentUser?.permissions.includes('purchasing:manage') ? (
                <Button
                  title={transition.isPending ? 'Sending…' : 'Send to supplier'}
                  disabled={transition.isPending}
                  onPress={() => transition.mutate('send')}
                />
              ) : null}
              {canReceive ? (
                <Button title="Receive stock" onPress={() => setMode('receive')} />
              ) : null}
              {canReturn ? (
                <Button
                  title="Return to supplier"
                  variant="secondary"
                  onPress={() => setMode('return')}
                />
              ) : null}
              {['draft', 'ordered'].includes(order.status) &&
              currentUser?.permissions.includes('purchasing:manage') ? (
                <Button
                  title="Cancel order"
                  variant="danger"
                  disabled={transition.isPending}
                  onPress={() => transition.mutate('cancel')}
                />
              ) : null}
            </View>
          </View>

          {mode ? (
            <View
              onLayout={(event) => setWorkPanelOffset(event.nativeEvent.layout.y)}
              className="rounded-2xl border border-brand-200 bg-white p-5"
            >
              <View className="mb-5 flex-row items-start">
                <View
                  className={`mr-3 h-10 w-10 items-center justify-center rounded-xl ${
                    mode === 'receive' ? 'bg-brand-50' : 'bg-red-50'
                  }`}
                >
                  <Feather
                    name={mode === 'receive' ? 'download' : 'corner-up-left'}
                    size={18}
                    color={mode === 'receive' ? '#1A593B' : '#B42318'}
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-lg font-semibold text-slate-900">
                    {mode === 'receive' ? 'Receive this delivery' : 'Return items to supplier'}
                  </Text>
                  <Text className="mt-1 text-sm leading-5 text-slate-500">
                    Enter quantities in the ordered unit. Ximo will convert packs, boxes, and weight
                    units into base inventory automatically.
                  </Text>
                </View>
                <Pressable
                  onPress={() => setMode(null)}
                  className="h-10 w-10 items-center justify-center"
                >
                  <Feather name="x" size={20} color="#81776E" />
                </Pressable>
              </View>
              <View className="overflow-hidden rounded-xl border border-slate-200">
                {order.items.map((item, index) => {
                  const maximum =
                    mode === 'receive'
                      ? item.orderedQuantity - item.receivedQuantity
                      : item.receivedQuantity - item.returnedQuantity;
                  return (
                    <View
                      key={item.id}
                      className={`flex-row flex-wrap items-center gap-3 p-4 ${
                        index ? 'border-t border-slate-100' : ''
                      } ${maximum <= 0 ? 'bg-slate-50 opacity-50' : 'bg-white'}`}
                    >
                      <View className="min-w-56 flex-1">
                        <Text className="font-medium text-slate-900">{item.productName}</Text>
                        <Text className="mt-1 text-xs text-slate-400">
                          {item.sku} · {item.purchaseUnit.toUpperCase()} ·{' '}
                          {mode === 'receive'
                            ? `${maximum} remaining`
                            : `${maximum} available to return`}
                        </Text>
                      </View>
                      <QuantityField
                        value={quantities[item.id] ?? '0'}
                        maximum={maximum}
                        onChange={(value) =>
                          setQuantities((current) => ({ ...current, [item.id]: value }))
                        }
                      />
                    </View>
                  );
                })}
              </View>
              {mode === 'receive' ? (
                <View className="mt-5">
                  <Field
                    label="Supplier invoice / delivery receipt number"
                    value={deliveryInvoiceNumber}
                    onChangeText={setDeliveryInvoiceNumber}
                  />
                  <Field label="Receiving notes" value={notes} onChangeText={setNotes} multiline />
                </View>
              ) : (
                <View className="mt-5">
                  <Field
                    label="Reason *"
                    value={reason}
                    onChangeText={setReason}
                    placeholder="Damaged, spoiled, wrong item, excess stock…"
                  />
                  <Text className="mb-2 text-sm font-medium text-slate-700">
                    Expected resolution
                  </Text>
                  <View className="mb-4 flex-row flex-wrap gap-2">
                    {(
                      [
                        ['supplier_credit', 'Supplier credit'],
                        ['refund', 'Refund'],
                        ['replacement', 'Replacement'],
                      ] as const
                    ).map(([key, label]) => (
                      <Pressable
                        key={key}
                        onPress={() => setResolution(key)}
                        className={`min-h-11 justify-center rounded-xl border px-4 ${
                          resolution === key ? 'border-brand-700 bg-brand-50' : 'border-slate-200'
                        }`}
                      >
                        <Text
                          className={`font-medium ${
                            resolution === key ? 'text-brand-800' : 'text-slate-600'
                          }`}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Field
                    label="Supplier return / RMA reference"
                    value={supplierReturnReference}
                    onChangeText={setSupplierReturnReference}
                    placeholder="Optional supplier reference"
                  />
                  <Field label="Return notes" value={notes} onChangeText={setNotes} multiline />
                </View>
              )}
              {mode === 'return' && createReturn.isError ? (
                <View className="mb-4 flex-row items-start rounded-xl border border-red-200 bg-red-50 p-4">
                  <Feather name="alert-circle" size={18} color="#B42318" />
                  <View className="ml-3 flex-1">
                    <Text className="font-medium text-red-800">
                      Supplier return was not recorded
                    </Text>
                    <Text className="mt-1 text-sm leading-5 text-red-700">
                      {createReturn.error.message}
                    </Text>
                  </View>
                </View>
              ) : null}
              <View className="flex-row justify-end gap-3">
                <Button title="Cancel" variant="secondary" onPress={() => setMode(null)} />
                <Button
                  title={
                    receive.isPending || createReturn.isPending
                      ? 'Recording…'
                      : mode === 'receive'
                        ? 'Confirm received stock'
                        : 'Confirm supplier return'
                  }
                  disabled={
                    !selectedCount ||
                    (mode === 'return' && reason.trim().length < 3) ||
                    receive.isPending ||
                    createReturn.isPending ||
                    order.items.some((item) => {
                      const value = Number(quantities[item.id] ?? 0);
                      const maximum =
                        mode === 'receive'
                          ? item.orderedQuantity - item.receivedQuantity
                          : item.receivedQuantity - item.returnedQuantity;
                      return value < 0 || value > maximum + 0.000_001;
                    })
                  }
                  onPress={() => {
                    if (mode === 'receive') {
                      receive.mutate();
                    } else {
                      createReturn.reset();
                      setReturnConfirmationVisible(true);
                    }
                  }}
                />
              </View>
            </View>
          ) : null}

          <View className="rounded-2xl border border-slate-200 bg-white">
            <View className="border-b border-slate-100 px-5 py-4">
              <Text className="font-semibold text-slate-900">Ordered items</Text>
            </View>
            {order.items.map((item, index) => (
              <View
                key={item.id}
                className={`flex-row flex-wrap items-center gap-4 px-5 py-4 ${
                  index ? 'border-t border-slate-100' : ''
                }`}
              >
                <View className="min-w-56 flex-1">
                  <Text className="font-medium text-slate-900">{item.productName}</Text>
                  <Text className="mt-1 text-xs text-slate-400">
                    {item.sku} · {item.purchaseUnit.toUpperCase()}
                    {item.unitsPerBase !== 1
                      ? ` · 1 ${item.purchaseUnit} = ${item.unitsPerBase} base units`
                      : ''}
                  </Text>
                </View>
                <View className="w-28">
                  <Text className="text-xs text-slate-400">Ordered</Text>
                  <Text className="mt-1 font-medium text-slate-800">{item.orderedQuantity}</Text>
                </View>
                <View className="w-28">
                  <Text className="text-xs text-slate-400">Received</Text>
                  <Text className="mt-1 font-medium text-brand-700">{item.receivedQuantity}</Text>
                </View>
                <View className="w-28">
                  <Text className="text-xs text-slate-400">Returned</Text>
                  <Text className="mt-1 font-medium text-red-700">{item.returnedQuantity}</Text>
                </View>
                <View className="w-32 items-end">
                  <Text className="text-xs text-slate-400">
                    {formatMoney(item.unitCost)} / {item.purchaseUnit}
                  </Text>
                  <Text className="mt-1 font-semibold text-slate-900">
                    {formatMoney(item.lineTotal)}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          <View className="rounded-2xl border border-slate-200 bg-white p-5">
            <View className="mb-4 flex-row flex-wrap items-start justify-between gap-3">
              <View className="flex-1">
                <Text className="font-semibold text-slate-900">Supplier invoices and payments</Text>
                <Text className="mt-1 text-sm leading-5 text-slate-500">
                  Receiving stock updates inventory. Recording an invoice creates the amount owed to
                  the supplier.
                </Text>
              </View>
              {currentUser?.permissions.includes('purchasing:pay') &&
              ['partially_received', 'received'].includes(order.status) ? (
                <Pressable
                  onPress={openInvoiceModal}
                  className="min-h-11 flex-row items-center rounded-xl bg-brand-700 px-4 active:opacity-80"
                >
                  <Feather name="file-plus" size={16} color="#FFFFFF" />
                  <Text className="ml-2 text-sm font-medium text-white">Record invoice</Text>
                </Pressable>
              ) : null}
            </View>
            {order.supplierInvoices?.length ? (
              <View className="gap-3">
                {order.supplierInvoices.map((invoice) => (
                  <View
                    key={invoice.id}
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                  >
                    <View className="flex-row flex-wrap items-start justify-between gap-3">
                      <View className="min-w-52 flex-1">
                        <View className="flex-row flex-wrap items-center gap-2">
                          <Text className="font-medium text-slate-900">
                            {invoice.invoiceNumber}
                          </Text>
                          <View
                            className={`rounded-full px-2.5 py-1 ${payableStatusStyle(invoice.status)}`}
                          >
                            <Text className="text-xs font-medium capitalize">
                              {invoice.status.replace('_', ' ')}
                            </Text>
                          </View>
                        </View>
                        <Text className="mt-1 text-xs text-slate-500">
                          Invoice {new Date(`${invoice.invoiceDate}T12:00:00`).toLocaleDateString()}
                          {invoice.dueDate
                            ? ` · Due ${new Date(`${invoice.dueDate}T12:00:00`).toLocaleDateString()}`
                            : ''}
                        </Text>
                      </View>
                      <View className="items-end">
                        <Text className="text-xs text-slate-500">Balance</Text>
                        <Text className="mt-1 text-lg font-semibold text-brand-900">
                          {formatMoney(invoice.balance)}
                        </Text>
                        <Text className="mt-1 text-xs text-slate-400">
                          Paid {formatMoney(invoice.paidAmount)} of {formatMoney(invoice.total)}
                        </Text>
                      </View>
                    </View>
                    {invoice.payments.length ? (
                      <View className="mt-4 gap-2 border-t border-slate-200 pt-3">
                        {invoice.payments.map((payment) => (
                          <View key={payment.id} className="flex-row items-center">
                            <Feather
                              name={payment.source === 'cashier_drawer' ? 'inbox' : 'credit-card'}
                              size={14}
                              color="#81776E"
                            />
                            <Text className="ml-2 flex-1 text-xs text-slate-500">
                              {payment.paymentNumber} · {payment.source.replaceAll('_', ' ')}
                              {payment.reference ? ` · ${payment.reference}` : ''}
                            </Text>
                            <Text className="text-sm font-medium text-slate-700">
                              {formatMoney(payment.amount)}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                    {currentUser?.permissions.includes('purchasing:pay') &&
                    Number(invoice.balance) > 0 &&
                    !['disputed', 'credited', 'void'].includes(invoice.status) ? (
                      <Pressable
                        onPress={() => openPaymentModal(invoice)}
                        className="mt-4 min-h-11 items-center justify-center rounded-xl border border-brand-200 bg-white active:bg-brand-50"
                      >
                        <Text className="text-sm font-medium text-brand-700">Record payment</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : (
              <View className="rounded-xl bg-slate-50 p-4">
                <Text className="text-sm text-slate-500">
                  No supplier invoice has been recorded for this order. Inventory receiving and
                  supplier payment are intentionally separate.
                </Text>
              </View>
            )}
          </View>

          {order.receipts.length ? (
            <View className="rounded-2xl border border-slate-200 bg-white p-5">
              <Text className="mb-4 font-semibold text-slate-900">Receiving history</Text>
              <View className="gap-2">
                {order.receipts.map((receipt) => (
                  <View
                    key={receipt.id}
                    className="flex-row items-center rounded-xl bg-slate-50 p-4"
                  >
                    <Feather name="check-circle" size={18} color="#1A593B" />
                    <View className="ml-3 flex-1">
                      <Text className="font-medium text-slate-800">{receipt.receiptNumber}</Text>
                      <Text className="mt-1 text-xs text-slate-400">
                        {new Date(receipt.receivedAt).toLocaleString()} · {receipt.receivedBy}
                        {receipt.supplierInvoiceNumber
                          ? ` · Invoice ${receipt.supplierInvoiceNumber}`
                          : ''}
                      </Text>
                    </View>
                    <Text className="text-sm font-medium text-brand-700">
                      {receipt.quantity} units
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
          {order.returns.length ? (
            <View className="rounded-2xl border border-slate-200 bg-white p-5">
              <Text className="mb-4 font-semibold text-slate-900">Supplier return history</Text>
              <View className="gap-2">
                {order.returns.map((item) => (
                  <View key={item.id} className="rounded-xl bg-red-50 p-4">
                    <View className="flex-row items-center">
                      <Feather name="corner-up-left" size={18} color="#B42318" />
                      <View className="ml-3 flex-1">
                        <Text className="font-medium text-slate-800">{item.returnNumber}</Text>
                        <Text className="mt-1 text-xs text-slate-500">{item.reason}</Text>
                      </View>
                      <View className="items-end">
                        <Text className="font-medium text-red-700">{formatMoney(item.total)}</Text>
                        <Text className="mt-1 text-xs capitalize text-slate-400">
                          {item.resolution.replace('_', ' ')}
                        </Text>
                      </View>
                    </View>
                    {item.resolution === 'refund' ? (
                      <View className="mt-4 border-t border-red-100 pt-3">
                        <View className="flex-row items-center justify-between">
                          <Text className="text-xs text-slate-500">
                            Refunded {formatMoney(item.refundedAmount)} of {formatMoney(item.total)}
                          </Text>
                          {Number(item.remainingRefund) > 0 ? (
                            <Text className="text-xs font-medium text-amber-700">
                              {formatMoney(item.remainingRefund)} pending
                            </Text>
                          ) : (
                            <Text className="text-xs font-medium text-brand-700">
                              Fully refunded
                            </Text>
                          )}
                        </View>
                        {item.refunds?.map((refund) => (
                          <View key={refund.id} className="mt-2 flex-row items-center">
                            <Feather
                              name={refund.source === 'cashier_drawer' ? 'inbox' : 'credit-card'}
                              size={13}
                              color="#81776E"
                            />
                            <Text className="ml-2 flex-1 text-xs text-slate-500">
                              {refund.refundNumber} · {refund.source.replaceAll('_', ' ')}
                            </Text>
                            <Text className="text-xs font-medium text-slate-700">
                              {formatMoney(refund.amount)}
                            </Text>
                          </View>
                        ))}
                        {currentUser?.permissions.includes('purchasing:pay') &&
                        Number(item.remainingRefund) > 0 ? (
                          <Pressable
                            onPress={() => openRefundModal(item)}
                            className="mt-3 min-h-11 items-center justify-center rounded-xl border border-red-200 bg-white active:bg-red-100"
                          >
                            <Text className="text-sm font-medium text-red-700">
                              Record money received back
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>
      <Modal
        visible={invoiceModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setInvoiceModalVisible(false)}
      >
        <View className="flex-1 items-center justify-center bg-black/40 p-5">
          <View className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl">
            <View className="mb-5 flex-row items-start">
              <View className="mr-3 h-12 w-12 items-center justify-center rounded-2xl bg-brand-50">
                <Feather name="file-text" size={21} color="#1A593B" />
              </View>
              <View className="flex-1">
                <Text className="text-xl font-semibold text-slate-950">
                  Record supplier invoice
                </Text>
                <Text className="mt-1 text-sm leading-5 text-slate-500">
                  This records what is owed. It does not remove money from any cashier drawer.
                </Text>
              </View>
            </View>
            <Field
              label="Supplier invoice number *"
              value={invoiceNumber}
              onChangeText={setInvoiceNumber}
              placeholder="Example: INV-1001"
            />
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Field
                  label="Invoice date *"
                  value={invoiceDate}
                  onChangeText={setInvoiceDate}
                  placeholder="YYYY-MM-DD"
                />
              </View>
              <View className="flex-1">
                <Field
                  label="Due date"
                  value={invoiceDueDate}
                  onChangeText={setInvoiceDueDate}
                  placeholder="YYYY-MM-DD"
                />
              </View>
            </View>
            <Field
              label="Invoice total *"
              value={invoiceTotal}
              onChangeText={setInvoiceTotal}
              keyboardType="decimal-pad"
              placeholder="₱0.00"
            />
            <Field
              label="Invoice notes"
              value={invoiceNotes}
              onChangeText={setInvoiceNotes}
              multiline
            />
            {createInvoice.isError ? (
              <View className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4">
                <Text className="font-medium text-red-800">Invoice was not recorded</Text>
                <Text className="mt-1 text-sm text-red-700">{createInvoice.error.message}</Text>
              </View>
            ) : null}
            <View className="gap-3">
              <Button
                title={createInvoice.isPending ? 'Recording…' : 'Record supplier invoice'}
                disabled={
                  createInvoice.isPending ||
                  !invoiceNumber.trim() ||
                  !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate) ||
                  Boolean(invoiceDueDate && !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDueDate)) ||
                  !(Number(invoiceTotal) > 0)
                }
                onPress={() => createInvoice.mutate()}
              />
              <Button
                title="Cancel"
                variant="secondary"
                disabled={createInvoice.isPending}
                onPress={() => setInvoiceModalVisible(false)}
              />
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        visible={Boolean(paymentInvoice)}
        transparent
        animationType="fade"
        onRequestClose={() => setPaymentInvoice(null)}
      >
        <View className="flex-1 items-center justify-center bg-black/40 p-5">
          <ScrollView
            className="w-full max-w-lg"
            contentContainerClassName="rounded-3xl bg-white p-6 shadow-xl"
          >
            <View className="mb-5 flex-row items-start">
              <View className="mr-3 h-12 w-12 items-center justify-center rounded-2xl bg-brand-50">
                <Feather name="credit-card" size={21} color="#1A593B" />
              </View>
              <View className="flex-1">
                <Text className="text-xl font-semibold text-slate-950">
                  Record supplier payment
                </Text>
                <Text className="mt-1 text-sm text-slate-500">
                  {paymentInvoice?.invoiceNumber} · Balance{' '}
                  {formatMoney(paymentInvoice?.balance ?? '0')}
                </Text>
              </View>
            </View>
            <Field
              label="Amount *"
              value={paymentAmount}
              onChangeText={setPaymentAmount}
              keyboardType="decimal-pad"
              placeholder="₱0.00"
            />
            <Text className="mb-2 text-sm font-medium text-slate-700">Money source *</Text>
            <View className="mb-4 gap-2">
              {PAYMENT_SOURCES.map((source) => {
                const selected = paymentSource === source.value;
                return (
                  <Pressable
                    key={source.value}
                    onPress={() => setPaymentSource(source.value)}
                    className={`min-h-14 flex-row items-center rounded-xl border px-4 ${
                      selected ? 'border-brand-700 bg-brand-50' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <View className="flex-1">
                      <Text
                        className={`font-medium ${selected ? 'text-brand-800' : 'text-slate-700'}`}
                      >
                        {source.label}
                      </Text>
                      <Text className="mt-1 text-xs text-slate-500">{source.description}</Text>
                    </View>
                    {selected ? <Feather name="check" size={17} color="#1A593B" /> : null}
                  </Pressable>
                );
              })}
            </View>
            {paymentSource === 'cashier_drawer' ? (
              activeShift?.branchId === order.branchId ? (
                <View className="mb-4 flex-row items-start rounded-xl bg-brand-50 p-4">
                  <Feather name="check-circle" size={17} color="#1A593B" />
                  <Text className="ml-2 flex-1 text-sm leading-5 text-brand-800">
                    Cash Out will be recorded in {activeShift.registerName}. The server will also
                    verify that enough expected cash is available.
                  </Text>
                </View>
              ) : (
                <View className="mb-4 flex-row items-start rounded-xl bg-red-50 p-4">
                  <Feather name="alert-circle" size={17} color="#B42318" />
                  <Text className="ml-2 flex-1 text-sm leading-5 text-red-700">
                    Open a cashier shift for {order.branchName}, or choose a source outside the
                    drawer.
                  </Text>
                </View>
              )
            ) : (
              <View className="mb-4 rounded-xl bg-slate-50 p-4">
                <Text className="text-sm leading-5 text-slate-600">
                  This source will update the supplier balance only. It will not change cashier
                  shift cash.
                </Text>
              </View>
            )}
            <Field
              label="Payment reference"
              value={paymentReference}
              onChangeText={setPaymentReference}
              placeholder="Transfer, e-wallet, cheque, or acknowledgment number"
            />
            <Field
              label="Payment notes"
              value={paymentNotes}
              onChangeText={setPaymentNotes}
              multiline
            />
            {payInvoice.isError ? (
              <View className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4">
                <Text className="font-medium text-red-800">Payment was not recorded</Text>
                <Text className="mt-1 text-sm text-red-700">{payInvoice.error.message}</Text>
              </View>
            ) : null}
            <View className="gap-3">
              <Button
                title={payInvoice.isPending ? 'Recording payment…' : 'Record payment'}
                disabled={
                  payInvoice.isPending ||
                  !(Number(paymentAmount) > 0) ||
                  Number(paymentAmount) > Number(paymentInvoice?.balance ?? 0) ||
                  (paymentSource === 'cashier_drawer' && activeShift?.branchId !== order.branchId)
                }
                onPress={() => payInvoice.mutate()}
              />
              <Button
                title="Cancel"
                variant="secondary"
                disabled={payInvoice.isPending}
                onPress={() => setPaymentInvoice(null)}
              />
            </View>
          </ScrollView>
        </View>
      </Modal>
      <Modal
        visible={Boolean(refundReturn)}
        transparent
        animationType="fade"
        onRequestClose={() => setRefundReturn(null)}
      >
        <View className="flex-1 items-center justify-center bg-black/40 p-5">
          <ScrollView
            className="w-full max-w-lg"
            contentContainerClassName="rounded-3xl bg-white p-6 shadow-xl"
          >
            <View className="mb-5 flex-row items-start">
              <View className="mr-3 h-12 w-12 items-center justify-center rounded-2xl bg-brand-50">
                <Feather name="corner-down-left" size={21} color="#1A593B" />
              </View>
              <View className="flex-1">
                <Text className="text-xl font-semibold text-slate-950">Record supplier refund</Text>
                <Text className="mt-1 text-sm leading-5 text-slate-500">
                  {refundReturn?.returnNumber} · Up to{' '}
                  {formatMoney(refundReturn?.remainingRefund ?? '0')} is still expected back.
                </Text>
              </View>
            </View>

            <Text className="mb-2 text-sm font-medium text-slate-700">
              Original supplier payment *
            </Text>
            {refundablePayments.length ? (
              <View className="mb-4 gap-2">
                {refundablePayments.map((payment) => {
                  const selected = refundPayment?.id === payment.id;
                  return (
                    <Pressable
                      key={payment.id}
                      onPress={() => {
                        setRefundPayment(payment);
                        setRefundAmount(
                          Math.min(
                            Number(refundReturn?.remainingRefund ?? 0),
                            Number(payment.refundableAmount),
                          ).toFixed(2),
                        );
                      }}
                      className={`min-h-14 flex-row items-center rounded-xl border px-4 ${
                        selected ? 'border-brand-700 bg-brand-50' : 'border-slate-200 bg-white'
                      }`}
                    >
                      <View className="flex-1">
                        <Text
                          className={`font-medium ${
                            selected ? 'text-brand-800' : 'text-slate-700'
                          }`}
                        >
                          {payment.paymentNumber} · {payment.source.replaceAll('_', ' ')}
                        </Text>
                        <Text className="mt-1 text-xs text-slate-500">
                          Invoice {payment.invoiceNumber} · {formatMoney(payment.refundableAmount)}{' '}
                          refundable
                        </Text>
                      </View>
                      {selected ? <Feather name="check" size={17} color="#1A593B" /> : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <View className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <Text className="font-medium text-amber-800">No refundable payment yet</Text>
                <Text className="mt-1 text-sm leading-5 text-amber-700">
                  Record the supplier invoice and its payment first. A refund cannot exceed money
                  that was actually paid.
                </Text>
              </View>
            )}

            <Field
              label="Amount actually received *"
              value={refundAmount}
              onChangeText={setRefundAmount}
              keyboardType="decimal-pad"
              placeholder="₱0.00"
            />
            {refundPayment?.source === 'cashier_drawer' ? (
              activeShift?.branchId === order.branchId ? (
                <View className="mb-4 flex-row items-start rounded-xl bg-brand-50 p-4">
                  <Feather name="check-circle" size={17} color="#1A593B" />
                  <Text className="ml-2 flex-1 text-sm leading-5 text-brand-800">
                    The actual amount received will be recorded as Cash In for{' '}
                    {activeShift.registerName}.
                  </Text>
                </View>
              ) : (
                <View className="mb-4 flex-row items-start rounded-xl bg-red-50 p-4">
                  <Feather name="alert-circle" size={17} color="#B42318" />
                  <Text className="ml-2 flex-1 text-sm leading-5 text-red-700">
                    This payment came from a cashier drawer. Open your shift for {order.branchName}{' '}
                    before receiving the cash refund.
                  </Text>
                </View>
              )
            ) : refundPayment ? (
              <View className="mb-4 rounded-xl bg-slate-50 p-4">
                <Text className="text-sm leading-5 text-slate-600">
                  This refund returns to {refundPayment.source.replaceAll('_', ' ')}. It will not
                  change cashier-shift cash.
                </Text>
              </View>
            ) : null}
            <Field
              label="Supplier refund reference"
              value={refundReference}
              onChangeText={setRefundReference}
              placeholder="Refund receipt, transfer, or acknowledgment number"
            />
            <Field
              label="Refund notes"
              value={refundNotes}
              onChangeText={setRefundNotes}
              multiline
            />
            {recordSupplierRefund.isError ? (
              <View className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4">
                <Text className="font-medium text-red-800">Refund was not recorded</Text>
                <Text className="mt-1 text-sm text-red-700">
                  {recordSupplierRefund.error.message}
                </Text>
              </View>
            ) : null}
            <View className="gap-3">
              <Button
                title={
                  recordSupplierRefund.isPending ? 'Recording refund…' : 'Record money received'
                }
                disabled={
                  recordSupplierRefund.isPending ||
                  !refundPayment ||
                  !(Number(refundAmount) > 0) ||
                  Number(refundAmount) > Number(refundReturn?.remainingRefund ?? 0) ||
                  Number(refundAmount) > Number(refundPayment?.refundableAmount ?? 0) ||
                  (refundPayment?.source === 'cashier_drawer' &&
                    activeShift?.branchId !== order.branchId)
                }
                onPress={() => recordSupplierRefund.mutate()}
              />
              <Button
                title="Cancel"
                variant="secondary"
                disabled={recordSupplierRefund.isPending}
                onPress={() => setRefundReturn(null)}
              />
            </View>
          </ScrollView>
        </View>
      </Modal>
      <Modal
        visible={returnConfirmationVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setReturnConfirmationVisible(false)}
      >
        <View className="flex-1 items-center justify-center bg-black/40 p-5">
          <View className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
            <View className="mb-5 h-12 w-12 items-center justify-center rounded-2xl bg-red-50">
              <Feather name="corner-up-left" size={22} color="#B42318" />
            </View>
            <Text className="text-xl font-semibold text-slate-950">Record supplier return?</Text>
            <Text className="mt-2 text-sm leading-5 text-slate-500">
              {selectedReturnQuantity} unit{selectedReturnQuantity === 1 ? '' : 's'} across{' '}
              {selectedCount} product line{selectedCount === 1 ? '' : 's'} will be removed from
              branch inventory.
            </Text>
            <View className="mt-4 rounded-xl bg-amber-50 p-4">
              <Text className="text-sm leading-5 text-amber-800">
                This creates a permanent inventory ledger entry and cannot be edited afterward.
              </Text>
            </View>
            <View className="mt-6 gap-3">
              <Button
                title={createReturn.isPending ? 'Recording…' : 'Record supplier return'}
                disabled={createReturn.isPending}
                variant="danger"
                onPress={() => createReturn.mutate()}
              />
              <Button
                title="Go back"
                disabled={createReturn.isPending}
                variant="secondary"
                onPress={() => setReturnConfirmationVisible(false)}
              />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

export default function PurchaseOrderScreen() {
  return (
    <AppSidebarProvider>
      <PurchaseOrderContent />
    </AppSidebarProvider>
  );
}
