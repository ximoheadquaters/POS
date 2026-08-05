import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { Alert, FlatList, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { convertRecipeQuantity } from '@ximo/shared';
import Feather from '@expo/vector-icons/Feather';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { useSession } from '@/providers/session';
import { useBranchStore } from '@/store/branch';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import {
  formatCatalogUnitPrice,
  getRetailProductTypeBadges,
  getStockStatus,
  hasLegacyInvalidConversion,
} from '@/lib/product-list-badges';

interface Product {
  id: string;
  name: string;
  sku: string;
  unit?: string;
  inventoryRole?: 'sellable' | 'ingredient' | 'both';
  preparationBehavior?: 'standard' | 'cook_to_order' | 'preproduced';
  hasRecipe?: boolean;
  sellingPrice: string;
  cost: string;
  averageCost: string;
  grossMarginPercent: string | null;
  suggestedSellingPrice: string;
  targetMarginPercent: string;
  lowMarginThresholdPercent: string;
  isLowMargin: boolean;
  status: string;
  trackInventory: boolean;
  availableQuantity?: number | null;
  sellingUnits?: Array<{ variantId: string; name: string; unit: string; unitsPerBase: number }>;
  categoryName?: string;
  brandName?: string;
}

type ProductFilter = 'all' | 'sellable' | 'ingredient' | 'both';

const ALL_PRODUCT_FILTERS: Array<{
  id: ProductFilter;
  title: string;
  description: string;
  icon: ComponentProps<typeof Feather>['name'];
}> = [
  { id: 'all', title: 'All products', description: 'Entire catalogue', icon: 'grid' },
  {
    id: 'sellable',
    title: 'Products for sale',
    description: 'Shown at the POS',
    icon: 'shopping-cart',
  },
  {
    id: 'ingredient',
    title: 'Raw inventory',
    description: 'Used by recipes',
    icon: 'archive',
  },
  { id: 'both', title: 'Dual use', description: 'Sold and used in BOM', icon: 'repeat' },
];

function compatibleRecipeUnits(baseUnit?: string) {
  const normalized = (baseUnit ?? '').trim().toLowerCase();
  if (['g', 'gram', 'grams', 'kg', 'kilogram', 'kilograms'].includes(normalized)) {
    return [
      { code: 'g', label: 'Grams (g)' },
      { code: 'kg', label: 'Kilograms (kg)' },
    ];
  }
  if (['ml', 'milliliter', 'milliliters', 'l', 'liter', 'liters'].includes(normalized)) {
    return [
      { code: 'ml', label: 'Milliliters (ml)' },
      { code: 'l', label: 'Liters (L)' },
    ];
  }
  return [{ code: 'piece', label: 'Pieces (pc)' }];
}

interface RecipeItemRow {
  ingredientProductId: string;
  ingredientName: string;
  quantityRequired: number;
  unit: string;
  baseUnit?: string;
  cost: string;
}

function RecipeModal({
  product,
  onClose,
  allProducts,
}: {
  product: Product | null;
  onClose(): void;
  allProducts: Product[];
}) {
  const queryClient = useQueryClient();
  const [items, setItems] = useState<RecipeItemRow[]>([]);
  const [selectedIngredientId, setSelectedIngredientId] = useState('');
  const [quantityInput, setQuantityInput] = useState('1');
  const [unitInput, setUnitInput] = useState('piece');
  const [searchQuery, setSearchQuery] = useState('');

  const recipeQuery = useQuery({
    queryKey: ['product-recipe', product?.id],
    enabled: Boolean(product?.id),
    queryFn: async () => {
      const res = await api<
        Array<{
          ingredientProductId: string;
          ingredientName: string;
          quantityRequired: number;
          unit: string;
          ingredientCost: string;
        }>
      >(`/products/${product!.id}/recipe`);
      return res;
    },
  });

  useEffect(() => {
    if (recipeQuery.data) {
      setItems(
        recipeQuery.data.map((item) => {
          const matchingProduct = allProducts.find((p) => p.id === item.ingredientProductId);
          return {
            ingredientProductId: item.ingredientProductId,
            ingredientName: item.ingredientName,
            quantityRequired: item.quantityRequired,
            unit: item.unit,
            baseUnit: matchingProduct?.unit ?? 'piece',
            cost: item.ingredientCost,
          };
        }),
      );
    }
  }, [allProducts, recipeQuery.data]);

  if (!product) return null;

  const availableIngredients = allProducts.filter(
    (p) =>
      p.id !== product.id &&
      (p.inventoryRole === 'ingredient' || p.inventoryRole === 'both') &&
      !items.some((existing) => existing.ingredientProductId === p.id),
  );

  const selectedIngredient = allProducts.find((p) => p.id === selectedIngredientId);
  const unitOptions = compatibleRecipeUnits(selectedIngredient?.unit);

  const addItem = () => {
    if (!selectedIngredient) return;
    const qty = Number(quantityInput);
    if (!Number.isFinite(qty) || qty <= 0) return;

    setItems((prev) => [
      ...prev,
      {
        ingredientProductId: selectedIngredient.id,
        ingredientName: selectedIngredient.name,
        quantityRequired: qty,
        unit: unitInput,
        baseUnit: selectedIngredient.unit ?? 'piece',
        cost: selectedIngredient.averageCost || selectedIngredient.cost,
      },
    ]);
    setSelectedIngredientId('');
    setQuantityInput('1');
    setSearchQuery('');
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.ingredientProductId !== id));
  };

  const saveMutation = useMutation({
    mutationFn: async (updatedItems: RecipeItemRow[]) => {
      await api(`/products/${product.id}/recipe`, {
        method: 'PUT',
        body: JSON.stringify({
          items: updatedItems.map((i) => ({
            ingredientProductId: i.ingredientProductId,
            quantityRequired: i.quantityRequired,
            unit: i.unit,
          })),
        }),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      await queryClient.invalidateQueries({ queryKey: ['product-recipe', product.id] });
      Alert.alert('Recipe Saved', `BOM recipe template for ${product.name} updated.`);
      onClose();
    },
    onError: (err) => {
      Alert.alert('Error Saving Recipe', err.message);
    },
  });

  const totalRecipeCost = items.reduce((sum, item) => {
    const costPerBase = Number(item.cost) || 0;
    const baseQty = convertRecipeQuantity(item.quantityRequired, item.unit, item.baseUnit);
    return sum + costPerBase * baseQty;
  }, 0);

  const filteredAvailable = availableIngredients.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase().trim()),
  );

  return (
    <Modal visible={Boolean(product)} animationType="fade" transparent>
      <View className="flex-1 items-center justify-center bg-black/70 p-4 sm:p-6">
        <View className="w-full max-w-lg max-h-[85%] rounded-3xl bg-slate-900 p-6 border border-slate-800 shadow-2xl">
          <View className="flex-row items-center justify-between border-b border-slate-800 pb-4 mb-4">
            <View className="flex-row items-center">
              <View className="h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 mr-3">
                <Feather name="coffee" size={20} color="#10B981" />
              </View>
              <View>
                <Text className="text-lg font-bold text-white">Recipe & BOM Template</Text>
                <Text className="text-xs text-slate-400">
                  {product.name} ({formatMoney(product.sellingPrice)})
                </Text>
              </View>
            </View>
            <Pressable onPress={onClose} className="h-8 w-8 items-center justify-center rounded-full bg-slate-800">
              <Feather name="x" size={18} color="#94A3B8" />
            </Pressable>
          </View>

          <ScrollView className="mb-4">
            <Text className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Add Raw Ingredient
            </Text>
            <View className="mb-4 rounded-2xl bg-slate-800/80 p-4 border border-slate-700">
              <Text className="text-xs font-medium text-slate-300 mb-2">Select Ingredient Product</Text>
              {availableIngredients.length > 3 ? (
                <View className="mb-3 flex-row items-center rounded-xl bg-slate-900 px-3 h-9 border border-slate-700">
                  <Feather name="search" size={13} color="#94A3B8" />
                  <TextInput
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder="Filter ingredients..."
                    placeholderTextColor="#64748B"
                    className="ml-2 flex-1 text-xs text-white"
                  />
                  {searchQuery ? (
                    <Pressable onPress={() => setSearchQuery('')}>
                      <Feather name="x" size={13} color="#94A3B8" />
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3">
                <View className="flex-row gap-2">
                  {filteredAvailable.map((ing) => {
                    const selected = selectedIngredientId === ing.id;
                    return (
                      <Pressable
                        key={ing.id}
                        onPress={() => {
                          setSelectedIngredientId(ing.id);
                          setUnitInput(compatibleRecipeUnits(ing.unit)[0]!.code);
                        }}
                        className={`px-3 py-2 rounded-xl border ${
                          selected
                            ? 'bg-emerald-500/20 border-emerald-500'
                            : 'bg-slate-800 border-slate-700'
                        }`}
                      >
                        <Text className={`text-xs font-medium ${selected ? 'text-emerald-400' : 'text-slate-300'}`}>
                          {ing.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>

              <View className="mb-3">
                <Text className="text-xs font-medium text-slate-300 mb-1">Select Unit</Text>
                <View className="flex-row flex-wrap gap-1.5">
                  {unitOptions.map((u) => {
                    const selected = unitInput === u.code;
                    return (
                      <Pressable
                        key={u.code}
                        disabled={!selectedIngredient}
                        onPress={() => setUnitInput(u.code)}
                        className={`rounded-lg border px-2.5 py-1.5 ${
                          selected
                            ? 'bg-emerald-500/20 border-emerald-500'
                            : 'bg-slate-800 border-slate-700'
                        } ${!selectedIngredient ? 'opacity-40' : ''}`}
                      >
                        <Text className={`text-xs font-medium ${selected ? 'text-emerald-400' : 'text-slate-300'}`}>
                          {u.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View className="flex-row gap-3 items-center">
                <View className="flex-1">
                  <Text className="text-xs font-medium text-slate-300 mb-1">Quantity Required</Text>
                  <TextInput
                    value={quantityInput}
                    onChangeText={setQuantityInput}
                    keyboardType="decimal-pad"
                    placeholder="e.g. 150"
                    placeholderTextColor="#64748B"
                    className="h-10 rounded-xl bg-slate-900 border border-slate-700 px-3 text-xs text-white"
                  />
                </View>
                <Pressable
                  onPress={addItem}
                  disabled={!selectedIngredient}
                  className={`mt-4 h-10 px-4 rounded-xl bg-emerald-600 items-center justify-center ${
                    !selectedIngredient ? 'opacity-40' : ''
                  }`}
                >
                  <Text className="text-xs font-semibold text-white">Add Item</Text>
                </Pressable>
              </View>
            </View>

            <Text className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Recipe Ingredients ({items.length})
            </Text>

            {items.length === 0 ? (
              <View className="rounded-2xl border border-dashed border-slate-800 p-6 items-center">
                <Text className="text-xs text-slate-500">No ingredients added to this recipe yet.</Text>
              </View>
            ) : (
              <View className="gap-2">
                {items.map((item) => (
                  <View
                    key={item.ingredientProductId}
                    className="flex-row items-center justify-between rounded-xl bg-slate-800/50 p-3 border border-slate-800"
                  >
                    <View className="flex-1">
                      <Text className="text-xs font-medium text-white">{item.ingredientName}</Text>
                      <Text className="text-[11px] text-slate-400">
                        {item.quantityRequired} {item.unit}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => removeItem(item.ingredientProductId)}
                      className="h-7 w-7 items-center justify-center rounded-lg bg-red-500/10"
                    >
                      <Feather name="trash-2" size={14} color="#EF4444" />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

            {items.length > 0 ? (
              <View className="mt-4 flex-row items-center justify-between rounded-2xl bg-emerald-950/40 p-4 border border-emerald-800/40">
                <Text className="text-xs font-semibold text-emerald-300">Estimated Ingredient Cost</Text>
                <Text className="text-sm font-bold text-emerald-400">{formatMoney(totalRecipeCost.toFixed(2))}</Text>
              </View>
            ) : null}
          </ScrollView>

          <View className="flex-row gap-3 pt-2">
            <Pressable
              onPress={onClose}
              className="flex-1 h-12 rounded-xl border border-slate-700 bg-slate-800 items-center justify-center"
            >
              <Text className="text-sm font-semibold text-slate-300">Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => saveMutation.mutate(items)}
              disabled={saveMutation.isPending}
              className="flex-1 h-12 rounded-xl bg-emerald-600 items-center justify-center"
            >
              <Text className="text-sm font-semibold text-white">
                {saveMutation.isPending ? 'Saving...' : 'Save Recipe (BOM)'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ProductsContent() {
  const [search, setSearch] = useState('');
  const [productFilter, setProductFilter] = useState<ProductFilter>('all');
  const [editingRecipeProduct, setEditingRecipeProduct] = useState<Product | null>(null);
  const { currentUser } = useSession();
  const branch = useBranchStore((state) => state.activeBranch);
  const queryClient = useQueryClient();

  const businessProfile =
    currentUser?.organization?.businessProfile ?? (currentUser as any)?.businessProfile ?? 'retail';
  const isFoodService =
    businessProfile === 'food_service' ||
    businessProfile === 'hybrid' ||
    (currentUser?.modules ?? []).includes('recipes');

  // Filter out raw/ingredient tabs for pure retail businesses
  const productFilters = useMemo(() => {
    if (!isFoodService) {
      return ALL_PRODUCT_FILTERS.filter((f) => f.id === 'all' || f.id === 'sellable');
    }
    return ALL_PRODUCT_FILTERS;
  }, [isFoodService]);

  const query = useInfiniteQuery({
    queryKey: ['products', branch?.id, search, productFilter],
    initialPageParam: 1,
    enabled: Boolean(branch),
    queryFn: ({ pageParam }) =>
      api<Product[]>(
        `/products?branchId=${branch!.id}&includeInactive=true&page=${pageParam}&pageSize=30${
          productFilter === 'all' ? '' : `&inventoryRole=${productFilter}`
        }${
          search ? `&search=${encodeURIComponent(search)}` : ''
        }`,
      ),
    getNextPageParam: (last, pages) => (last.length === 30 ? pages.length + 1 : undefined),
  });
  const summaryQuery = useQuery({
    queryKey: ['product-summary'],
    queryFn: () =>
      api<{ all: number; sellable: number; ingredient: number; both: number }>(
        '/products/summary',
      ),
  });
  const products = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);
  const productCounts = useMemo(
    () => ({
      all: products.length,
      sellable: products.filter(
        (product) => !product.inventoryRole || product.inventoryRole === 'sellable',
      ).length,
      ingredient: products.filter((product) => product.inventoryRole === 'ingredient').length,
      both: products.filter((product) => product.inventoryRole === 'both').length,
    }),
    [products],
  );
  const displayedProductCounts = summaryQuery.data ?? productCounts;
  const visibleProducts = products;
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: Pick<Product, 'id' | 'status'>) =>
      api(`/products/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['pos-products'] }),
      ]);
    },
    onError: (error) => Alert.alert('Could not update product', error.message),
  });

  return (
    <Screen>
      <Header
        title="Products"
        subtitle="Manage your product catalog"
        action={
          currentUser?.permissions.includes('products:manage') ? (
            <View className="flex-row gap-2">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Manage catalogue"
                className="rounded-xl bg-brand-50 px-3 py-3"
                onPress={() => router.push('/catalogue')}
              >
                <Feather name="folder" size={18} color="#1A593B" />
              </Pressable>
              {currentUser.modules.includes('barcode_scanner') ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Scan new product"
                  className="rounded-xl bg-brand-50 px-3 py-3"
                  onPress={() => router.push('/product-scan')}
                >
                  <Feather name="maximize" size={18} color="#1A593B" />
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add new product"
                className="min-h-11 flex-row items-center rounded-xl bg-brand-700 px-4"
                onPress={() => router.push('/product-form')}
              >
                <Feather name="plus" size={17} color="#FFFFFF" />
                <Text className="ml-2 font-medium text-white">New Product</Text>
              </Pressable>
            </View>
          ) : null
        }
      />
      <View className="border-b border-slate-100 bg-slate-50 p-4">
        <View className="flex-row flex-wrap gap-3">
          {productFilters.map((filter) => {
            const selected = productFilter === filter.id;
            return (
              <Pressable
                key={filter.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setProductFilter(filter.id)}
                className={`min-w-[145px] flex-1 rounded-2xl border p-4 active:opacity-80 ${
                  selected ? 'border-brand-700 bg-brand-700' : 'border-slate-200 bg-white'
                }`}
              >
                <View className="flex-row items-start justify-between">
                  <View
                    className={`h-10 w-10 items-center justify-center rounded-xl ${
                      selected ? 'bg-white/15' : 'bg-brand-50'
                    }`}
                  >
                    <Feather name={filter.icon} size={17} color={selected ? '#FFFFFF' : '#1A593B'} />
                  </View>
                  <Text className={`text-xl font-semibold ${selected ? 'text-white' : 'text-slate-950'}`}>
                    {displayedProductCounts[filter.id]}
                  </Text>
                </View>
                <Text className={`mt-3 text-sm font-semibold ${selected ? 'text-white' : 'text-slate-900'}`}>
                  {filter.title}
                </Text>
                <Text className={`mt-1 text-xs ${selected ? 'text-brand-100' : 'text-slate-500'}`}>
                  {filter.description}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View className="bg-white p-4">
        <View className="flex-row items-center rounded-xl bg-slate-100 px-4 border border-slate-200 focus-within:border-brand-600 focus-within:ring-2 focus-within:ring-brand-200">
          <Feather name="search" size={18} color="#81776E" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search products by name or SKU"
            placeholderTextColor="#81776E"
            selectionColor="#1A593B"
            style={{ outline: 'none' }}
            onSubmitEditing={(e: any) => {
              if (e && e.preventDefault) e.preventDefault();
            }}
            className="ml-2 flex-1 min-h-14 bg-transparent text-sm text-slate-900"
          />
          {search ? (
            <Pressable onPress={() => setSearch('')}>
              <Feather name="x" size={16} color="#81776E" />
            </Pressable>
          ) : null}
        </View>
      </View>
      {query.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState message={query.error.message} retry={() => void query.refetch()} />
      ) : (
        <FlatList
          data={visibleProducts}
          keyExtractor={(item) => item.id}
          contentContainerClassName="p-4 gap-2"
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center py-20">
              <Feather name={search ? 'search' : 'box'} size={42} color="#C7C0B8" />
              <Text className="mt-4 text-base font-bold text-slate-800">
                {search
                  ? `No products matching "${search}"`
                  : productFilter === 'all'
                    ? 'No products yet.'
                    : 'No products in this group.'}
              </Text>
              <Text className="mt-2 text-center text-sm text-slate-500 max-w-xs">
                {search
                  ? 'Try searching for another product name or SKU, or clear your query.'
                  : 'Add something you sell, such as a snack, drink, card pack, or bulk item.'}
              </Text>
              {search ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  onPress={() => setSearch('')}
                  className="mt-5 min-h-11 flex-row items-center justify-center rounded-xl bg-slate-200 px-5 active:bg-slate-300"
                >
                  <Feather name="x" size={16} color="#334155" />
                  <Text className="ml-2 font-semibold text-slate-800">Clear search</Text>
                </Pressable>
              ) : currentUser?.permissions.includes('products:manage') ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add First Product"
                  onPress={() => router.push('/product-form')}
                  className="mt-5 min-h-11 flex-row items-center justify-center rounded-xl bg-brand-700 px-5 active:bg-brand-800"
                >
                  <Feather name="plus" size={16} color="#FFFFFF" />
                  <Text className="ml-2 font-semibold text-white">Add First Product</Text>
                </Pressable>
              ) : null}
            </View>
          }
          renderItem={({ item }) => {
            const retailBadges = getRetailProductTypeBadges(item);
            const stockInfo = getStockStatus(item.availableQuantity);
            const legacyCheck = hasLegacyInvalidConversion(item);
            return (
              <View
                className={`mb-3 rounded-2xl border bg-white p-4 shadow-xs md:p-5 ${
                  item.status === 'active' ? 'border-slate-200' : 'border-slate-300 opacity-75'
                }`}
              >
                {/* Header Row */}
                <View className="flex-row flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <View className="flex-row flex-wrap items-center gap-2">
                    <Text className="text-base font-bold text-slate-900">{item.name}</Text>
                    <View className="rounded-md bg-slate-100 px-2 py-0.5">
                      <Text className="text-[11px] font-mono font-medium text-slate-600">
                        {item.sku}
                      </Text>
                    </View>
                    <View className="rounded-md bg-brand-50 px-2 py-0.5">
                      <Text className="text-[11px] font-semibold text-brand-800">
                        {item.categoryName ?? 'Uncategorized'}
                        {item.brandName ? ` · ${item.brandName}` : ''}
                      </Text>
                    </View>
                  </View>

                  <View className="flex-row items-center gap-2">
                    <Text className="text-lg font-extrabold text-brand-700">
                      {formatCatalogUnitPrice(item.sellingPrice, item.unit)}
                    </Text>
                    {item.status === 'active' ? (
                      <View className="rounded-full bg-emerald-50 px-2.5 py-1">
                        <Text className="text-xs font-semibold text-emerald-700">Enabled</Text>
                      </View>
                    ) : (
                      <View className="rounded-full bg-slate-100 px-2.5 py-1">
                        <Text className="text-xs font-semibold text-slate-600">Disabled</Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* Badges Bar */}
                {retailBadges.length || legacyCheck.isInvalid ? (
                  <View className="mt-3 flex-row flex-wrap items-center gap-1.5">
                    {retailBadges.map((badge) => (
                      <View
                        key={badge.key}
                        className="rounded-lg border border-brand-200 bg-brand-50/80 px-2.5 py-1"
                      >
                        <Text className="text-xs font-semibold text-brand-800">
                          {badge.label}
                        </Text>
                      </View>
                    ))}
                    {legacyCheck.isInvalid ? (
                      <View className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1">
                        <Text className="text-xs font-semibold text-amber-800">
                          {legacyCheck.warning}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}

                {/* Spec Metrics Row */}
                <View className="mt-3 flex-row flex-wrap items-center gap-3">
                  <View className="flex-row items-center rounded-xl bg-slate-50 px-3 py-1.5">
                    <Feather name="box" size={13} color="#64748B" />
                    <Text className="ml-1.5 text-xs text-slate-600">
                      {(item.unit ?? 'piece').toUpperCase()} · {stockInfo.label}
                    </Text>
                  </View>
                  <View className="flex-row items-center rounded-xl bg-slate-50 px-3 py-1.5">
                    <Feather name="dollar-sign" size={13} color="#64748B" />
                    <Text className="ml-1.5 text-xs text-slate-600">
                      Avg cost {formatMoney(item.averageCost)}
                    </Text>
                  </View>
                  <View
                    className={`flex-row items-center rounded-xl px-3 py-1.5 ${
                      item.isLowMargin ? 'bg-red-50' : 'bg-brand-50'
                    }`}
                  >
                    <Feather
                      name={item.isLowMargin ? 'alert-circle' : 'pie-chart'}
                      size={13}
                      color={item.isLowMargin ? '#B91C1C' : '#1A593B'}
                    />
                    <Text
                      className={`ml-1.5 text-xs font-medium ${
                        item.isLowMargin ? 'text-red-700' : 'text-brand-800'
                      }`}
                    >
                      Margin {item.grossMarginPercent ?? '0.00'}%
                    </Text>
                  </View>
                </View>

                {/* Actions Footer */}
                {currentUser?.permissions.includes('products:manage') ? (
                  <View className="mt-4 flex-row flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                    <View className="flex-row flex-wrap items-center gap-2">
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Edit ${item.name}`}
                        onPress={() =>
                          router.push({
                            pathname: '/product-form',
                            params: { id: item.id },
                          })
                        }
                        className="min-h-9 flex-row items-center justify-center rounded-xl bg-brand-700 px-4 active:bg-brand-800"
                      >
                        <Feather name="edit-2" size={13} color="#FFFFFF" />
                        <Text className="ml-1.5 text-xs font-semibold text-white">Edit</Text>
                      </Pressable>

                      <Pressable
                        accessibilityRole="button"
                        onPress={() =>
                          router.push({
                            pathname: '/product-variants',
                            params: {
                              productId: item.id,
                              name: item.name,
                              baseUnit: item.unit ?? 'piece',
                            },
                          })
                        }
                        className="min-h-9 flex-row items-center justify-center rounded-xl bg-slate-100 px-3 active:bg-slate-200"
                      >
                        <Feather name="copy" size={13} color="#334155" />
                        <Text className="ml-1.5 text-xs font-semibold text-slate-700">Units</Text>
                      </Pressable>

                      {isFoodService && item.inventoryRole !== 'ingredient' ? (
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => setEditingRecipeProduct(item)}
                          className="min-h-9 flex-row items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 px-3 active:bg-emerald-100"
                        >
                          <Feather name="coffee" size={13} color="#059669" />
                          <Text className="ml-1.5 text-xs font-semibold text-emerald-700">
                            Recipe (BOM)
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>

                    <View className="flex-row items-center gap-2">
                      {item.isLowMargin ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Review suggested price for ${item.name}`}
                          onPress={() =>
                            router.push({
                              pathname: '/product-form',
                              params: {
                                id: item.id,
                                suggestedPrice: item.suggestedSellingPrice,
                                targetMargin: item.targetMarginPercent,
                              },
                            })
                          }
                          className="min-h-9 flex-row items-center justify-center rounded-xl bg-amber-50 px-3 active:bg-amber-100"
                        >
                          <Feather name="trending-up" size={13} color="#B45309" />
                          <Text className="ml-1.5 text-xs font-semibold text-amber-800">
                            Review {formatMoney(item.suggestedSellingPrice)}
                          </Text>
                        </Pressable>
                      ) : null}

                      <Pressable
                        accessibilityRole="switch"
                        accessibilityState={{ checked: item.status === 'active' }}
                        disabled={statusMutation.isPending}
                        onPress={() =>
                          statusMutation.mutate({
                            id: item.id,
                            status: item.status === 'active' ? 'inactive' : 'active',
                          })
                        }
                        className={`min-h-9 flex-row items-center justify-center rounded-xl px-3 ${
                          item.status === 'active' ? 'bg-slate-100' : 'bg-brand-50'
                        }`}
                      >
                        <Text
                          className={`text-xs font-semibold ${
                            item.status === 'active' ? 'text-slate-700' : 'text-brand-800'
                          }`}
                        >
                          {item.status === 'active' ? 'Disable' : 'Enable'}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
              </View>
            );
          }}
        />
      )}

      {isFoodService ? (
        <RecipeModal
          product={editingRecipeProduct}
          onClose={() => setEditingRecipeProduct(null)}
          allProducts={products}
        />
      ) : null}
    </Screen>
  );
}

export default function ProductsScreen() {
  return (
    <AppSidebarProvider>
      <ProductsContent />
    </AppSidebarProvider>
  );
}
