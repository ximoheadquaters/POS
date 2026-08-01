import { useEffect, useMemo, useState } from 'react';
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

interface Product {
  id: string;
  name: string;
  sku: string;
  unit?: string;
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
  sellingUnits?: Array<{ variantId: string; name: string; unit: string; unitsPerBase: number }>;
  categoryName?: string;
  brandName?: string;
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
        recipeQuery.data.map((r: any) => ({
          ingredientProductId: r.ingredientProductId,
          ingredientName: r.ingredientName,
          quantityRequired: r.quantityRequired,
          unit: r.unit,
          baseUnit: r.baseUnit || r.unit,
          cost: r.ingredientCost || '0.00',
        })),
      );
    }
  }, [recipeQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (recipeItems: RecipeItemRow[]) => {
      await api(`/products/${product!.id}/recipe`, {
        method: 'PUT',
        body: JSON.stringify({
          items: recipeItems.map((item) => ({
            ingredientProductId: item.ingredientProductId,
            quantityRequired: item.quantityRequired,
            unit: item.unit,
          })),
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-recipe', product?.id] });
      Alert.alert('Recipe Saved', `Bill of Materials template for ${product?.name} has been updated.`);
      onClose();
    },
    onError: (err: any) => {
      Alert.alert('Error', err?.message || 'Failed to save recipe');
    },
  });

  if (!product) return null;

  const availableIngredients = allProducts.filter((p) => p.id !== product.id);

  const totalIngredientCost = items.reduce((sum, item) => {
    const effQty = convertRecipeQuantity(item.quantityRequired, item.unit, item.baseUnit);
    return sum + parseFloat(item.cost || '0') * effQty;
  }, 0);

  const handleAddIngredient = () => {
    if (!selectedIngredientId) return;
    const ing = availableIngredients.find((p) => p.id === selectedIngredientId);
    if (!ing) return;

    const qty = parseFloat(quantityInput) || 1;
    const selUnit = unitInput || ing.unit || 'piece';
    setItems((prev) => [
      ...prev.filter((i) => i.ingredientProductId !== ing.id),
      {
        ingredientProductId: ing.id,
        ingredientName: ing.name,
        quantityRequired: qty,
        unit: selUnit,
        baseUnit: ing.unit || 'piece',
        cost: ing.cost || '0.00',
      },
    ]);
    setSelectedIngredientId('');
    setQuantityInput('1');
  };

  const handleRemoveIngredient = (id: string) => {
    setItems((prev) => prev.filter((i) => i.ingredientProductId !== id));
  };

  const [searchQuery, setSearchQuery] = useState('');
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
                          setUnitInput(ing.unit || 'piece');
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
                  {[
                    { code: 'piece', label: 'Piece (pc)' },
                    { code: 'g', label: 'Grams (g)' },
                    { code: 'kg', label: 'Kg (kg)' },
                    { code: 'ml', label: 'Milliliters (ml)' },
                    { code: 'l', label: 'Liters (L)' },
                  ].map((u) => {
                    const selected = unitInput === u.code;
                    return (
                      <Pressable
                        key={u.code}
                        onPress={() => setUnitInput(u.code)}
                        className={`rounded-lg border px-2.5 py-1.5 ${
                          selected
                            ? 'bg-emerald-500/20 border-emerald-500'
                            : 'bg-slate-800 border-slate-700'
                        }`}
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
                  <Text className="text-xs font-medium text-slate-300 mb-1">Qty per Serving</Text>
                  <TextInput
                    value={quantityInput}
                    onChangeText={setQuantityInput}
                    keyboardType="decimal-pad"
                    className="h-10 rounded-xl bg-slate-900 px-3 text-white text-sm border border-slate-700"
                    placeholder="e.g. 0.018 or 1"
                    placeholderTextColor="#64748B"
                  />
                </View>
                <Pressable
                  onPress={handleAddIngredient}
                  disabled={!selectedIngredientId}
                  className={`h-10 px-5 mt-5 rounded-xl items-center justify-center ${
                    selectedIngredientId ? 'bg-emerald-600' : 'bg-slate-700'
                  }`}
                >
                  <Text className="text-xs font-bold text-white">Add</Text>
                </Pressable>
              </View>
            </View>

            <Text className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Ingredient Breakdown ({items.length})
            </Text>

            {items.length === 0 ? (
              <View className="p-6 rounded-2xl bg-slate-800/40 border border-dashed border-slate-700 items-center">
                <Feather name="box" size={24} color="#64748B" />
                <Text className="mt-2 text-xs text-slate-400">No ingredients added yet.</Text>
                <Text className="text-[11px] text-slate-500 text-center mt-1">
                  Select a raw inventory item above to build the recipe template.
                </Text>
              </View>
            ) : (
              <View className="gap-2">
                {items.map((item) => {
                  const effQty = convertRecipeQuantity(item.quantityRequired, item.unit, item.baseUnit);
                  const lineEstCost = (parseFloat(item.cost || '0') * effQty).toFixed(2);
                  return (
                    <View
                      key={item.ingredientProductId}
                      className="flex-row items-center justify-between p-3 rounded-xl bg-slate-800 border border-slate-700"
                    >
                      <View className="flex-1 pr-2">
                        <Text className="text-sm font-semibold text-white">{item.ingredientName}</Text>
                        <Text className="text-xs text-emerald-400">
                          {item.quantityRequired} {item.unit} per serving (Est.{' '}
                          {formatMoney(lineEstCost)})
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => handleRemoveIngredient(item.ingredientProductId)}
                        className="h-8 w-8 items-center justify-center rounded-lg bg-rose-500/10 border border-rose-500/20"
                      >
                        <Feather name="trash-2" size={14} color="#F43F5E" />
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}

            <View className="mt-4 p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 flex-row justify-between items-center">
              <View>
                <Text className="text-xs text-emerald-300 font-medium">Est. Raw Material Cost</Text>
                <Text className="text-lg font-bold text-emerald-400">
                  {formatMoney(totalIngredientCost.toFixed(2))}
                </Text>
              </View>
              <View className="items-end">
                <Text className="text-xs text-slate-400 font-medium">Selling Price</Text>
                <Text className="text-sm font-semibold text-white">{formatMoney(product.sellingPrice)}</Text>
              </View>
            </View>
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
  const [editingRecipeProduct, setEditingRecipeProduct] = useState<Product | null>(null);
  const { currentUser } = useSession();
  const branch = useBranchStore((state) => state.activeBranch);
  const queryClient = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: ['products', branch?.id, search],
    initialPageParam: 1,
    enabled: Boolean(branch),
    queryFn: ({ pageParam }) =>
      api<Product[]>(
        `/products?branchId=${branch!.id}&includeInactive=true&page=${pageParam}&pageSize=30${
          search ? `&search=${encodeURIComponent(search)}` : ''
        }`,
      ),
    getNextPageParam: (last, pages) => (last.length === 30 ? pages.length + 1 : undefined),
  });
  const products = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);
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
      {products.length ? (
        <View className="bg-white p-4">
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search products by name or SKU"
            placeholderTextColor="#81776E"
            selectionColor="#1A593B"
            className="min-h-14 rounded-xl bg-slate-100 px-4"
          />
        </View>
      ) : null}
      {query.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState message={query.error.message} retry={() => void query.refetch()} />
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => item.id}
          contentContainerClassName="p-4 gap-2"
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center py-36">
              <Feather name="box" size={42} color="#C7C0B8" />
              <Text className="mt-4 text-base font-medium text-slate-700">No products yet</Text>
              <Text className="mt-2 text-sm text-slate-400">
                Add your first product to get started
              </Text>
              {currentUser?.permissions.includes('products:manage') ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add first product"
                  onPress={() => router.push('/product-form')}
                  className="mt-5 min-h-10 flex-row items-center px-3"
                >
                  <Feather name="plus" size={15} color="#1A593B" />
                  <Text className="ml-1 font-medium text-brand-700">Add Product</Text>
                </Pressable>
              ) : null}
            </View>
          }
          renderItem={({ item }) => (
            <View
              className={`flex-row items-center rounded-2xl border bg-white p-4 ${
                item.status === 'active' ? 'border-slate-100' : 'border-slate-200 opacity-70'
              }`}
            >
              <View className="flex-1">
                <Text className="font-medium text-slate-900">{item.name}</Text>
                <Text className="mt-1 text-xs text-slate-500">
                  {item.sku} · {(item.unit ?? 'piece').toUpperCase()} ·{' '}
                  {item.categoryName ?? 'Uncategorized'}
                  {item.brandName ? ` · ${item.brandName}` : ''}
                </Text>
                <Text className="mt-1 text-xs text-slate-400">
                  {item.trackInventory ? 'Inventory tracked' : 'Stock not tracked'}
                  {item.sellingUnits?.length
                    ? ` · Also sold by ${item.sellingUnits.map((unit) => unit.unit).join(', ')}`
                    : ''}
                </Text>
                <View className="mt-2 flex-row flex-wrap items-center gap-2">
                  <Text className="text-xs text-slate-500">
                    Average cost {formatMoney(item.averageCost)}
                  </Text>
                  <Text
                    className={`rounded-full px-2 py-1 text-xs font-medium ${
                      item.isLowMargin ? 'bg-red-50 text-red-700' : 'bg-brand-50 text-brand-700'
                    }`}
                  >
                    Margin {item.grossMarginPercent ?? '0.00'}%
                  </Text>
                  {item.isLowMargin ? (
                    <Text className="text-xs text-red-600">
                      Below {item.lowMarginThresholdPercent}% warning level
                    </Text>
                  ) : null}
                </View>
              </View>
              <View className="items-end">
                <Text className="font-semibold text-brand-700">
                  {formatMoney(item.sellingPrice)}
                </Text>
                {currentUser?.permissions.includes('products:manage') ? (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${item.name}`}
                      onPress={() =>
                        router.push({
                          pathname: '/product-form',
                          params: { id: item.id },
                        })
                      }
                      className="mt-2 min-h-8 flex-row items-center justify-center rounded-full bg-brand-700 px-3"
                    >
                      <Feather name="edit-2" size={12} color="#FFFFFF" />
                      <Text className="ml-1 text-xs font-medium text-white">Edit</Text>
                    </Pressable>
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
                        className="mt-2 min-h-8 flex-row items-center justify-center rounded-full bg-amber-50 px-3"
                      >
                        <Feather name="trending-up" size={12} color="#B45309" />
                        <Text className="ml-1 text-xs font-medium text-amber-700">
                          Review {formatMoney(item.suggestedSellingPrice)}
                        </Text>
                      </Pressable>
                    ) : null}
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
                      className="mt-2 min-h-8 flex-row items-center justify-center rounded-full bg-brand-50 px-3"
                    >
                      <Feather name="copy" size={12} color="#1A593B" />
                      <Text className="ml-1 text-xs font-medium text-brand-700">Units</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setEditingRecipeProduct(item)}
                      className="mt-2 min-h-8 flex-row items-center justify-center rounded-full bg-emerald-50 border border-emerald-200 px-3"
                    >
                      <Feather name="coffee" size={12} color="#059669" />
                      <Text className="ml-1 text-xs font-medium text-emerald-700">Recipe (BOM)</Text>
                    </Pressable>
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
                      className={`mt-2 min-h-8 justify-center rounded-full px-3 ${
                        item.status === 'active' ? 'bg-brand-50' : 'bg-slate-100'
                      }`}
                    >
                      <Text
                        className={`text-xs font-medium ${
                          item.status === 'active' ? 'text-brand-700' : 'text-slate-600'
                        }`}
                      >
                        {item.status === 'active' ? 'Enabled' : 'Disabled'}
                      </Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
            </View>
          )}
        />
      )}

      <RecipeModal
        product={editingRecipeProduct}
        onClose={() => setEditingRecipeProduct(null)}
        allProducts={products}
      />
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
