import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { Button, EmptyState, Field, Header, LoadingState, Screen } from '@/components/ui';
import { useIosAlert } from '@/providers/ios-alert';
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
  sellingPrice?: string;
}

interface InventoryLookupRow {
  productId: string;
  name: string;
  sku: string;
}

type PromoType = PromotionSummary['type'];

function normalizeMoneyInput(value: string): string | undefined {
  const trimmed = value.trim().replace(/,/g, '');
  if (!trimmed) return undefined;
  if (!/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(trimmed)) return trimmed;
  const [whole, fraction = ''] = trimmed.split('.');
  return `${whole}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}

function normalizePercentInput(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

const PROMO_TYPES: Array<{
  type: PromoType;
  label: string;
  shortLabel: string;
  icon: ComponentProps<typeof Feather>['name'];
  desc: string;
}> = [
  {
    type: 'combo_bundle',
    label: 'Combo Bundle',
    shortLabel: 'Combo',
    icon: 'package',
    desc: 'Multiple items for one fixed combo price',
  },
  {
    type: 'buy_x_get_y',
    label: 'Buy X Get Y',
    shortLabel: 'BOGO',
    icon: 'gift',
    desc: 'Buy trigger items to unlock a free or discounted item',
  },
  {
    type: 'tiered_quantity',
    label: 'Volume Tier',
    shortLabel: 'Volume',
    icon: 'trending-up',
    desc: 'Discount when buying a higher quantity',
  },
  {
    type: 'percentage_discount',
    label: 'Percent Off',
    shortLabel: '% Off',
    icon: 'percent',
    desc: 'Percentage discount off items or the order',
  },
  {
    type: 'fixed_discount',
    label: 'Fixed Off',
    shortLabel: '₱ Off',
    icon: 'tag',
    desc: 'Fixed cash amount off the order',
  },
];

function PromotionsContent() {
  const { currentUser } = useSession();
  const { showAlert } = useIosAlert();
  const activeBranch = useBranchStore((state) => state.activeBranch);
  const hydrateBranch = useBranchStore((state) => state.hydrate);
  const selectBranch = useBranchStore((state) => state.select);
  const branchHydrated = useBranchStore((state) => state.hydrated);
  const client = useQueryClient();

  const [search, setSearch] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingIsActive, setEditingIsActive] = useState(true);

  const [name, setName] = useState('');
  const [type, setType] = useState<PromoType>('combo_bundle');
  const [comboPrice, setComboPrice] = useState('');
  const [discountPercentage, setDiscountPercentage] = useState('');
  const [discountAmount, setDiscountAmount] = useState('');
  const [minOrderQuantity, setMinOrderQuantity] = useState('5');
  const [description, setDescription] = useState('');
  const [selectedProducts, setSelectedProducts] = useState<
    Array<{ productId: string; name: string; quantity: number }>
  >([]);
  const [productSearch, setProductSearch] = useState('');
  const [debouncedProductSearch, setDebouncedProductSearch] = useState('');

  const hasModule = currentUser?.modules.includes('promotions') ?? false;
  const activeType = PROMO_TYPES.find((item) => item.type === type) ?? PROMO_TYPES[0];
  const needsProducts = type === 'combo_bundle' || type === 'buy_x_get_y' || type === 'tiered_quantity';
  const branch = activeBranch ?? currentUser?.branches?.[0] ?? null;

  useEffect(() => {
    void hydrateBranch();
  }, [hydrateBranch]);

  useEffect(() => {
    if (!branchHydrated || activeBranch || !currentUser?.branches?.length) return;
    void selectBranch(currentUser.branches[0]!);
  }, [activeBranch, branchHydrated, currentUser, selectBranch]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedProductSearch(productSearch.trim()), 250);
    return () => clearTimeout(timer);
  }, [productSearch]);

  const resetForm = () => {
    setEditingId(null);
    setEditingIsActive(true);
    setName('');
    setDescription('');
    setType('combo_bundle');
    setComboPrice('');
    setDiscountPercentage('');
    setDiscountAmount('');
    setMinOrderQuantity('5');
    setSelectedProducts([]);
    setProductSearch('');
    setDebouncedProductSearch('');
  };

  const closeModal = () => {
    setModalVisible(false);
    resetForm();
  };

  const openCreateModal = () => {
    resetForm();
    setModalVisible(true);
  };

  const openEditModal = async (promo: PromotionSummary) => {
    try {
      const detail = await api<{
        id: string;
        name: string;
        description?: string;
        type: PromoType;
        comboPrice?: string;
        discountPercentage?: string;
        discountAmount?: string;
        isActive: boolean;
        items: Array<{
          productId: string;
          productName?: string;
          requiredQuantity: number;
        }>;
      }>(`/promotions/${promo.id}`);

      setEditingId(detail?.id || promo.id);
      setEditingIsActive(detail?.isActive ?? promo.isActive);
      setName(detail.name);
      setDescription(detail.description ?? '');
      setType(detail.type);
      setComboPrice(detail.comboPrice ?? '');
      setDiscountPercentage(detail.discountPercentage ?? '');
      setDiscountAmount(detail.discountAmount ?? '');
      setSelectedProducts(
        (detail.items ?? []).map((item) => ({
          productId: item.productId,
          name: item.productName ?? 'Product',
          quantity: item.requiredQuantity || 1,
        })),
      );
      setProductSearch('');
      setDebouncedProductSearch('');
      setModalVisible(true);
    } catch (error) {
      showAlert({
        title: 'Could not open promotion',
        message: error instanceof Error ? error.message : 'Try again.',
        type: 'error',
      });
    }
  };

  const query = useInfiniteQuery({
    queryKey: ['promotions', search],
    enabled: hasModule,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api<PromotionSummary[]>(
        `/promotions?page=${pageParam}&pageSize=30${
          search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''
        }`,
      ),
    getNextPageParam: (last, pages) => (last.length === 30 ? pages.length + 1 : undefined),
  });

  // Use inventory search (same source as Stock Overview) — more reliable for branch
  // catalogs than /products, which can 403 without products:read or miss unit joins.
  const productsQuery = useQuery({
    queryKey: ['promo-product-lookup', branch?.id, debouncedProductSearch],
    enabled: modalVisible && needsProducts && hasModule && Boolean(branch?.id),
    queryFn: async () => {
      if (!branch?.id) throw new Error('No branch selected');

      const params = new URLSearchParams({
        branchId: branch.id,
        page: '1',
        pageSize: '50',
        sort: 'name',
      });
      if (debouncedProductSearch) params.set('search', debouncedProductSearch);

      try {
        const inventoryRows = await api<InventoryLookupRow[]>(`/inventory?${params.toString()}`);
        const seen = new Set<string>();
        const fromInventory: ProductItem[] = [];
        for (const row of inventoryRows) {
          if (!row.productId || seen.has(row.productId)) continue;
          seen.add(row.productId);
          fromInventory.push({ id: row.productId, name: row.name, sku: row.sku });
        }
        if (fromInventory.length > 0) return fromInventory;
      } catch {
        // Fall through to products catalog.
      }

      const productParams = new URLSearchParams({
        branchId: branch.id,
        page: '1',
        pageSize: '50',
      });
      if (debouncedProductSearch) productParams.set('search', debouncedProductSearch);
      return api<ProductItem[]>(`/products?${productParams.toString()}`);
    },
  });

  const buildCreatePayload = () => {
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error('Enter a promotion name before saving.');

    const normalizedComboPrice = normalizeMoneyInput(comboPrice);
    const normalizedDiscountPercentage = normalizePercentInput(discountPercentage);
    const normalizedDiscountAmount = normalizeMoneyInput(discountAmount);

    if (type === 'combo_bundle') {
      if (!normalizedComboPrice) throw new Error('Enter a combo price before saving.');
      if (!/^(0|[1-9]\d{0,11})\.\d{2}$/.test(normalizedComboPrice)) {
        throw new Error('Combo price must be a valid amount (e.g. 199.00).');
      }
      if (selectedProducts.length === 0) {
        throw new Error('Add at least one product to the combo.');
      }
    }
    if (type === 'buy_x_get_y' && selectedProducts.length === 0) {
      throw new Error('Add at least one product for the Buy X Get Y deal.');
    }
    if (type === 'percentage_discount') {
      if (!normalizedDiscountPercentage) throw new Error('Enter a discount percentage before saving.');
      if (!/^(\d{1,2}(\.\d{1,2})?|100(\.0{1,2})?)$/.test(normalizedDiscountPercentage)) {
        throw new Error('Discount percentage must be between 0 and 100.');
      }
    }
    if (type === 'fixed_discount') {
      if (!normalizedDiscountAmount) throw new Error('Enter a discount amount before saving.');
      if (!/^(0|[1-9]\d{0,11})\.\d{2}$/.test(normalizedDiscountAmount)) {
        throw new Error('Discount amount must be a valid amount (e.g. 50.00).');
      }
    }
    if (type === 'tiered_quantity') {
      if (!normalizedDiscountPercentage && !normalizedDiscountAmount) {
        throw new Error('Enter a discount percentage (e.g. 10) or fixed discount amount (e.g. 20.00).');
      }
      if (normalizedDiscountPercentage && !/^(\d{1,2}(\.\d{1,2})?|100(\.0{1,2})?)$/.test(normalizedDiscountPercentage)) {
        throw new Error('Discount percentage must be between 0 and 100.');
      }
      if (normalizedDiscountAmount && !/^(0|[1-9]\d{0,11})\.\d{2}$/.test(normalizedDiscountAmount)) {
        throw new Error('Discount amount must be a valid amount (e.g. 20.00).');
      }
    }

    return {
      name: trimmedName,
      type,
      description: description.trim() || undefined,
      comboPrice: type === 'combo_bundle' ? normalizedComboPrice : undefined,
      discountPercentage:
        type === 'percentage_discount' || (type === 'tiered_quantity' && normalizedDiscountPercentage)
          ? normalizedDiscountPercentage
          : undefined,
      discountAmount:
        type === 'fixed_discount' || (type === 'tiered_quantity' && normalizedDiscountAmount)
          ? normalizedDiscountAmount
          : undefined,
      minOrderQuantity: type === 'tiered_quantity' ? Math.max(1, Number(minOrderQuantity) || 1) : 1,
      isActive: editingId ? editingIsActive : true,
      items:
        selectedProducts.length > 0
          ? selectedProducts.map((product) => ({
              productId: product.productId,
              role: type === 'buy_x_get_y' ? ('trigger_item' as const) : ('combo_component' as const),
              requiredQuantity: product.quantity,
            }))
          : undefined,
    };
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = buildCreatePayload();
      if (editingId) {
        try {
          return await api(`/promotions/${editingId}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          });
        } catch {
          try {
            return await api(`/promotions/${editingId}`, {
              method: 'POST',
              body: JSON.stringify(payload),
            });
          } catch {
            const created = await api<{ id?: string }>('/promotions', {
              method: 'POST',
              body: JSON.stringify(payload),
            });
            try {
              await api(`/promotions/${editingId}/toggle`, { method: 'POST' });
            } catch {
              // ignore
            }
            return created;
          }
        }
      }
      return api('/promotions', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: async () => {
      showAlert({
        title: editingId ? 'Promotion updated' : 'Promotion created',
        message: editingId
          ? 'Changes are saved and will show on POS for active combos.'
          : 'New promotion and combo deal is now active.',
        type: 'success',
      });
      closeModal();
      await Promise.all([
        client.invalidateQueries({ queryKey: ['promotions'] }),
        client.invalidateQueries({ queryKey: ['pos-promotions'] }),
        client.invalidateQueries({ queryKey: ['pos-checkout-promotions'] }),
      ]);
    },
    onError: (error) =>
      showAlert({
        title: editingId ? 'Could not update promotion' : 'Could not create promotion',
        message: error.message,
        type: 'error',
      }),
  });

  const toggleMutation = useMutation({
    mutationFn: (promoId: string) => api(`/promotions/${promoId}/toggle`, { method: 'POST' }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['promotions'] }),
        client.invalidateQueries({ queryKey: ['pos-promotions'] }),
        client.invalidateQueries({ queryKey: ['pos-checkout-promotions'] }),
      ]);
    },
    onError: (error) =>
      showAlert({
        title: 'Failed to update promotion',
        message: error.message,
        type: 'error',
      }),
  });

  const promotions = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);
  const availableProducts = useMemo(() => {
    const selectedIds = new Set(selectedProducts.map((item) => item.productId));
    const rows = productsQuery.data ?? [];
    return rows.filter((product) => !selectedIds.has(product.id)).slice(0, 12);
  }, [productsQuery.data, selectedProducts]);

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
        if (p.productId !== prodId) return p;
        return { ...p, quantity: Math.max(1, p.quantity + delta) };
      }),
    );
  };

  const savePromotion = () => {
    try {
      buildCreatePayload();
    } catch (error) {
      showAlert({
        title: 'Missing promotion details',
        message: error instanceof Error ? error.message : 'Check the form and try again.',
        type: 'warning',
      });
      return;
    }
    saveMutation.mutate();
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
        subtitle="Combo deals, BOGO, and discounts"
        action={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create new promotion"
            onPress={openCreateModal}
            className="min-h-11 flex-row items-center rounded-xl bg-brand-700 px-4 active:bg-brand-800"
          >
            <Feather name="plus" size={16} color="#FFFFFF" />
            <Text className="ml-1.5 text-sm font-semibold text-white">New</Text>
          </Pressable>
        }
      />

      <View className="border-b border-slate-100 bg-white px-4 py-3">
        <View className="min-h-11 flex-row items-center rounded-xl border border-slate-200 bg-slate-100 px-3">
          <Feather name="search" size={17} color="#81776E" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search promotions…"
            placeholderTextColor="#81776E"
            selectionColor="#1A593B"
            style={{ outline: 'none' } as object}
            className="ml-2 flex-1 min-h-11 bg-transparent text-sm text-slate-900"
          />
          {search ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setSearch('')}>
              <Feather name="x" size={16} color="#81776E" />
            </Pressable>
          ) : null}
        </View>
      </View>

      <FlatList
        className="flex-1"
        data={promotions}
        keyExtractor={(item) => item.id}
        contentContainerClassName="p-4 gap-3 grow"
        ListEmptyComponent={
          query.isLoading ? (
            <LoadingState label="Loading promotions…" />
          ) : (
            <EmptyState
              title="No promotions yet"
              message="Create a combo, BOGO, or discount to get started."
            />
          )
        }
        renderItem={({ item }) => {
          const typeObj = PROMO_TYPES.find((t) => t.type === item.type);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Edit ${item.name}`}
              onPress={() => void openEditModal(item)}
              className="rounded-2xl border border-slate-100 bg-white p-4 active:bg-slate-50"
            >
              <View className="flex-row items-start justify-between gap-3">
                <View className="flex-1 flex-row items-start gap-3">
                  <View className="h-10 w-10 items-center justify-center rounded-xl bg-brand-50">
                    <Feather name={typeObj?.icon ?? 'tag'} size={18} color="#0D5C3A" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-base font-bold text-slate-900">{item.name}</Text>
                    <Text className="mt-0.5 text-xs font-medium text-brand-700">
                      {typeObj?.label ?? item.type}
                    </Text>
                    {item.description ? (
                      <Text numberOfLines={2} className="mt-1 text-xs text-slate-500">
                        {item.description}
                      </Text>
                    ) : null}
                  </View>
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={item.isActive ? 'Disable promotion' : 'Enable promotion'}
                  onPress={(event) => {
                    event.stopPropagation?.();
                    toggleMutation.mutate(item.id);
                  }}
                  className={`rounded-full px-3 py-1.5 ${
                    item.isActive ? 'bg-emerald-100' : 'bg-slate-100'
                  }`}
                >
                  <Text
                    className={`text-xs font-bold ${
                      item.isActive ? 'text-emerald-800' : 'text-slate-500'
                    }`}
                  >
                    {item.isActive ? 'Active' : 'Off'}
                  </Text>
                </Pressable>
              </View>

              <View className="mt-3 flex-row flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-3">
                {item.comboPrice ? (
                  <Text className="text-sm font-semibold text-emerald-700">
                    {formatMoney(item.comboPrice)} combo
                  </Text>
                ) : null}
                {item.discountPercentage ? (
                  <Text className="text-sm font-semibold text-emerald-700">
                    {item.discountPercentage}% off
                  </Text>
                ) : null}
                {item.discountAmount ? (
                  <Text className="text-sm font-semibold text-emerald-700">
                    {formatMoney(item.discountAmount)} off
                  </Text>
                ) : null}
                <Text className="text-xs text-slate-500">
                  {item.itemCount} product{item.itemCount === 1 ? '' : 's'}
                </Text>
                <View className="ml-auto min-h-9 flex-row items-center rounded-xl border border-brand-200 bg-brand-50 px-3">
                  <Feather name="edit-2" size={13} color="#0D5C3A" />
                  <Text className="ml-1.5 text-xs font-semibold text-brand-800">Edit</Text>
                </View>
              </View>
            </Pressable>
          );
        }}
      />

      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={closeModal}
      >
        <View
          pointerEvents="box-none"
          style={[
            StyleSheet.absoluteFillObject,
            Platform.OS === 'web'
              ? ({ zIndex: 100000, position: 'fixed' } as object)
              : { zIndex: 100000 },
          ]}
          className="items-center justify-end sm:justify-center sm:p-6"
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close create promotion"
            onPress={closeModal}
            style={[StyleSheet.absoluteFillObject, { zIndex: 0 }]}
            className="bg-black/50"
          />

          <View
            pointerEvents="auto"
            style={{ zIndex: 1, elevation: 20 }}
            className="max-h-[92%] w-full max-w-lg overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
          >
            <View className="flex-row items-center justify-between border-b border-slate-100 px-5 py-4">
              <View className="flex-1 pr-3">
                <Text className="text-lg font-bold text-slate-900">
                  {editingId ? 'Edit promotion' : 'New promotion'}
                </Text>
                <Text className="mt-0.5 text-xs text-slate-500">
                  {editingId
                    ? 'Update price, products, or details'
                    : 'Set the type, price, and products'}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={closeModal}
                className="h-10 w-10 items-center justify-center rounded-xl bg-slate-100 active:bg-slate-200"
              >
                <Feather name="x" size={18} color="#475569" />
              </Pressable>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              className="flex-1"
              contentContainerClassName="gap-5 p-5 pb-6"
            >
              <Field
                label="Promotion name"
                value={name}
                onChangeText={setName}
                placeholder="e.g. Lunch Combo"
              />

              <View>
                <Text className="mb-2 text-xs font-semibold text-slate-700">Type</Text>
                <View className="flex-row flex-wrap gap-2">
                  {PROMO_TYPES.map((option) => {
                    const selected = type === option.type;
                    return (
                      <Pressable
                        key={option.type}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => setType(option.type)}
                        className={`min-h-10 flex-row items-center rounded-full border px-3.5 ${
                          selected
                            ? 'border-brand-700 bg-brand-700'
                            : 'border-slate-200 bg-white active:bg-slate-50'
                        }`}
                      >
                        <Feather
                          name={option.icon}
                          size={14}
                          color={selected ? '#FFFFFF' : '#1A593B'}
                        />
                        <Text
                          className={`ml-1.5 text-sm font-semibold ${
                            selected ? 'text-white' : 'text-slate-800'
                          }`}
                        >
                          {option.shortLabel}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text className="mt-2 text-xs leading-4 text-slate-500">{activeType.desc}</Text>
              </View>

              {type === 'combo_bundle' ? (
                <Field
                  label="Combo price (₱)"
                  value={comboPrice}
                  onChangeText={setComboPrice}
                  keyboardType="decimal-pad"
                  placeholder="199.00"
                />
              ) : null}

              {type === 'percentage_discount' ? (
                <Field
                  label="Discount (%)"
                  value={discountPercentage}
                  onChangeText={setDiscountPercentage}
                  keyboardType="decimal-pad"
                  placeholder="15"
                />
              ) : null}

              {type === 'fixed_discount' ? (
                <Field
                  label="Discount amount (₱)"
                  value={discountAmount}
                  onChangeText={setDiscountAmount}
                  keyboardType="decimal-pad"
                  placeholder="50.00"
                />
              ) : null}

              {type === 'tiered_quantity' ? (
                <View className="gap-3">
                  <Field
                    label="Minimum quantity to qualify"
                    value={minOrderQuantity}
                    onChangeText={setMinOrderQuantity}
                    keyboardType="number-pad"
                    placeholder="e.g. 5 (Buy 5 or more packs)"
                  />
                  <Field
                    label="Discount percentage (% off)"
                    value={discountPercentage}
                    onChangeText={setDiscountPercentage}
                    keyboardType="decimal-pad"
                    placeholder="e.g. 10 for 10% off"
                  />
                  <Field
                    label="OR Fixed discount amount per item/order (₱)"
                    value={discountAmount}
                    onChangeText={setDiscountAmount}
                    keyboardType="decimal-pad"
                    placeholder="e.g. 20.00"
                  />
                </View>
              ) : null}

              {needsProducts ? (
                <View className="gap-3">
                  <View className="flex-row items-end justify-between">
                    <Text className="text-xs font-semibold text-slate-700">Products</Text>
                    <Text className="text-xs text-slate-400">
                      {selectedProducts.length} selected
                    </Text>
                  </View>

                  <View className="min-h-11 flex-row items-center rounded-xl border border-slate-200 bg-white px-3">
                    <Feather name="search" size={16} color="#81776E" />
                    <TextInput
                      value={productSearch}
                      onChangeText={setProductSearch}
                      placeholder="Search name or SKU…"
                      placeholderTextColor="#81776E"
                      selectionColor="#1A593B"
                      autoCorrect={false}
                      autoCapitalize="none"
                      returnKeyType="search"
                      style={{ outline: 'none' } as object}
                      className="ml-2 flex-1 min-h-11 bg-transparent text-sm text-slate-900"
                    />
                    {productSearch ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Clear product search"
                        onPress={() => setProductSearch('')}
                        hitSlop={8}
                      >
                        <Feather name="x" size={16} color="#81776E" />
                      </Pressable>
                    ) : null}
                  </View>

                  {!branch?.id ? (
                    <Text className="text-xs text-amber-700">Select a branch before adding products.</Text>
                  ) : productsQuery.isLoading ? (
                    <Text className="text-xs text-slate-500">Loading products…</Text>
                  ) : productsQuery.isError ? (
                    <View className="rounded-xl border border-red-100 bg-red-50 px-3 py-2.5">
                      <Text className="text-xs font-medium text-red-700">
                        Could not load products: {productsQuery.error.message}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => void productsQuery.refetch()}
                        className="mt-2 self-start"
                      >
                        <Text className="text-xs font-bold text-red-800">Retry</Text>
                      </Pressable>
                    </View>
                  ) : availableProducts.length ? (
                    <View className="gap-1.5">
                      {productsQuery.isFetching ? (
                        <Text className="text-[11px] text-slate-400">Updating…</Text>
                      ) : null}
                      <View
                        className="rounded-xl border border-slate-200 bg-white"
                        // Fixed height + overflow so the list scrolls inside the modal
                        // instead of stretching the whole sheet (maxHeight alone fails on web).
                        style={
                          {
                            height: 200,
                            maxHeight: 200,
                            overflow: 'scroll',
                            overflowY: 'auto',
                            overflowX: 'hidden',
                          } as object
                        }
                      >
                        {availableProducts.map((product, index) => (
                          <Pressable
                            key={product.id}
                            accessibilityRole="button"
                            accessibilityLabel={`Add ${product.name}`}
                            onPress={() => addProductToCombo(product)}
                            className={`flex-row items-center justify-between px-3 py-2.5 active:bg-brand-50 ${
                              index > 0 ? 'border-t border-slate-100' : ''
                            }`}
                          >
                            <View className="flex-1 pr-3">
                              <Text className="text-sm font-medium text-slate-900">
                                {product.name}
                              </Text>
                              {product.sku ? (
                                <Text className="text-xs text-slate-400">{product.sku}</Text>
                              ) : null}
                            </View>
                            <Text className="text-xs font-bold text-brand-700">Add</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  ) : (
                    <Text className="text-xs text-slate-500">
                      {debouncedProductSearch
                        ? `No stock items match “${debouncedProductSearch}”.`
                        : 'No stock items available to add.'}
                    </Text>
                  )}

                  {selectedProducts.length ? (
                    <View className="gap-2">
                      {selectedProducts.map((product) => (
                        <View
                          key={product.productId}
                          className="flex-row items-center rounded-xl border border-slate-200 bg-white px-3 py-2.5"
                        >
                          <Text className="flex-1 pr-2 text-sm font-semibold text-slate-900" numberOfLines={1}>
                            {product.name}
                          </Text>
                          <View className="flex-row items-center gap-1.5">
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Decrease ${product.name}`}
                              onPress={() => updateProductQty(product.productId, -1)}
                              className="h-8 w-8 items-center justify-center rounded-lg bg-slate-100"
                            >
                              <Feather name="minus" size={14} color="#334155" />
                            </Pressable>
                            <Text className="w-6 text-center text-sm font-bold text-slate-900">
                              {product.quantity}
                            </Text>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Increase ${product.name}`}
                              onPress={() => updateProductQty(product.productId, 1)}
                              className="h-8 w-8 items-center justify-center rounded-lg bg-slate-100"
                            >
                              <Feather name="plus" size={14} color="#334155" />
                            </Pressable>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Remove ${product.name}`}
                              onPress={() => removeProduct(product.productId)}
                              className="ml-1 h-8 w-8 items-center justify-center rounded-lg bg-red-50"
                            >
                              <Feather name="trash-2" size={14} color="#EF4444" />
                            </Pressable>
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}

              <Field
                label="Notes (optional)"
                value={description}
                onChangeText={setDescription}
                placeholder="Cashier note or terms"
                multiline
              />
            </ScrollView>

            <View className="flex-row gap-2 border-t border-slate-100 bg-white px-5 py-4">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                onPress={closeModal}
                className="min-h-12 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white active:bg-slate-50"
              >
                <Text className="font-semibold text-slate-700">Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save promotion"
                disabled={saveMutation.isPending || name.trim().length < 2}
                onPress={savePromotion}
                className={`min-h-12 flex-[1.4] items-center justify-center rounded-xl bg-brand-700 ${
                  saveMutation.isPending || name.trim().length < 2
                    ? 'opacity-50'
                    : 'active:bg-brand-800'
                }`}
              >
                <Text className="font-semibold text-white">
                  {saveMutation.isPending
                    ? 'Saving…'
                    : editingId
                      ? 'Save changes'
                      : 'Save promotion'}
                </Text>
              </Pressable>
            </View>
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
