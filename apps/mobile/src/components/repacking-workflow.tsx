import Feather from '@expo/vector-icons/Feather';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { convertRecipeQuantity } from '@ximo/shared';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { Button, ErrorState, Field, Header, LoadingState, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { liveDataQueryOptions } from '@/lib/live-data';
import { useBranchStore } from '@/store/branch';
import { useSession } from '@/providers/session';
import { useIosAlert } from '@/providers/ios-alert';
import { getRetailLabel } from '@/lib/retail-terminology';

export interface RepackingIngredient {
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

export interface RepackingProduct {
  id: string;
  name: string;
  sku: string;
  unit: string;
  unitKind: 'discrete' | 'decimal';
  quantity: number;
  ingredients: RepackingIngredient[];
}

export interface PreviewRequirement {
  productId: string;
  name: string;
  requiredQuantity: number;
  unit: string;
  availableQuantity: number;
  sufficient: boolean;
  estimatedCost: string;
}

export interface PreviewResponse {
  productId: string;
  productName: string;
  quantity: number;
  requirements: PreviewRequirement[];
  estimatedTotalCost: string;
  estimatedUnitCost: string;
  canProduce: boolean;
}

export interface RepackingWorkflowProps {
  isRetailProfile?: boolean;
}

export function RepackingWorkflow({ isRetailProfile = true }: RepackingWorkflowProps) {
  const branch = useBranchStore((state) => state.activeBranch);
  const { currentUser } = useSession();
  const { showAlert } = useIosAlert();
  const profile =
    currentUser?.organization?.businessProfile ?? (currentUser as any)?.businessProfile ?? 'retail';
  const isRetail = isRetailProfile && profile === 'retail';
  const queryClient = useQueryClient();

  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [outputQuantity, setOutputQuantity] = useState('10');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [lastSubmittedBatch, setLastSubmittedBatch] = useState<any | null>(null);

  const productsQuery = useQuery({
    queryKey: ['production-products', branch?.id],
    enabled: Boolean(branch?.id),
    queryFn: () => api<RepackingProduct[]>(`/inventory/production-products?branchId=${branch!.id}`),
    ...liveDataQueryOptions,
  });

  const productsList = productsQuery.data ?? [];
  const selectedProduct = useMemo(
    () => productsList.find((p) => p.id === selectedProductId) ?? null,
    [productsList, selectedProductId],
  );

  const numOutputQuantity = Number(outputQuantity);
  const validOutputQuantity = Number.isFinite(numOutputQuantity) && numOutputQuantity > 0;

  // Server-authoritative preview query
  const previewQuery = useQuery({
    queryKey: ['production-preview', branch?.id, selectedProductId, numOutputQuantity],
    enabled: Boolean(branch?.id && selectedProductId && validOutputQuantity),
    queryFn: () =>
      api<PreviewResponse>('/inventory/production/preview', {
        method: 'POST',
        body: JSON.stringify({
          branchId: branch!.id,
          productId: selectedProductId,
          quantity: numOutputQuantity,
        }),
      }),
  });

  const recordMutation = useMutation({
    mutationFn: async () => {
      if (!branch || !selectedProduct || !validOutputQuantity) {
        throw new Error('Complete repacking details first');
      }
      return api<any>('/inventory/production', {
        method: 'POST',
        body: JSON.stringify({
          branchId: branch.id,
          productId: selectedProduct.id,
          quantityProduced: numOutputQuantity,
          recordedAt: new Date().toISOString(),
        }),
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['production-products', branch?.id] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setLastSubmittedBatch(data);
      setShowConfirmModal(false);
      showAlert({
        title: 'Repacking Completed',
        message: `Successfully repacked ${data.quantityProduced} ${data.unit} of ${data.productName}.`,
        type: 'success',
      });
    },
    onError: (err: any) => {
      setShowConfirmModal(false);
      showAlert({
        title: 'Repacking Failed',
        message: err?.message || 'Failed to record repacking batch',
        type: 'error',
      });
    },
  });

  if (!branch) {
    return (
      <Screen>
        <Header title={isRetail ? 'Retail Repacking' : 'Production'} showBack />
        <ErrorState message="Select an active branch to perform repacking." retry={() => {}} />
      </Screen>
    );
  }

  if (productsQuery.isLoading) {
    return (
      <Screen>
        <Header title={isRetail ? 'Retail Repacking' : 'Production'} showBack />
        <LoadingState label="Loading available repacking products…" />
      </Screen>
    );
  }

  if (productsQuery.isError) {
    return (
      <Screen>
        <Header title={isRetail ? 'Retail Repacking' : 'Production'} showBack />
        <ErrorState
          message={(productsQuery.error as Error).message}
          retry={() => productsQuery.refetch()}
        />
      </Screen>
    );
  }

  const preview = previewQuery.data;

  return (
    <AppSidebarProvider>
      <Screen>
        <Header
          title={isRetail ? 'Retail Repacking' : 'Production & Repacking'}
          subtitle={
            isRetail
              ? 'Portion bulk goods into retail finished packs'
              : 'Produce finished stock from recipe ingredients'
          }
          showBack
          backLabel="Back"
        />

        <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 130 }}>
          {lastSubmittedBatch ? (
            <View className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <View className="flex-row items-center gap-3">
                <View className="h-10 w-10 items-center justify-center rounded-xl bg-emerald-600">
                  <Feather name="check" size={20} color="#FFFFFF" />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-bold text-emerald-950">
                    Repacking Batch Recorded
                  </Text>
                  <Text className="mt-0.5 text-xs text-emerald-700">
                    Batch #{lastSubmittedBatch.batchNumber} • {lastSubmittedBatch.quantityProduced}{' '}
                    {lastSubmittedBatch.unit} of {lastSubmittedBatch.productName}
                  </Text>
                </View>
              </View>
              <View className="mt-3 flex-row justify-between border-t border-emerald-200/60 pt-2.5">
                <Text className="text-xs font-medium text-emerald-800">
                  Total Cost:{' '}
                  <Text className="font-bold">{formatMoney(lastSubmittedBatch.totalCost)}</Text>
                </Text>
                <Text className="text-xs font-medium text-emerald-800">
                  Unit Cost:{' '}
                  <Text className="font-bold">{formatMoney(lastSubmittedBatch.unitCost)}</Text> /
                  pack
                </Text>
              </View>
              <Button
                title="Repack Another Item"
                variant="secondary"
                className="mt-3"
                onPress={() => {
                  setLastSubmittedBatch(null);
                  setSelectedProductId(null);
                  setOutputQuantity('10');
                }}
              />
            </View>
          ) : null}

          {/* Step 1: Select Finished Product */}
          <View className="rounded-2xl border border-slate-200 bg-white p-4 gap-3">
            <View className="flex-row flex-wrap items-center justify-between gap-2">
              <View className="min-w-0 flex-1 flex-row items-center gap-2">
                <View className="h-6 w-6 items-center justify-center rounded-full bg-brand-700">
                  <Text className="text-xs font-bold text-white">1</Text>
                </View>
                <Text numberOfLines={2} className="flex-1 text-sm font-bold text-slate-900">
                  Select Finished Product
                </Text>
              </View>
              <Text className="text-xs text-slate-500">
                {productsList.length} recipe item{productsList.length === 1 ? '' : 's'}
              </Text>
            </View>

            <View className="gap-2">
              {productsList.length === 0 ? (
                <View className="items-center justify-center py-6">
                  <Feather name="package" size={28} color="#94A3B8" />
                  <Text className="mt-2 text-center text-xs font-medium text-slate-500">
                    No repacking recipe products found in this branch.
                  </Text>
                </View>
              ) : (
                productsList.map((prod) => {
                  const selected = prod.id === selectedProductId;
                  return (
                    <Pressable
                      key={prod.id}
                      onPress={() => {
                        setSelectedProductId(prod.id);
                        setLastSubmittedBatch(null);
                      }}
                      className={`flex-row items-center justify-between rounded-xl border p-3.5 ${
                        selected
                          ? 'border-brand-600 bg-brand-50'
                          : 'border-slate-200 bg-white active:bg-slate-50'
                      }`}
                    >
                      <View className="flex-1 pr-3">
                        <Text
                          className={`text-sm font-bold ${
                            selected ? 'text-brand-900' : 'text-slate-900'
                          }`}
                        >
                          {prod.name}
                        </Text>
                        <View className="mt-1 flex-row flex-wrap items-center gap-2">
                          <Text className="text-xs text-slate-500">SKU: {prod.sku}</Text>
                          <Text className="text-xs text-slate-300">•</Text>
                          <View className="rounded-md bg-slate-100 px-1.5 py-0.5">
                            <Text className="text-[11px] font-semibold text-slate-600">
                              Stock: {prod.quantity} {prod.unit}s
                            </Text>
                          </View>
                        </View>
                      </View>
                      <View
                        className={`h-5 w-5 items-center justify-center rounded-full border ${
                          selected ? 'border-brand-700 bg-brand-700' : 'border-slate-300 bg-white'
                        }`}
                      >
                        {selected ? <Feather name="check" size={12} color="#FFFFFF" /> : null}
                      </View>
                    </Pressable>
                  );
                })
              )}
            </View>
          </View>

          {/* Step 2: Output Quantity & Recipe Requirements */}
          {selectedProduct ? (
            <View className="rounded-2xl border border-slate-200 bg-white p-4 gap-4">
              <View className="flex-row flex-wrap items-center justify-between gap-2">
                <View className="min-w-0 flex-1 flex-row items-center gap-2">
                  <View className="h-6 w-6 items-center justify-center rounded-full bg-brand-700">
                    <Text className="text-xs font-bold text-white">2</Text>
                  </View>
                  <Text numberOfLines={2} className="flex-1 text-sm font-bold text-slate-900">
                    Packs to Produce
                  </Text>
                </View>
                <Text numberOfLines={1} className="max-w-32 text-xs text-slate-500">
                  {selectedProduct.unit}s output
                </Text>
              </View>

              <View className="gap-2">
                <TextInput
                  value={outputQuantity}
                  onChangeText={setOutputQuantity}
                  keyboardType="numeric"
                  placeholder="10"
                  placeholderTextColor="#94A3B8"
                  selectionColor="#1A593B"
                  accessibilityLabel="Packs to produce"
                  className="h-12 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-center text-base font-bold text-slate-900 focus:border-brand-600"
                />
                <View className="flex-row gap-2">
                  {[
                    { label: '-5', change: -5 },
                    { label: '-1', change: -1 },
                    { label: '+1', change: 1 },
                    { label: '+10', change: 10 },
                  ].map((shortcut) => (
                    <Pressable
                      key={shortcut.label}
                      accessibilityRole="button"
                      accessibilityLabel={`${shortcut.change > 0 ? 'Add' : 'Subtract'} ${Math.abs(shortcut.change)} packs`}
                      onPress={() => {
                        const next = Math.max(1, (numOutputQuantity || 1) + shortcut.change);
                        setOutputQuantity(String(next));
                      }}
                      className="h-11 min-w-0 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 active:bg-slate-100"
                    >
                      <Text className="text-sm font-bold text-slate-700">{shortcut.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View className="gap-2 border-t border-slate-100 pt-3">
                <Text className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Required Source Materials
                </Text>

                {selectedProduct.ingredients.map((ing) => {
                  const reqPerUnit = convertRecipeQuantity(
                    ing.quantityRequired,
                    ing.recipeUnit,
                    ing.baseUnit,
                  );
                  const totalReq = reqPerUnit * (validOutputQuantity ? numOutputQuantity : 0);
                  const sufficient = ing.availableQuantity >= totalReq;

                  return (
                    <View
                      key={ing.productId}
                      className={`rounded-xl border p-3 ${
                        sufficient ? 'border-slate-200 bg-slate-50' : 'border-amber-300 bg-amber-50'
                      }`}
                    >
                      <View className="flex-row flex-wrap items-center justify-between gap-2">
                        <Text
                          numberOfLines={2}
                          className="min-w-0 flex-1 text-sm font-bold text-slate-900"
                        >
                          {ing.name}
                        </Text>
                        <View
                          className={`rounded-full px-2 py-0.5 ${
                            sufficient ? 'bg-emerald-100' : 'bg-amber-100'
                          }`}
                        >
                          <Text
                            className={`text-[10px] font-bold ${
                              sufficient ? 'text-emerald-800' : 'text-amber-900'
                            }`}
                          >
                            {sufficient ? '✓ Stock Available' : '⚠ Low Stock'}
                          </Text>
                        </View>
                      </View>
                      <View className="mt-1 flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <Text className="min-w-0 text-xs text-slate-600">
                          Need:{' '}
                          <Text className="font-semibold text-slate-900">
                            {totalReq} {ing.baseUnit}
                          </Text>{' '}
                          ({ing.quantityRequired} {ing.recipeUnit}/pack)
                        </Text>
                        <Text className="text-xs text-slate-500">
                          In Stock: {ing.availableQuantity} {ing.baseUnit}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}

          {/* Step 3: Cost Preview Breakdown */}
          {selectedProduct && validOutputQuantity ? (
            <View className="rounded-2xl border border-slate-200 bg-white p-4 gap-3">
              <View className="flex-row items-center gap-2">
                <View className="h-6 w-6 items-center justify-center rounded-full bg-brand-700">
                  <Text className="text-xs font-bold text-white">3</Text>
                </View>
                <Text className="text-sm font-bold text-slate-900">Cost & Valuation Preview</Text>
              </View>

              {previewQuery.isLoading ? (
                <Text className="py-3 text-center text-xs text-slate-500">
                  Calculating cost preview…
                </Text>
              ) : preview ? (
                <View className="gap-2.5">
                  <View className="flex-row items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
                    <View className="min-w-0 flex-1">
                      <Text className="text-xs text-slate-500">Estimated Total Cost</Text>
                      <Text className="mt-0.5 text-base font-black text-slate-900">
                        {formatMoney(preview.estimatedTotalCost)}
                      </Text>
                    </View>
                    <View className="min-w-0 flex-1 items-end">
                      <Text className="text-xs text-slate-500">Cost per Pack</Text>
                      <Text className="mt-0.5 text-base font-black text-brand-700">
                        {formatMoney(preview.estimatedUnitCost)}
                      </Text>
                    </View>
                  </View>

                  {!preview.canProduce ? (
                    <View className="flex-row items-start gap-2 rounded-xl bg-amber-50 p-3 border border-amber-200">
                      <Feather name="alert-triangle" size={16} color="#B45309" />
                      <Text className="flex-1 text-xs text-amber-900">
                        One or more materials do not have sufficient stock. Recording this batch
                        will reduce inventory into negative unless restocked.
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : (
                <Text className="py-2 text-xs text-amber-800">
                  Could not fetch authoritative server preview. Check input quantity.
                </Text>
              )}
            </View>
          ) : null}
        </ScrollView>

        {/* Sticky Bottom Action Bar */}
        {selectedProduct && (
          <View className="border-t border-slate-200 bg-white px-4 py-3 shadow-lg flex-row items-center gap-3">
            <View className="flex-1">
              <Text className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Ready to Repack
              </Text>
              <Text className="text-sm font-black text-slate-900" numberOfLines={1}>
                {preview
                  ? `${preview.quantity} packs • ${formatMoney(preview.estimatedTotalCost)}`
                  : `${numOutputQuantity || 1} packs of ${selectedProduct.name}`}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={!preview || recordMutation.isPending || !preview.canProduce}
              onPress={() => setShowConfirmModal(true)}
              className={`h-12 flex-row items-center justify-center rounded-xl bg-brand-700 px-5 active:bg-brand-800 ${
                !preview || recordMutation.isPending || !preview.canProduce ? 'opacity-50' : ''
              }`}
            >
              <Feather name="check-circle" size={18} color="#FFFFFF" />
              <Text className="ml-2 text-sm font-bold text-white">
                {recordMutation.isPending ? 'Recording…' : 'Record Batch'}
              </Text>
            </Pressable>
          </View>
        )}

        {/* Confirmation Modal */}
        <Modal visible={showConfirmModal} transparent animationType="fade">
          <View className="flex-1 items-center justify-center bg-black/50 p-4">
            <View className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl gap-4">
              <Text className="text-base font-bold text-slate-900">Confirm Repacking Batch</Text>
              <Text className="text-xs text-slate-600">
                Review the batch details before recording inventory consumption and finished output.
              </Text>

              {selectedProduct && preview ? (
                <View className="gap-2 rounded-xl bg-slate-50 p-3.5 border border-slate-100">
                  <View className="flex-row justify-between">
                    <Text className="text-xs text-slate-500">Product</Text>
                    <Text className="text-xs font-bold text-slate-900">{selectedProduct.name}</Text>
                  </View>
                  <View className="flex-row justify-between">
                    <Text className="text-xs text-slate-500">Output Quantity</Text>
                    <Text className="text-xs font-bold text-brand-800">
                      {numOutputQuantity} {selectedProduct.unit}s
                    </Text>
                  </View>
                  <View className="flex-row justify-between border-t border-slate-200/60 pt-1.5">
                    <Text className="text-xs text-slate-500">Total Cost</Text>
                    <Text className="text-xs font-bold text-slate-900">
                      {formatMoney(preview.estimatedTotalCost)}
                    </Text>
                  </View>
                  <View className="flex-row justify-between">
                    <Text className="text-xs text-slate-500">Unit Cost</Text>
                    <Text className="text-xs font-bold text-slate-900">
                      {formatMoney(preview.estimatedUnitCost)}
                    </Text>
                  </View>
                </View>
              ) : null}

              <View className="flex-row justify-end gap-2.5 pt-1">
                <Button
                  title="Cancel"
                  variant="secondary"
                  onPress={() => setShowConfirmModal(false)}
                />
                <Button
                  title={recordMutation.isPending ? 'Recording…' : 'Confirm & Record'}
                  disabled={recordMutation.isPending}
                  onPress={() => recordMutation.mutate()}
                />
              </View>
            </View>
          </View>
        </Modal>
      </Screen>
    </AppSidebarProvider>
  );
}
