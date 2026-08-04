import Feather from '@expo/vector-icons/Feather';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { convertRecipeQuantity } from '@ximo/shared';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { Button, ErrorState, Field, Header, LoadingState, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { liveDataQueryOptions } from '@/lib/live-data';
import { useBranchStore } from '@/store/branch';
import { useSession } from '@/providers/session';
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
  const profile = currentUser?.organization?.businessProfile ?? (currentUser as any)?.businessProfile ?? 'retail';
  const isRetail = isRetailProfile && profile === 'retail';
  const queryClient = useQueryClient();

  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [outputQuantity, setOutputQuantity] = useState('10');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [lastSubmittedBatch, setLastSubmittedBatch] = useState<any | null>(null);

  const productsQuery = useQuery({
    queryKey: ['production-products', branch?.id],
    enabled: Boolean(branch?.id),
    queryFn: () =>
      api<RepackingProduct[]>(`/inventory/production-products?branchId=${branch!.id}`),
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
    },
    onError: (err: any) => {
      Alert.alert('Repacking Failed', err?.message || 'Failed to record repacking batch');
    },
  });

  if (!branch) {
    return (
      <Screen>
        <Header title={isRetail ? 'Retail Repacking' : 'Production'} showBack />
        <ErrorState
          message="Select an active branch to perform repacking."
          retry={() => {}}
        />
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
              ? 'Portion bulk goods and raw materials into retail-ready finished packs'
              : 'Record finished product output from recipe ingredients'
          }
          showBack
        />

        <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
          {lastSubmittedBatch ? (
            <View className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
              <View className="flex-row items-center gap-3">
                <View className="h-10 w-10 items-center justify-center rounded-full bg-emerald-600">
                  <Feather name="check" size={20} color="#FFFFFF" />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-bold text-emerald-950">
                    Repacking Recorded Successfully
                  </Text>
                  <Text className="mt-1 text-sm text-emerald-700">
                    Batch #{lastSubmittedBatch.batchNumber} • {lastSubmittedBatch.quantityProduced}{' '}
                    {lastSubmittedBatch.unit} of {lastSubmittedBatch.productName}
                  </Text>
                </View>
              </View>
              <View className="mt-4 flex-row justify-between border-t border-emerald-200/60 pt-3">
                <Text className="text-xs text-emerald-800">
                  Total Cost: ₱{formatMoney(lastSubmittedBatch.totalCost)}
                </Text>
                <Text className="text-xs text-emerald-800">
                  Unit Cost: ₱{formatMoney(lastSubmittedBatch.unitCost)} / pack
                </Text>
              </View>
              <Button
                title="Repack Another Item"
                variant="secondary"
                className="mt-4"
                onPress={() => {
                  setLastSubmittedBatch(null);
                  setSelectedProductId(null);
                  setOutputQuantity('10');
                }}
              />
            </View>
          ) : null}

          {/* Step 1: Select Finished Product */}
          <View className="rounded-2xl border border-slate-200 bg-white p-5">
            <Text className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Step 1 — Select Finished Product
            </Text>
            <Text className="mt-1 text-sm text-slate-600">
              Choose the retail product you are repacking into.
            </Text>

            <View className="mt-4 gap-2">
              {productsList.length === 0 ? (
                <Text className="py-4 text-center text-sm text-slate-500">
                  No preproduced repacking products found in this branch. Add a product with
                  repacking recipe in the Product Form.
                </Text>
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
                      className={`flex-row items-center justify-between rounded-xl border p-4 ${
                        selected
                          ? 'border-brand-600 bg-brand-50'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <View className="flex-1">
                        <Text className="font-semibold text-slate-900">{prod.name}</Text>
                        <Text className="mt-1 text-xs text-slate-500">
                          SKU: {prod.sku} • Current Stock: {prod.quantity} {prod.unit}s
                        </Text>
                      </View>
                      <Feather
                        name={selected ? 'check-circle' : 'circle'}
                        size={20}
                        color={selected ? '#1A593B' : '#94A3B8'}
                      />
                    </Pressable>
                  );
                })
              )}
            </View>
          </View>

          {/* Step 2 & 3: Recipe Review & Quantity Output */}
          {selectedProduct ? (
            <View className="rounded-2xl border border-slate-200 bg-white p-5">
              <Text className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Step 2 & 3 — Recipe & Output Quantity
              </Text>

              <View className="mt-4">
                <Text className="text-sm font-medium text-slate-700">Packs to Make</Text>
                <Field
                  label=""
                  value={outputQuantity}
                  onChangeText={setOutputQuantity}
                  keyboardType="numeric"
                  placeholder="e.g. 10"
                />
              </View>

              <Text className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Source Materials Required
              </Text>

              {selectedProduct.ingredients.map((ing) => {
                const reqPerUnit = convertRecipeQuantity(ing.quantityRequired, ing.recipeUnit, ing.baseUnit);
                const totalReq = reqPerUnit * (validOutputQuantity ? numOutputQuantity : 0);
                const sufficient = ing.availableQuantity >= totalReq;
                const isPackage = ['pouch', 'label', 'bottle', 'box', 'bag', 'container'].includes(
                  ing.baseUnit.toLowerCase(),
                );

                return (
                  <View
                    key={ing.productId}
                    className={`mb-2 rounded-xl border p-3 ${
                      sufficient ? 'border-slate-200 bg-slate-50' : 'border-amber-300 bg-amber-50'
                    }`}
                  >
                    <View className="flex-row items-center justify-between">
                      <Text className="font-semibold text-slate-800">
                        {ing.name}{' '}
                        <Text className="text-xs font-normal text-slate-500">
                          ({isPackage ? 'Packaging Material' : 'Bulk Source Product'})
                        </Text>
                      </Text>
                      <Text
                        className={`text-xs font-bold ${
                          sufficient ? 'text-emerald-700' : 'text-amber-800'
                        }`}
                      >
                        {sufficient ? 'Stock Available' : 'Insufficient Stock'}
                      </Text>
                    </View>
                    <Text className="mt-1 text-xs text-slate-600">
                      Needed per pack: {ing.quantityRequired} {ing.recipeUnit} • Needed for {numOutputQuantity} packs: {totalReq} {ing.baseUnit}
                    </Text>
                    <Text className="text-xs text-slate-500">
                      Current Stock Available: {ing.availableQuantity} {ing.baseUnit}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}

          {/* Step 4: Server Preview & Action */}
          {selectedProduct && validOutputQuantity ? (
            <View className="rounded-2xl border border-slate-200 bg-white p-5">
              <Text className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Step 4 — Repacking Cost & Stock Preview
              </Text>

              {previewQuery.isLoading ? (
                <Text className="py-4 text-center text-sm text-slate-500">
                  Calculating authoritative preview…
                </Text>
              ) : preview ? (
                <View className="mt-3 gap-3">
                  <View className="flex-row justify-between border-b border-slate-100 pb-2">
                    <Text className="text-sm text-slate-600">Output Product</Text>
                    <Text className="text-sm font-semibold text-slate-900">
                      {preview.productName} ({preview.quantity} packs)
                    </Text>
                  </View>
                  <View className="flex-row justify-between border-b border-slate-100 pb-2">
                    <Text className="text-sm text-slate-600">Estimated Total Cost</Text>
                    <Text className="text-sm font-semibold text-slate-900">
                      ₱{formatMoney(preview.estimatedTotalCost)}
                    </Text>
                  </View>
                  <View className="flex-row justify-between pb-2">
                    <Text className="text-sm text-slate-600">Estimated Cost per Pack</Text>
                    <Text className="text-sm font-bold text-brand-700">
                      ₱{formatMoney(preview.estimatedUnitCost)}
                    </Text>
                  </View>

                  {!preview.canProduce ? (
                    <Text className="rounded-lg bg-amber-100 p-3 text-xs font-semibold text-amber-900">
                      Warning: Insufficient stock for one or more source materials. Recording this
                      batch will fail unless negative inventory is enabled for your organization.
                    </Text>
                  ) : null}

                  <Button
                    title={
                      recordMutation.isPending ? 'Recording Batch…' : 'Record Repacking Batch'
                    }
                    disabled={recordMutation.isPending || !preview.canProduce}
                    onPress={() => setShowConfirmModal(true)}
                    className="mt-2"
                  />
                </View>
              ) : (
                <Text className="py-2 text-xs text-amber-800">
                  Could not fetch authoritative server preview. Check input quantity.
                </Text>
              )}
            </View>
          ) : null}
        </ScrollView>

        {/* Confirmation Modal */}
        <Modal visible={showConfirmModal} transparent animationType="fade">
          <View className="flex-1 items-center justify-center bg-black/50 p-4">
            <View className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
              <Text className="text-lg font-bold text-slate-900">
                Confirm Repacking Batch
              </Text>
              <Text className="mt-1 text-sm text-slate-600">
                Review the batch details before recording inventory consumption and finished output.
              </Text>

              {selectedProduct && preview ? (
                <View className="mt-4 gap-2 rounded-xl bg-slate-50 p-4">
                  <Text className="text-sm font-semibold text-slate-800">
                    Product: {selectedProduct.name}
                  </Text>
                  <Text className="text-sm text-slate-700">
                    Output: {numOutputQuantity} {selectedProduct.unit}s
                  </Text>
                  <Text className="text-xs text-slate-600">
                    Total Estimated Cost: ₱{formatMoney(preview.estimatedTotalCost)}
                  </Text>
                  <Text className="text-xs text-slate-600">
                    Cost per Unit: ₱{formatMoney(preview.estimatedUnitCost)}
                  </Text>
                </View>
              ) : null}

              <View className="mt-6 flex-row justify-end gap-3">
                <Button
                  title="Cancel"
                  variant="secondary"
                  onPress={() => setShowConfirmModal(false)}
                />
                <Button
                  title={
                    recordMutation.isPending ? 'Recording…' : 'Confirm & Record Batch'
                  }
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
