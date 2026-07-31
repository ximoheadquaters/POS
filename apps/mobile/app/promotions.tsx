import { useMemo, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { Button, EmptyState, Field, Header, LoadingState, Screen } from '@/components/ui';
import { useSession } from '@/providers/session';
import { useBranchStore } from '@/store/branch';

interface PromotionSummary {
  id: string;
  name: string;
  code?: string;
  description?: string;
  type: 'combo_bundle' | 'buy_x_get_y' | 'tiered_quantity' | 'percentage_discount' | 'fixed_discount';
  comboPrice?: string;
  discountPercentage?: string;
  discountAmount?: string;
  minOrderQuantity?: number;
  isActive: boolean;
  itemCount: number;
}

interface ProductItem {
  id: string;
  name: string;
  sku?: string;
  price: number;
}

const PROMO_TYPES = [
  { type: 'combo_bundle', label: 'Combo Bundle Deal', icon: 'package', desc: 'Combine multiple items into a single fixed combo price (e.g., Burger + Drink = ₱199)' },
  { type: 'buy_x_get_y', label: 'Buy X Get Y (BOGO)', icon: 'gift', desc: 'Buy trigger item(s) to get a discounted or free item' },
  { type: 'tiered_quantity', label: 'Volume Tiered Discount', icon: 'trending-up', desc: 'Special discount when buying X or more items' },
  { type: 'percentage_discount', label: 'Percentage Off (%)', icon: 'percent', desc: 'Flat percentage discount off order or items' },
  { type: 'fixed_discount', label: 'Fixed Amount Off (₱)', icon: 'tag', desc: 'Fixed cash discount off total order' },
] as const;

function PromotionsContent() {
  const { currentUser } = useSession();
  const branch = useBranchStore((state) => state.activeBranch)!;
  const client = useQueryClient();

  const [search, setSearch] = useState('');
  const [modalVisible, setModalVisible] = useState(false);

  // New promo form state
  const [name, setName] = useState('');
  const [type, setType] = useState<'combo_bundle' | 'buy_x_get_y' | 'tiered_quantity' | 'percentage_discount' | 'fixed_discount'>('combo_bundle');
  const [comboPrice, setComboPrice] = useState('');
  const [discountPercentage, setDiscountPercentage] = useState('');
  const [discountAmount, setDiscountAmount] = useState('');
  const [description, setDescription] = useState('');
  const [selectedProducts, setSelectedProducts] = useState<Array<{ productId: string; name: string; quantity: number }>>([]);
  const [productSearch, setProductSearch] = useState('');

  // Check SaaS module enablement
  const hasModule = currentUser?.modules.includes('promotions') ?? false;

  const query = useInfiniteQuery({
    queryKey: ['promotions', search],
    enabled: hasModule,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api<PromotionSummary[]>(
        `/promotions?page=${pageParam}&pageSize=30&search=${encodeURIComponent(search)}`,
      ),
    getNextPageParam: (last, pages) => (last.length === 30 ? pages.length + 1 : undefined),
  });

  const productsQuery = useQuery({
    queryKey: ['products-promo-lookup', productSearch],
    enabled: modalVisible && hasModule,
    queryFn: () => api<ProductItem[]>(`/products?pageSize=20&search=${encodeURIComponent(productSearch)}`),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api('/promotions', {
        method: 'POST',
        body: JSON.stringify({
          name,
          type,
          description: description || undefined,
          comboPrice: type === 'combo_bundle' ? comboPrice : undefined,
          discountPercentage: type === 'percentage_discount' ? discountPercentage : undefined,
          discountAmount: type === 'fixed_discount' ? discountAmount : undefined,
          items: selectedProducts.map((p) => ({
            productId: p.productId,
            role: type === 'buy_x_get_y' ? 'trigger_item' : 'combo_component',
            requiredQuantity: p.quantity,
          })),
        }),
      }),
    onSuccess: async () => {
      Alert.alert('Promotion created', 'New promotion and combo deal is now active.');
      setModalVisible(false);
      setName('');
      setDescription('');
      setComboPrice('');
      setDiscountPercentage('');
      setDiscountAmount('');
      setSelectedProducts([]);
      await client.invalidateQueries({ queryKey: ['promotions'] });
    },
    onError: (error) => Alert.alert('Could not create promotion', error.message),
  });

  const toggleMutation = useMutation({
    mutationFn: (promoId: string) => api(`/promotions/${promoId}/toggle`, { method: 'POST' }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['promotions'] });
    },
    onError: (error) => Alert.alert('Failed to update promotion', error.message),
  });

  const promotions = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);

  const addProductToCombo = (prod: ProductItem) => {
    if (selectedProducts.some((p) => p.productId === prod.id)) return;
    setSelectedProducts((prev) => [...prev, { productId: prod.id, name: prod.name, quantity: 1 }]);
  };

  const removeProduct = (prodId: string) => {
    setSelectedProducts((prev) => prev.filter((p) => p.productId !== prodId));
  };

  const updateProductQty = (prodId: string, delta: number) => {
    setSelectedProducts((prev) =>
      prev.map((p) => {
        if (p.productId === prodId) {
          const newQty = Math.max(1, p.quantity + delta);
          return { ...p, quantity: newQty };
        }
        return p;
      }),
    );
  };

  if (!hasModule) {
    return (
      <Screen>
        <Header title="Promotions & Combos" showBack backLabel="More" fallbackHref="/(tabs)/more" />
        <View className="flex-1 items-center justify-center p-6">
          <View className="mb-4 h-16 w-16 items-center justify-center rounded-2xl bg-amber-100">
            <Feather name="lock" size={32} color="#D97706" />
          </View>
          <Text className="text-xl font-bold text-slate-900">Module Not Enabled</Text>
          <Text className="mt-2 max-w-md text-center text-sm text-slate-600">
            Advanced Promotions & Combos is a SaaS plan capability. Contact your organization
            administrator to upgrade your plan tier or enable this feature.
          </Text>
          <View className="mt-6">
            <Button title="Back to More" variant="secondary" onPress={() => router.back()} />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Header
        title="Promotions & Combos"
        subtitle="Manage combo deals, bundle sales, and discounts"
        action={
          <Button title="+ New Promotion" onPress={() => setModalVisible(true)} />
        }
      />

      <View className="border-b border-slate-200 bg-white p-4">
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search promotions, deals, or codes…"
          placeholderTextColor="#81776E"
          className="min-h-12 rounded-xl bg-slate-100 px-4 text-sm"
        />
      </View>

      <FlatList
        data={promotions}
        keyExtractor={(item) => item.id}
        contentContainerClassName="p-4 gap-3"
        ListEmptyComponent={
          query.isLoading ? (
            <LoadingState label="Loading promotions…" />
          ) : (
            <EmptyState
              title="No active promotions"
              message="Create combo deals, BOGO offers, or discounts to boost sales."
            />
          )
        }
        renderItem={({ item }) => {
          const typeObj = PROMO_TYPES.find((t) => t.type === item.type);
          return (
            <View className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-2 flex-1 pr-2">
                  <View className="h-10 w-10 items-center justify-center rounded-xl bg-brand-50">
                    <Feather name={(typeObj?.icon as any) || 'tag'} size={20} color="#0D5C3A" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-base font-bold text-slate-900">{item.name}</Text>
                    <Text className="text-xs font-semibold text-brand-700">{typeObj?.label}</Text>
                  </View>
                </View>

                <Pressable
                  onPress={() => toggleMutation.mutate(item.id)}
                  className={`rounded-full px-3 py-1.5 ${
                    item.isActive ? 'bg-emerald-100' : 'bg-slate-100'
                  }`}
                >
                  <Text
                    className={`text-xs font-bold ${
                      item.isActive ? 'text-emerald-800' : 'text-slate-500'
                    }`}
                  >
                    {item.isActive ? 'Active' : 'Disabled'}
                  </Text>
                </Pressable>
              </View>

              {item.description ? (
                <Text className="mt-2 text-xs text-slate-600">{item.description}</Text>
              ) : null}

              <View className="mt-3 flex-row flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
                {item.comboPrice ? (
                  <Text className="text-sm font-bold text-emerald-700">
                    Combo Price: {formatMoney(item.comboPrice)}
                  </Text>
                ) : null}
                {item.discountPercentage ? (
                  <Text className="text-sm font-bold text-emerald-700">
                    Discount: {item.discountPercentage}% OFF
                  </Text>
                ) : null}
                {item.discountAmount ? (
                  <Text className="text-sm font-bold text-emerald-700">
                    Discount: {formatMoney(item.discountAmount)} OFF
                  </Text>
                ) : null}
                <Text className="text-xs text-slate-500">
                  {item.itemCount} item component{item.itemCount === 1 ? '' : 's'}
                </Text>
              </View>
            </View>
          );
        }}
      />

      {/* New Promotion Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View className="flex-1 bg-black/50 justify-end md:justify-center p-0 md:p-6">
          <View className="max-h-[90%] w-full max-w-2xl mx-auto rounded-t-3xl md:rounded-3xl bg-white p-5 shadow-xl">
            <View className="flex-row items-center justify-between border-b border-slate-100 pb-3">
              <Text className="text-lg font-bold text-slate-900">Create Advanced Deal / Combo</Text>
              <Pressable onPress={() => setModalVisible(false)} className="p-2">
                <Feather name="x" size={20} color="#64748B" />
              </Pressable>
            </View>

            <ScrollView className="mt-4" contentContainerClassName="gap-4 pb-6">
              <Field
                label="Promotion Name"
                value={name}
                onChangeText={setName}
                placeholder="e.g. Lunch Combo Deal, BOGO Weekend Special"
              />

              <View>
                <Text className="mb-2 text-xs font-semibold text-slate-700">Promotion Type</Text>
                <View className="gap-2">
                  {PROMO_TYPES.map((t) => (
                    <Pressable
                      key={t.type}
                      onPress={() => setType(t.type as any)}
                      className={`flex-row items-center rounded-xl p-3 border ${
                        type === t.type
                          ? 'border-brand-700 bg-brand-50'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <View className="mr-3 h-9 w-9 items-center justify-center rounded-lg bg-white border border-slate-200">
                        <Feather name={t.icon as any} size={18} color="#0D5C3A" />
                      </View>
                      <View className="flex-1">
                        <Text className="text-sm font-bold text-slate-900">{t.label}</Text>
                        <Text className="text-xs text-slate-500">{t.desc}</Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              </View>

              {type === 'combo_bundle' ? (
                <Field
                  label="Bundle Special Combo Price (₱)"
                  value={comboPrice}
                  onChangeText={setComboPrice}
                  keyboardType="decimal-pad"
                  placeholder="199.00"
                />
              ) : null}

              {type === 'percentage_discount' ? (
                <Field
                  label="Percentage Discount (%)"
                  value={discountPercentage}
                  onChangeText={setDiscountPercentage}
                  keyboardType="decimal-pad"
                  placeholder="15.00"
                />
              ) : null}

              {type === 'fixed_discount' ? (
                <Field
                  label="Fixed Cash Discount Amount (₱)"
                  value={discountAmount}
                  onChangeText={setDiscountAmount}
                  keyboardType="decimal-pad"
                  placeholder="50.00"
                />
              ) : null}

              {type === 'combo_bundle' || type === 'buy_x_get_y' ? (
                <View>
                  <Text className="mb-1 text-xs font-semibold text-slate-700">
                    Add Component Products
                  </Text>
                  <TextInput
                    value={productSearch}
                    onChangeText={setProductSearch}
                    placeholder="Search product catalog…"
                    className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm"
                  />

                  {productsQuery.data?.length ? (
                    <View className="mt-2 max-h-36 rounded-xl border border-slate-100 bg-slate-50 p-2">
                      <ScrollView nestedScrollEnabled>
                        {productsQuery.data.map((p) => (
                          <Pressable
                            key={p.id}
                            onPress={() => addProductToCombo(p)}
                            className="flex-row items-center justify-between border-b border-slate-200/60 p-2 active:bg-slate-200/50"
                          >
                            <Text className="text-sm font-medium text-slate-900">{p.name}</Text>
                            <Text className="text-xs font-bold text-brand-700">+ Add</Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    </View>
                  ) : null}

                  <View className="mt-3 gap-2">
                    {selectedProducts.map((p) => (
                      <View
                        key={p.productId}
                        className="flex-row items-center justify-between rounded-xl border border-slate-200 bg-white p-3"
                      >
                        <Text className="flex-1 font-bold text-slate-900 pr-2">{p.name}</Text>
                        <View className="flex-row items-center gap-2">
                          <Pressable
                            onPress={() => updateProductQty(p.productId, -1)}
                            className="h-8 w-8 items-center justify-center rounded-lg bg-slate-100"
                          >
                            <Text className="font-bold text-slate-700">-</Text>
                          </Pressable>
                          <Text className="w-6 text-center font-bold text-slate-900">{p.quantity}</Text>
                          <Pressable
                            onPress={() => updateProductQty(p.productId, 1)}
                            className="h-8 w-8 items-center justify-center rounded-lg bg-slate-100"
                          >
                            <Text className="font-bold text-slate-700">+</Text>
                          </Pressable>
                          <Pressable onPress={() => removeProduct(p.productId)} className="ml-2 p-1">
                            <Feather name="trash-2" size={16} color="#EF4444" />
                          </Pressable>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              <Field
                label="Description & Instructions"
                value={description}
                onChangeText={setDescription}
                placeholder="Optional promotional terms or cashier note"
                multiline
              />

              <Button
                title={createMutation.isPending ? 'Creating deal…' : 'Save Promotion'}
                disabled={createMutation.isPending || !name.trim()}
                onPress={() => createMutation.mutate()}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

export default function PromotionsScreen() {
  return (
    <AppSidebarProvider>
      <PromotionsContent />
    </AppSidebarProvider>
  );
}
