import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { useQuery } from '@tanstack/react-query';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { EmptyState, ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import {
  PURCHASE_STATUS_LABELS,
  statusColors,
  type PurchaseOrderSummary,
  type Supplier,
} from '@/lib/purchasing';
import { useSession } from '@/providers/session';
import { useBranchStore } from '@/store/branch';

type Section = 'orders' | 'suppliers' | 'returns';

interface SupplierReturn {
  id: string;
  purchaseOrderId: string;
  returnNumber: string;
  reason: string;
  resolution: string;
  total: string;
  refundedAmount: string;
  remainingRefund: string;
  createdAt: string;
  supplierName: string;
  orderNumber: string;
}

function PurchasingContent() {
  const [section, setSection] = useState<Section>('orders');
  const [search, setSearch] = useState('');
  const branch = useBranchStore((state) => state.activeBranch);
  const { currentUser } = useSession();
  const orders = useQuery({
    queryKey: ['purchase-orders', branch?.id, search],
    enabled: Boolean(branch),
    queryFn: () =>
      api<PurchaseOrderSummary[]>(
        `/purchase-orders?branchId=${branch!.id}&page=1&pageSize=100${
          search ? `&search=${encodeURIComponent(search)}` : ''
        }`,
      ),
  });
  const suppliers = useQuery({
    queryKey: ['suppliers', branch?.id],
    enabled: Boolean(branch),
    queryFn: () => api<Supplier[]>(`/suppliers?branchId=${branch!.id}`),
  });
  const returns = useQuery({
    queryKey: ['purchase-returns', branch?.id],
    enabled: Boolean(branch),
    queryFn: () => api<SupplierReturn[]>(`/purchase-orders/returns?branchId=${branch!.id}`),
  });
  const returnable = useQuery({
    queryKey: ['returnable-purchase-orders', branch?.id],
    enabled: Boolean(branch),
    queryFn: () =>
      api<PurchaseOrderSummary[]>(
        `/purchase-orders?branchId=${branch!.id}&returnable=true&page=1&pageSize=100`,
      ),
  });
  const counts = useMemo(
    () => ({
      orders: orders.data?.length ?? 0,
      suppliers: suppliers.data?.filter((item) => item.isActive).length ?? 0,
      returns: returns.data?.length ?? 0,
    }),
    [orders.data, returns.data, suppliers.data],
  );
  const returnableOrders = useMemo(
    () =>
      returnable.data?.filter(
        (order) =>
          ['partially_received', 'received'].includes(order.status) && order.returnableQuantity > 0,
      ) ?? [],
    [returnable.data],
  );
  const activeQuery = section === 'orders' ? orders : section === 'suppliers' ? suppliers : returns;
  return (
    <Screen>
      <Header
        title="Purchasing"
        subtitle={`${branch?.name ?? 'Choose a branch'} · Orders, receiving and supplier returns`}
        action={
          section === 'orders' && currentUser?.permissions.includes('purchasing:manage') ? (
            <Pressable
              onPress={() => router.push('/purchase-order-form')}
              className="min-h-11 flex-row items-center rounded-xl bg-brand-700 px-4"
            >
              <Feather name="plus" size={17} color="#fff" />
              <Text className="ml-2 font-medium text-white">New order</Text>
            </Pressable>
          ) : section === 'suppliers' && currentUser?.permissions.includes('suppliers:manage') ? (
            <Pressable
              onPress={() => router.push('/supplier-form')}
              className="min-h-11 flex-row items-center rounded-xl bg-brand-700 px-4"
            >
              <Feather name="plus" size={17} color="#fff" />
              <Text className="ml-2 font-medium text-white">New supplier</Text>
            </Pressable>
          ) : null
        }
      />
      <View className="border-b border-slate-200 bg-white px-4 pt-3">
        <View className="self-center w-full max-w-5xl flex-row gap-2">
          {(
            [
              ['orders', 'Purchase orders', 'file-text'],
              ['suppliers', 'Suppliers', 'truck'],
              ['returns', 'Returns', 'corner-up-left'],
            ] as const
          ).map(([key, label, icon]) => (
            <Pressable
              key={key}
              onPress={() => setSection(key)}
              className={`min-h-12 flex-1 flex-row items-center justify-center rounded-t-xl px-3 ${
                section === key ? 'border-b-2 border-brand-700 bg-brand-50' : ''
              }`}
            >
              <Feather name={icon} size={16} color={section === key ? '#1A593B' : '#81776E'} />
              <Text
                className={`ml-2 text-sm font-medium ${
                  section === key ? 'text-brand-800' : 'text-slate-500'
                }`}
              >
                {label} ({counts[key]})
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      {section === 'orders' ? (
        <View className="bg-white px-4 py-3">
          <View className="self-center w-full max-w-5xl flex-row items-center rounded-xl bg-slate-100 px-4">
            <Feather name="search" size={17} color="#81776E" />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search order number or supplier"
              placeholderTextColor="#81776E"
              className="min-h-12 flex-1 px-3 text-slate-900"
            />
          </View>
        </View>
      ) : null}
      {activeQuery.isLoading ? (
        <LoadingState />
      ) : activeQuery.isError ? (
        <ErrorState message={activeQuery.error.message} retry={() => void activeQuery.refetch()} />
      ) : (
        <ScrollView contentContainerClassName="items-center p-4 pb-12">
          <View className="w-full max-w-5xl gap-3">
            {section === 'orders' ? (
              orders.data?.length ? (
                orders.data.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() =>
                      router.push({ pathname: '/purchase-order/[id]', params: { id: item.id } })
                    }
                    className="flex-row items-center rounded-2xl border border-slate-200 bg-white p-4 active:bg-brand-50"
                  >
                    <View className="mr-4 h-11 w-11 items-center justify-center rounded-xl bg-brand-50">
                      <Feather name="file-text" size={19} color="#1A593B" />
                    </View>
                    <View className="flex-1">
                      <View className="flex-row flex-wrap items-center gap-2">
                        <Text className="font-semibold text-slate-900">{item.orderNumber}</Text>
                        <View className={`rounded-full px-2.5 py-1 ${statusColors(item.status)}`}>
                          <Text className="text-xs font-medium">
                            {PURCHASE_STATUS_LABELS[item.status]}
                          </Text>
                        </View>
                      </View>
                      <Text className="mt-1 text-sm text-slate-600">{item.supplierName}</Text>
                      <Text className="mt-1 text-xs text-slate-400">
                        Received {item.receivedQuantity} of {item.orderedQuantity} ordered units
                      </Text>
                    </View>
                    <View className="items-end">
                      <Text className="font-semibold text-brand-800">
                        {formatMoney(item.subtotal)}
                      </Text>
                      {Number(item.outstandingBalance) > 0 ? (
                        <Text className="mt-1 text-xs font-medium text-amber-700">
                          Due {formatMoney(item.outstandingBalance)}
                        </Text>
                      ) : item.invoiceCount > 0 ? (
                        <Text className="mt-1 text-xs font-medium text-brand-700">Paid</Text>
                      ) : null}
                      <Text className="mt-2 text-xs text-slate-400">
                        {new Date(item.createdAt).toLocaleDateString()}
                      </Text>
                    </View>
                  </Pressable>
                ))
              ) : (
                <EmptyState
                  title="No purchase orders yet"
                  message="Create an order when you need to request stock from a supplier."
                />
              )
            ) : section === 'suppliers' ? (
              suppliers.data?.length ? (
                suppliers.data.map((item) => (
                  <Pressable
                    key={item.id}
                    disabled={!currentUser?.permissions.includes('suppliers:manage')}
                    onPress={() =>
                      router.push({
                        pathname: '/supplier-form',
                        params: {
                          id: item.id,
                          name: item.name,
                          contactName: item.contactName ?? '',
                          email: item.email ?? '',
                          phone: item.phone ?? '',
                          address: item.address ?? '',
                          taxId: item.taxId ?? '',
                          notes: item.notes ?? '',
                          isActive: String(item.isActive),
                        },
                      })
                    }
                    className="flex-row items-center rounded-2xl border border-slate-200 bg-white p-4"
                  >
                    <View className="mr-4 h-11 w-11 items-center justify-center rounded-xl bg-brand-50">
                      <Feather name="truck" size={19} color="#1A593B" />
                    </View>
                    <View className="flex-1">
                      <View className="flex-row items-center gap-2">
                        <Text className="font-semibold text-slate-900">{item.name}</Text>
                        {!item.isActive ? (
                          <Text className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-500">
                            Disabled
                          </Text>
                        ) : null}
                      </View>
                      <Text className="mt-1 text-sm text-slate-500">
                        {[item.contactName, item.phone, item.email].filter(Boolean).join(' · ') ||
                          'No contact details'}
                      </Text>
                    </View>
                    <View className="items-end">
                      <Text className="text-sm font-medium text-slate-700">
                        {item.orderCount ?? 0} orders
                      </Text>
                      <Text className="mt-1 text-xs text-slate-400">
                        {formatMoney(item.orderedTotal ?? '0')}
                      </Text>
                    </View>
                  </Pressable>
                ))
              ) : (
                <EmptyState
                  title="No suppliers yet"
                  message="Add a supplier before creating your first purchase order."
                />
              )
            ) : (
              <View className="gap-5">
                {currentUser?.permissions.includes('purchasing:return') ? (
                  <View className="rounded-2xl border border-brand-100 bg-brand-50 p-5">
                    <View className="mb-4 flex-row items-start">
                      <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-white">
                        <Feather name="corner-up-left" size={18} color="#1A593B" />
                      </View>
                      <View className="flex-1">
                        <Text className="font-semibold text-slate-900">
                          Start a supplier return
                        </Text>
                        <Text className="mt-1 text-sm leading-5 text-slate-500">
                          Choose a received order. Only quantities still available to return can be
                          selected.
                        </Text>
                      </View>
                    </View>
                    {returnable.isLoading ? (
                      <Text className="rounded-xl bg-white p-4 text-sm text-slate-500">
                        Loading received orders…
                      </Text>
                    ) : returnable.isError ? (
                      <Pressable
                        onPress={() => void returnable.refetch()}
                        className="rounded-xl border border-red-100 bg-white p-4"
                      >
                        <Text className="text-sm text-red-700">
                          Could not load eligible orders. Tap to try again.
                        </Text>
                      </Pressable>
                    ) : returnableOrders.length ? (
                      <View className="gap-2">
                        {returnableOrders.map((order) => (
                          <Pressable
                            key={order.id}
                            onPress={() =>
                              router.push({
                                pathname: '/purchase-order/[id]',
                                params: { id: order.id, action: 'return' },
                              })
                            }
                            className="flex-row items-center rounded-xl border border-brand-100 bg-white p-4 active:bg-brand-50"
                          >
                            <View className="flex-1">
                              <Text className="font-medium text-slate-900">
                                {order.orderNumber}
                              </Text>
                              <Text className="mt-1 text-xs text-slate-500">
                                {order.supplierName} · {order.returnableQuantity} units available
                              </Text>
                            </View>
                            <Text className="text-sm font-medium text-brand-700">Return items</Text>
                            <Feather
                              name="chevron-right"
                              size={16}
                              color="#1A593B"
                              style={{ marginLeft: 6 }}
                            />
                          </Pressable>
                        ))}
                      </View>
                    ) : (
                      <Text className="rounded-xl bg-white p-4 text-sm text-slate-500">
                        No received orders currently have items available to return.
                      </Text>
                    )}
                  </View>
                ) : null}

                <View className="gap-3">
                  <Text className="text-sm font-semibold uppercase tracking-wider text-slate-500">
                    Return history
                  </Text>
                  {returns.data?.length ? (
                    returns.data.map((item) => (
                      <Pressable
                        key={item.id}
                        onPress={() =>
                          router.push({
                            pathname: '/purchase-order/[id]',
                            params: { id: item.purchaseOrderId },
                          })
                        }
                        className="flex-row items-center rounded-2xl border border-slate-200 bg-white p-4 active:bg-red-50"
                      >
                        <View className="mr-4 h-11 w-11 items-center justify-center rounded-xl bg-red-50">
                          <Feather name="corner-up-left" size={19} color="#B42318" />
                        </View>
                        <View className="flex-1">
                          <Text className="font-semibold text-slate-900">{item.returnNumber}</Text>
                          <Text className="mt-1 text-sm text-slate-600">
                            {item.supplierName} · {item.orderNumber}
                          </Text>
                          <Text className="mt-1 text-xs text-slate-400">{item.reason}</Text>
                        </View>
                        <View className="items-end">
                          <Text className="font-semibold text-red-700">
                            {formatMoney(item.total)}
                          </Text>
                          <Text className="mt-1 text-xs capitalize text-slate-400">
                            {item.resolution.replace('_', ' ')}
                          </Text>
                          {item.resolution === 'refund' ? (
                            <Text
                              className={`mt-1 text-xs font-medium ${
                                Number(item.remainingRefund) > 0
                                  ? 'text-amber-700'
                                  : 'text-brand-700'
                              }`}
                            >
                              {Number(item.remainingRefund) > 0
                                ? `${formatMoney(item.remainingRefund)} pending`
                                : 'Refund received'}
                            </Text>
                          ) : null}
                        </View>
                      </Pressable>
                    ))
                  ) : (
                    <EmptyState
                      title="No supplier returns"
                      message="Recorded returns to suppliers will appear here."
                    />
                  )}
                </View>
              </View>
            )}
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}

export default function PurchasingScreen() {
  return (
    <AppSidebarProvider>
      <PurchasingContent />
    </AppSidebarProvider>
  );
}
