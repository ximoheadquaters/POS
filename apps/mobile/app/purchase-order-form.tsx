import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { Button, ErrorState, Field, Header, LoadingState, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import type { Supplier } from '@/lib/purchasing';
import { useSession } from '@/providers/session';
import { useBranchStore } from '@/store/branch';

interface Product {
  id: string;
  name: string;
  sku: string;
  unit: string;
  cost: string;
  status: 'active' | 'pending_receipt';
  trackInventory: boolean;
  sellingUnits?: Array<{
    variantId: string;
    name: string;
    sku: string;
    unit: string;
    unitsPerBase: number;
    cost?: string;
  }>;
}

interface PurchaseChoice {
  key: string;
  productId: string;
  variantId?: string;
  productName: string;
  label: string;
  sku: string;
  unit: string;
  unitsPerBase: number;
  cost: string;
  incoming: boolean;
}

interface DraftLine extends PurchaseChoice {
  quantity: string;
  unitCost: string;
}

interface CreatedPurchaseOrder {
  id: string;
  orderNumber: string;
  status: 'draft';
  subtotal: string;
}

function PurchaseOrderFormContent() {
  const branch = useBranchStore((state) => state.activeBranch);
  const { currentUser } = useSession();
  const queryClient = useQueryClient();
  const [supplierId, setSupplierId] = useState('');
  const [search, setSearch] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [supplierReference, setSupplierReference] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [createdOrder, setCreatedOrder] = useState<CreatedPurchaseOrder | null>(null);
  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api<Supplier[]>('/suppliers'),
  });
  const products = useQuery({
    queryKey: ['purchase-products', branch?.id],
    enabled: Boolean(branch),
    queryFn: () =>
      api<Product[]>(`/products?branchId=${branch!.id}&page=1&pageSize=100&includeIncoming=true`),
  });
  const choices = useMemo<PurchaseChoice[]>(() => {
    const all = (products.data ?? [])
      .filter((product) => product.trackInventory)
      .flatMap((product) => [
        {
          key: `${product.id}:base`,
          productId: product.id,
          productName: product.name,
          label: product.name,
          sku: product.sku,
          unit: product.unit,
          unitsPerBase: 1,
          cost: product.cost,
          incoming: product.status === 'pending_receipt',
        },
        ...(product.sellingUnits ?? []).map((unit) => ({
          key: `${product.id}:${unit.variantId}`,
          productId: product.id,
          variantId: unit.variantId,
          productName: product.name,
          label: `${product.name} · ${unit.name}`,
          sku: unit.sku,
          unit: unit.unit,
          unitsPerBase: unit.unitsPerBase,
          cost: unit.cost ?? String(Number(product.cost) * unit.unitsPerBase),
          incoming: product.status === 'pending_receipt',
        })),
      ]);
    const needle = search.trim().toLowerCase();
    if (!needle) return all.slice(0, 12);
    return all
      .filter((item) => `${item.label} ${item.sku} ${item.unit}`.toLowerCase().includes(needle))
      .slice(0, 20);
  }, [products.data, search]);
  const subtotal = lines.reduce(
    (sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitCost) || 0),
    0,
  );
  const create = useMutation({
    mutationFn: () => {
      let expectedAt: string | null = null;
      if (expectedDate.trim()) {
        const parsed = new Date(`${expectedDate.trim()}T12:00:00`);
        if (Number.isNaN(parsed.getTime())) throw new Error('Expected date must be YYYY-MM-DD');
        expectedAt = parsed.toISOString();
      }
      return api<CreatedPurchaseOrder>('/purchase-orders', {
        method: 'POST',
        body: JSON.stringify({
          branchId: branch!.id,
          supplierId,
          expectedAt,
          supplierReference,
          notes,
          items: lines.map((line) => ({
            productId: line.productId,
            variantId: line.variantId ?? null,
            quantity: Number(line.quantity),
            unitCost: Number(line.unitCost).toFixed(2),
          })),
        }),
      });
    },
    onSuccess: (order) => {
      setCreatedOrder(order);
      void queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    },
  });
  const loading = suppliers.isLoading || products.isLoading;
  const error = suppliers.error ?? products.error;
  return (
    <Screen>
      <Header
        title="New purchase order"
        subtitle={`${branch?.name ?? ''} · Build the request before sending it`}
        showBack
        backLabel="Purchasing"
        fallbackHref="/purchasing"
      />
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState
          message={error.message}
          retry={() => {
            void suppliers.refetch();
            void products.refetch();
          }}
        />
      ) : (
        <ScrollView contentContainerClassName="items-center p-4 pb-12">
          <View className="w-full max-w-5xl gap-5">
            <View className="rounded-2xl border border-slate-200 bg-white p-5">
              <View className="mb-4 flex-row items-center">
                <Feather name="truck" size={18} color="#1A593B" />
                <Text className="ml-2 font-semibold text-slate-900">1. Choose supplier</Text>
              </View>
              <View className="flex-row flex-wrap gap-2">
                {suppliers.data
                  ?.filter((supplier) => supplier.isActive)
                  .map((supplier) => (
                    <Pressable
                      key={supplier.id}
                      onPress={() => setSupplierId(supplier.id)}
                      className={`min-h-11 justify-center rounded-xl border px-4 ${
                        supplierId === supplier.id
                          ? 'border-brand-700 bg-brand-50'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <Text
                        className={`font-medium ${
                          supplierId === supplier.id ? 'text-brand-800' : 'text-slate-700'
                        }`}
                      >
                        {supplier.name}
                      </Text>
                    </Pressable>
                  ))}
                {!suppliers.data?.some((supplier) => supplier.isActive) ? (
                  <Pressable
                    onPress={() => router.push('/supplier-form')}
                    className="min-h-11 flex-row items-center px-2"
                  >
                    <Feather name="plus" size={16} color="#1A593B" />
                    <Text className="ml-1 font-medium text-brand-700">Add a supplier first</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            <View className="rounded-2xl border border-slate-200 bg-white p-5">
              <View className="mb-4 flex-row items-center">
                <Feather name="package" size={18} color="#1A593B" />
                <View className="ml-2 flex-1">
                  <Text className="font-semibold text-slate-900">2. Add products</Text>
                  <Text className="mt-1 text-xs text-slate-500">
                    Packs and boxes automatically convert to the product&apos;s base stock unit.
                  </Text>
                </View>
                {currentUser?.permissions.includes('products:manage') ? (
                  <Pressable
                    onPress={() =>
                      router.push({ pathname: '/product-form', params: { incoming: '1' } })
                    }
                    className="min-h-11 flex-row items-center rounded-xl bg-brand-50 px-3"
                  >
                    <Feather name="plus" size={15} color="#1A593B" />
                    <Text className="ml-1 text-sm font-medium text-brand-700">
                      Register new product
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              <View className="mb-3 flex-row items-center rounded-xl bg-slate-100 px-4">
                <Feather name="search" size={17} color="#81776E" />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search product, SKU, pack or box"
                  placeholderTextColor="#81776E"
                  className="min-h-12 flex-1 px-3 text-slate-900"
                />
              </View>
              <View className="max-h-72 overflow-hidden rounded-xl border border-slate-200">
                {choices.map((choice, index) => {
                  const added = lines.some((line) => line.key === choice.key);
                  return (
                    <Pressable
                      key={choice.key}
                      disabled={added}
                      onPress={() =>
                        setLines((current) => [
                          ...current,
                          { ...choice, quantity: '1', unitCost: Number(choice.cost).toFixed(2) },
                        ])
                      }
                      className={`min-h-14 flex-row items-center px-4 ${
                        index ? 'border-t border-slate-100' : ''
                      } ${added ? 'bg-slate-50 opacity-50' : 'bg-white active:bg-brand-50'}`}
                    >
                      <View className="flex-1">
                        <View className="flex-row flex-wrap items-center gap-2">
                          <Text className="font-medium text-slate-900">{choice.label}</Text>
                          {choice.incoming ? (
                            <Text className="rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
                              Incoming
                            </Text>
                          ) : null}
                        </View>
                        <Text className="mt-1 text-xs text-slate-400">
                          {choice.sku} · {choice.unit.toUpperCase()}
                          {choice.unitsPerBase > 1
                            ? ` · 1 ${choice.unit} = ${choice.unitsPerBase} base units`
                            : ''}
                        </Text>
                      </View>
                      <Text className="text-sm font-medium text-brand-700">
                        {added ? 'Added' : '+ Add'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View className="rounded-2xl border border-slate-200 bg-white p-5">
              <View className="mb-4 flex-row items-center">
                <Feather name="list" size={18} color="#1A593B" />
                <Text className="ml-2 font-semibold text-slate-900">
                  3. Order quantities ({lines.length})
                </Text>
              </View>
              {lines.length ? (
                <View className="gap-3">
                  {lines.map((line) => (
                    <View
                      key={line.key}
                      className="flex-row flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-4"
                    >
                      <View className="min-w-52 flex-1">
                        <Text className="font-medium text-slate-900">{line.label}</Text>
                        <Text className="mt-1 text-xs text-slate-400">Ordered by {line.unit}</Text>
                      </View>
                      <View>
                        <Text className="mb-1 text-xs text-slate-500">Quantity</Text>
                        <TextInput
                          value={line.quantity}
                          onChangeText={(value) =>
                            setLines((current) =>
                              current.map((item) =>
                                item.key === line.key ? { ...item, quantity: value } : item,
                              ),
                            )
                          }
                          keyboardType="decimal-pad"
                          className="min-h-11 w-28 rounded-xl bg-slate-100 px-3 text-slate-900"
                        />
                      </View>
                      <View>
                        <Text className="mb-1 text-xs text-slate-500">Cost / {line.unit}</Text>
                        <TextInput
                          value={line.unitCost}
                          onChangeText={(value) =>
                            setLines((current) =>
                              current.map((item) =>
                                item.key === line.key ? { ...item, unitCost: value } : item,
                              ),
                            )
                          }
                          keyboardType="decimal-pad"
                          className="min-h-11 w-32 rounded-xl bg-slate-100 px-3 text-slate-900"
                        />
                      </View>
                      <View className="w-28 items-end">
                        <Text className="text-xs text-slate-500">Line total</Text>
                        <Text className="mt-1 font-semibold text-slate-900">
                          {formatMoney(
                            String((Number(line.quantity) || 0) * (Number(line.unitCost) || 0)),
                          )}
                        </Text>
                      </View>
                      <Pressable
                        accessibilityLabel={`Remove ${line.label}`}
                        onPress={() =>
                          setLines((current) => current.filter((item) => item.key !== line.key))
                        }
                        className="h-10 w-10 items-center justify-center rounded-xl bg-red-50"
                      >
                        <Feather name="trash-2" size={16} color="#B42318" />
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : (
                <View className="items-center py-8">
                  <Text className="text-sm text-slate-400">
                    Choose products above to build this order.
                  </Text>
                </View>
              )}
            </View>

            <View className="rounded-2xl border border-slate-200 bg-white p-5">
              <Text className="mb-4 font-semibold text-slate-900">4. Delivery details</Text>
              <View className="flex-row flex-wrap gap-x-4">
                <View className="min-w-56 flex-1">
                  <Field
                    label="Expected date (YYYY-MM-DD)"
                    value={expectedDate}
                    onChangeText={setExpectedDate}
                    placeholder="2026-08-05"
                  />
                </View>
                <View className="min-w-56 flex-1">
                  <Field
                    label="Supplier quotation / reference"
                    value={supplierReference}
                    onChangeText={setSupplierReference}
                  />
                </View>
              </View>
              <Field label="Notes" value={notes} onChangeText={setNotes} multiline />
            </View>

            <View className="rounded-2xl bg-brand-50 p-5">
              <View className="flex-row items-center justify-between">
                <View>
                  <Text className="text-sm text-slate-500">Order total</Text>
                  <Text className="mt-1 text-2xl font-semibold text-brand-900">
                    {formatMoney(String(subtotal))}
                  </Text>
                </View>
                <Text className="max-w-72 text-right text-xs leading-5 text-slate-500">
                  Saving creates a draft. Inventory changes only when stock is physically received.
                </Text>
              </View>
            </View>
            {create.isError ? (
              <View className="flex-row items-start rounded-2xl border border-red-200 bg-red-50 p-4">
                <Feather name="alert-circle" size={19} color="#B42318" />
                <View className="ml-3 flex-1">
                  <Text className="font-medium text-red-800">Draft order was not created</Text>
                  <Text className="mt-1 text-sm leading-5 text-red-700">
                    {/failed to fetch|network request failed|load failed/i.test(
                      create.error.message,
                    )
                      ? 'The app could not reach the local API. Make sure the Ximo API is running, then try again.'
                      : create.error.message}
                  </Text>
                </View>
              </View>
            ) : null}
            <View className="flex-row justify-end gap-3">
              <View className="min-w-32">
                <Button title="Cancel" variant="secondary" onPress={() => router.back()} />
              </View>
              <View className="min-w-56">
                <Button
                  title={create.isPending ? 'Creating…' : 'Create draft order'}
                  disabled={
                    create.isPending ||
                    !branch ||
                    !supplierId ||
                    !lines.length ||
                    lines.some(
                      (line) =>
                        !(Number(line.quantity) > 0) ||
                        !Number.isFinite(Number(line.unitCost)) ||
                        Number(line.unitCost) < 0,
                    )
                  }
                  onPress={() => {
                    create.reset();
                    create.mutate();
                  }}
                />
              </View>
            </View>
          </View>
        </ScrollView>
      )}
      <Modal
        visible={Boolean(createdOrder)}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setCreatedOrder(null);
          router.replace('/purchasing');
        }}
      >
        <View className="flex-1 items-center justify-center bg-black/40 p-5">
          <View className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
            <View className="mb-5 items-center">
              <View className="h-16 w-16 items-center justify-center rounded-full bg-brand-50">
                <Feather name="check" size={30} color="#1A593B" />
              </View>
              <Text className="mt-4 text-center text-xl font-semibold text-slate-950">
                Draft created successfully
              </Text>
              <Text className="mt-2 text-center text-sm leading-5 text-slate-500">
                {createdOrder?.orderNumber} has been saved. Inventory will change only after the
                products are received.
              </Text>
            </View>
            <View className="mb-5 rounded-2xl bg-slate-50 p-4">
              <View className="flex-row items-center justify-between">
                <Text className="text-sm text-slate-500">Status</Text>
                <Text className="font-medium text-amber-700">Draft</Text>
              </View>
              <View className="my-3 h-px bg-slate-200" />
              <View className="flex-row items-center justify-between">
                <Text className="text-sm text-slate-500">Order total</Text>
                <Text className="font-semibold text-slate-950">
                  {formatMoney(createdOrder?.subtotal ?? '0')}
                </Text>
              </View>
            </View>
            <View className="gap-3">
              <Button
                title="View draft order"
                onPress={() => {
                  if (!createdOrder) return;
                  const orderId = createdOrder.id;
                  setCreatedOrder(null);
                  router.replace({
                    pathname: '/purchase-order/[id]',
                    params: { id: orderId },
                  });
                }}
              />
              <Button
                title="Back to purchasing"
                variant="secondary"
                onPress={() => {
                  setCreatedOrder(null);
                  router.replace('/purchasing');
                }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

export default function PurchaseOrderFormScreen() {
  return (
    <AppSidebarProvider>
      <PurchaseOrderFormContent />
    </AppSidebarProvider>
  );
}
