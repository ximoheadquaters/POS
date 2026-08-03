import Feather from '@expo/vector-icons/Feather';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { convertRecipeQuantity } from '@ximo/shared';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { Button, ErrorState, Field, Header, LoadingState, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import { formatMoney } from '@/lib/format';
import { liveDataQueryOptions } from '@/lib/live-data';
import { useBranchStore } from '@/store/branch';

interface ProductionIngredient {
  productId: string;
  name: string;
  quantityRequired: number;
  recipeUnit: string;
  baseUnit: string;
  availableQuantity: number;
  sealedQuantity: number;
  openedQuantity: number;
  containerName?: string | null;
  containerUnit?: string | null;
  unitsPerBase?: number | null;
  portioningEnabled: boolean;
}

interface ProductionProduct {
  id: string;
  name: string;
  sku: string;
  unit: string;
  unitKind: 'discrete' | 'decimal';
  quantity: number;
  ingredients: ProductionIngredient[];
}

interface ProductionResult {
  batchNumber: string;
  productName: string;
  quantityProduced: number;
  unit: string;
  totalCost: string;
  quantityAfter: number;
  ingredients: Array<{
    name: string;
    quantityConsumed: number;
    unit: string;
    containersOpened: number;
  }>;
}

function quantity(value: number): string {
  return new Intl.NumberFormat('en-PH', { maximumFractionDigits: 3 }).format(value);
}

function ProductionContent() {
  const branch = useBranchStore((state) => state.activeBranch);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [outputQuantity, setOutputQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const queryClient = useQueryClient();
  const productsQuery = useQuery({
    queryKey: ['production-products', branch?.id],
    enabled: Boolean(branch),
    queryFn: () =>
      api<ProductionProduct[]>(`/inventory/production-products?branchId=${branch!.id}`),
    ...liveDataQueryOptions,
  });
  const selected = productsQuery.data?.find((product) => product.id === selectedId) ?? null;
  const numericOutput = Number(outputQuantity.replace(',', '.'));
  const validOutput =
    Number.isFinite(numericOutput) &&
    numericOutput > 0 &&
    (selected?.unitKind !== 'discrete' || Number.isInteger(numericOutput));
  const preview = useMemo(() => {
    if (!selected || !validOutput) return [];
    return selected.ingredients.map((ingredient) => {
      const required =
        convertRecipeQuantity(
          ingredient.quantityRequired,
          ingredient.recipeUnit,
          ingredient.baseUnit,
        ) * numericOutput;
      const unitsPerBase = Number(ingredient.unitsPerBase ?? 0);
      const usable = ingredient.portioningEnabled
        ? ingredient.openedQuantity + ingredient.sealedQuantity * unitsPerBase
        : ingredient.availableQuantity;
      const shortage = Math.max(0, required - ingredient.openedQuantity);
      const containersToOpen =
        ingredient.portioningEnabled && unitsPerBase > 0
          ? Math.max(0, Math.ceil((shortage - 0.000_000_1) / unitsPerBase))
          : 0;
      return {
        ...ingredient,
        required,
        usable,
        containersToOpen,
        enough: usable + 0.000_001 >= required,
      };
    });
  }, [numericOutput, selected, validOutput]);
  const canProduce = Boolean(selected && validOutput && preview.every((item) => item.enough));

  const mutation = useMutation({
    mutationFn: () => {
      if (!branch || !selected || !canProduce) throw new Error('Complete the production details');
      return api<ProductionResult>('/inventory/production', {
        method: 'POST',
        body: JSON.stringify({
          branchId: branch.id,
          productId: selected.id,
          quantityProduced: numericOutput,
          notes: notes.trim() || undefined,
        }),
      });
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['inventory', branch?.id] }),
        queryClient.invalidateQueries({ queryKey: ['inventory-summary', branch?.id] }),
        queryClient.invalidateQueries({ queryKey: ['production-products', branch?.id] }),
        queryClient.invalidateQueries({ queryKey: ['pos-products'] }),
      ]);
      const message = `${quantity(result.quantityProduced)} ${result.unit} of ${result.productName} added.\nBatch ${result.batchNumber}\nMaterial cost: ${formatMoney(result.totalCost)}`;
      if (Platform.OS === 'web') {
        Alert.alert('Finished stock added', message);
        router.replace('/(tabs)/inventory');
        return;
      }
      Alert.alert('Finished stock added', message, [
        { text: 'Done', onPress: () => router.replace('/(tabs)/inventory') },
      ]);
    },
    onError: (error) => Alert.alert('Production was not recorded', error.message),
  });

  const confirmProduction = async () => {
    if (!selected) return;
    if (!validOutput) {
      Alert.alert(
        'Enter quantity produced',
        selected.unitKind === 'discrete'
          ? `Enter a whole number of completed ${selected.unit}s.`
          : `Enter a ${selected.unit} quantity greater than zero.`,
      );
      return;
    }
    const shortages = preview.filter((item) => !item.enough);
    if (shortages.length > 0) {
      Alert.alert(
        'Not enough raw material',
        shortages
          .map(
            (item) =>
              `${item.name}: need ${quantity(item.required)} ${item.baseUnit}, available ${quantity(item.usable)} ${item.baseUnit}`,
          )
          .join('\n'),
      );
      return;
    }
    const opened = preview.filter((item) => item.containersToOpen > 0);
    const openingMessage = opened.length
      ? `\n\nXimo will automatically open ${opened
          .map(
            (item) =>
              `${item.containersToOpen} ${item.containerUnit || item.containerName || 'container'} of ${item.name}`,
          )
          .join(', ')}.`
      : '';
    const confirmed = await confirmAction(
      'Record finished production?',
      `Create ${quantity(numericOutput)} ${selected.unit} of ${selected.name}.${openingMessage}`,
      'Record production',
    );
    if (confirmed) mutation.mutate();
  };

  return (
    <Screen>
      <Header
        title="Repack / Production"
        subtitle={branch?.name}
        showBack
        backLabel="Inventory"
        fallbackHref="/(tabs)/inventory"
      />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="p-4 pb-12">
        <View className="w-full max-w-4xl self-center gap-4">
          <View className="rounded-2xl border border-brand-100 bg-brand-50 p-4 sm:flex-row sm:items-center">
            <View className="h-11 w-11 items-center justify-center rounded-xl bg-white">
              <Feather name="repeat" size={19} color="#1A593B" />
            </View>
            <View className="mt-3 flex-1 sm:ml-3 sm:mt-0">
              <Text className="text-sm font-semibold text-brand-950">
                Convert raw ingredients into finished sellable stock
              </Text>
              <Text className="mt-1 text-xs leading-5 text-brand-800">
                The BOM is consumed once here. When a cashier sells the finished pack, only the
                finished pack inventory is deducted.
              </Text>
            </View>
          </View>

          <View className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <View className="border-b border-slate-100 p-4">
              <Text className="text-sm font-semibold text-slate-900">1. Finished product</Text>
              <Text className="mt-1 text-xs text-slate-500">
                Only tracked sellable products with a BOM appear here.
              </Text>
            </View>
            {productsQuery.isLoading ? (
              <View className="h-40">
                <LoadingState label="Loading production products…" />
              </View>
            ) : productsQuery.isError ? (
              <View className="min-h-40">
                <ErrorState
                  message={productsQuery.error.message}
                  retry={() => void productsQuery.refetch()}
                />
              </View>
            ) : productsQuery.data?.length ? (
              <View className="p-3">
                {productsQuery.data.map((product) => {
                  const active = product.id === selectedId;
                  return (
                    <Pressable
                      key={product.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => {
                        setSelectedId(product.id);
                        setOutputQuantity('');
                      }}
                      className={`mb-2 flex-row items-center rounded-xl border p-3 active:opacity-80 ${
                        active ? 'border-brand-600 bg-brand-50' : 'border-slate-200 bg-white'
                      }`}
                    >
                      <View className="h-10 w-10 items-center justify-center rounded-xl bg-white">
                        <Feather name="package" size={17} color="#1A593B" />
                      </View>
                      <View className="ml-3 flex-1">
                        <Text className="text-sm font-semibold text-slate-900">{product.name}</Text>
                        <Text className="mt-0.5 text-xs text-slate-500">
                          {product.sku} · {quantity(product.quantity)} {product.unit} finished stock
                        </Text>
                      </View>
                      {active ? <Feather name="check-circle" size={20} color="#1A593B" /> : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <View className="items-center p-8">
                <Text className="text-sm font-semibold text-slate-800">
                  No production product yet
                </Text>
                <Text className="mt-1 max-w-sm text-center text-xs leading-5 text-slate-500">
                  Add a Repacked product, keep it available for sale, and define its BOM.
                </Text>
                <View className="mt-4">
                  <Button
                    title="Add repacked product"
                    onPress={() => router.push('/product-form')}
                  />
                </View>
              </View>
            )}
          </View>

          {selected ? (
            <>
              <View className="rounded-2xl border border-slate-200 bg-white p-4">
                <Text className="mb-3 text-sm font-semibold text-slate-900">
                  2. Quantity produced
                </Text>
                <Field
                  label={`Number of ${selected.unit}s completed`}
                  value={outputQuantity}
                  onChangeText={setOutputQuantity}
                  keyboardType="decimal-pad"
                  placeholder="Example: 10"
                  error={
                    outputQuantity && !validOutput
                      ? selected.unitKind === 'discrete'
                        ? `Enter a whole number of ${selected.unit}s`
                        : 'Enter a quantity greater than zero'
                      : undefined
                  }
                />
                <Field
                  label="Production note (optional)"
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Example: Morning repacking"
                />
              </View>

              {validOutput ? (
                <View className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <View className="border-b border-slate-100 p-4">
                    <Text className="text-sm font-semibold text-slate-900">
                      3. Ingredient preview
                    </Text>
                    <Text className="mt-1 text-xs text-slate-500">
                      Review exactly what will be consumed before saving.
                    </Text>
                  </View>
                  {preview.map((item, index) => (
                    <View
                      key={item.productId}
                      className={`p-4 ${index ? 'border-t border-slate-100' : ''}`}
                    >
                      <View className="flex-row items-start">
                        <View className="flex-1 pr-3">
                          <Text className="text-sm font-semibold text-slate-900">{item.name}</Text>
                          <Text className="mt-1 text-xs text-slate-500">
                            Need {quantity(item.required)} {item.baseUnit} · Available{' '}
                            {quantity(item.usable)} {item.baseUnit}
                          </Text>
                          {item.containersToOpen > 0 && item.enough ? (
                            <Text className="mt-2 text-xs font-medium text-amber-700">
                              Ximo will open {item.containersToOpen}{' '}
                              {item.containerUnit || item.containerName || 'container'}{' '}
                              automatically; the remainder stays opened.
                            </Text>
                          ) : null}
                        </View>
                        <View
                          className={`rounded-lg px-2.5 py-1.5 ${item.enough ? 'bg-brand-50' : 'bg-red-50'}`}
                        >
                          <Text
                            className={`text-xs font-semibold ${item.enough ? 'text-brand-800' : 'text-red-700'}`}
                          >
                            {item.enough ? 'Ready' : 'Not enough'}
                          </Text>
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}

              <View className="rounded-2xl border border-slate-200 bg-white p-4">
                {!validOutput ? (
                  <Text className="mb-3 text-xs leading-5 text-amber-700">
                    Enter the completed quantity before recording production.
                  </Text>
                ) : !canProduce ? (
                  <Text className="mb-3 text-xs leading-5 text-red-700">
                    Raw material stock is insufficient. Review the items marked “Not enough” above.
                  </Text>
                ) : null}
                <Button
                  title={mutation.isPending ? 'Recording production…' : 'Record production'}
                  disabled={mutation.isPending}
                  onPress={() => void confirmProduction()}
                />
              </View>
            </>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

export default function ProductionScreen() {
  return (
    <AppSidebarProvider>
      <ProductionContent />
    </AppSidebarProvider>
  );
}
