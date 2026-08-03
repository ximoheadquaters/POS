import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import type { PreparationBehavior } from '@ximo/shared';
import { api } from '../../lib/api';
import {
  ProductIdentityFields,
  PricingFields,
  PreparationBehaviorFields,
} from './product-fields';

export type InventoryRole = 'sellable' | 'ingredient' | 'both';
export type ProductFormMode = 'generic' | 'retail' | 'ingredient' | 'menu_item';

export interface ProductFormEngineProps {
  mode: ProductFormMode;
  productId?: string;
  onSuccess?: () => void;
}

export const ProductFormEngine: React.FC<ProductFormEngineProps> = ({
  mode,
  productId,
  onSuccess,
}) => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Core Form State
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [cost, setCost] = useState('0.00');
  const [sellingPrice, setSellingPrice] = useState(mode === 'ingredient' ? '0.00' : '');
  const [unit, setUnit] = useState('piece');
  const [inventoryRole, setInventoryRole] = useState<InventoryRole>(
    mode === 'ingredient' ? 'ingredient' : 'sellable',
  );
  const [preparationBehavior, setPreparationBehavior] = useState<PreparationBehavior>(
    mode === 'menu_item' ? 'cook_to_order' : 'standard',
  );
  const [trackInventory, setTrackInventory] = useState(mode === 'ingredient');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');

  // Preserve existing hidden fields during edits
  const [persistedData, setPersistedData] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (productId) {
      setLoading(true);
      api<any>(`/products/${productId}`)
        .then((res) => {
          const item = res.data ?? res;
          setPersistedData(item);
          setName(item.name || '');
          setSku(item.sku || '');
          setBarcode(item.barcodes?.[0] || '');
          setCost(item.cost || '0.00');
          setSellingPrice(item.sellingPrice || '0.00');
          setUnit(item.unit || 'piece');
          setInventoryRole(item.inventoryRole || 'sellable');
          setPreparationBehavior(item.preparationBehavior || 'standard');
          setTrackInventory(Boolean(item.trackInventory));
          setStatus(item.status || 'active');
        })
        .catch((err: any) => {
          Alert.alert('Error', err.message || 'Failed to load product details');
        })
        .finally(() => setLoading(false));
    }
  }, [productId]);

  const handleSubmit = async () => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = 'Product name is required';
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setSaving(true);
    try {
      // Merge with persisted data to ensure hidden fields are preserved
      const payload: Record<string, any> = {
        ...persistedData,
        name: name.trim(),
        unit,
        inventoryRole,
        preparationBehavior,
        trackInventory,
        status,
        cost: cost || '0.00',
        sellingPrice: mode === 'ingredient' ? '0.00' : (sellingPrice || '0.00'),
      };

      // Only include sku and barcodes if modified or provided
      if (sku.trim()) payload.sku = sku.trim();
      if (barcode.trim()) payload.barcodes = [barcode.trim()];

      if (productId) {
        await api(`/products/${productId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await api('/products', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }

      Alert.alert(
        'Success',
        `Product ${productId ? 'updated' : 'created'} successfully!`,
      );
      if (onSuccess) {
        onSuccess();
      } else {
        router.back();
      }
    } catch (err: any) {
      Alert.alert('Save Error', err.message || 'Failed to save product');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center p-8">
        <ActivityIndicator size="large" color="#059669" />
      </View>
    );
  }

  const titleText = productId
    ? `Edit ${mode === 'ingredient' ? 'Ingredient' : mode === 'menu_item' ? 'Menu Item' : 'Product'}`
    : `New ${mode === 'ingredient' ? 'Ingredient' : mode === 'menu_item' ? 'Menu Item' : 'Product'}`;

  return (
    <ScrollView className="flex-1 bg-slate-50 dark:bg-slate-950 p-4 sm:p-6">
      <View className="max-w-2xl mx-auto w-full gap-6">
        <View className="flex-row items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
          <Text className="text-xl font-bold text-slate-900 dark:text-white">{titleText}</Text>
          <Pressable
            onPress={() => router.back()}
            className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
          >
            <Text className="text-xs font-semibold text-slate-700 dark:text-slate-300">Cancel</Text>
          </Pressable>
        </View>

        <ProductIdentityFields
          name={name}
          onChangeName={setName}
          sku={sku}
          onChangeSku={setSku}
          barcode={barcode}
          onChangeBarcode={setBarcode}
          showSkuBarcode={mode === 'generic' || mode === 'retail'}
          errors={errors}
        />

        <PricingFields
          cost={cost}
          onChangeCost={setCost}
          sellingPrice={sellingPrice}
          onChangeSellingPrice={setSellingPrice}
          showSellingPrice={mode !== 'ingredient'}
          errors={errors}
        />

        {mode === 'menu_item' && (
          <PreparationBehaviorFields
            selected={preparationBehavior}
            onSelect={setPreparationBehavior}
            allowedBehaviors={['cook_to_order', 'preproduced']}
          />
        )}

        <View className="pt-4 flex-row justify-end gap-3">
          <Pressable
            onPress={handleSubmit}
            disabled={saving}
            className="rounded-xl bg-emerald-600 px-6 py-3 items-center justify-center shadow-sm active:bg-emerald-700"
          >
            {saving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text className="text-sm font-bold text-white">Save {mode === 'ingredient' ? 'Ingredient' : mode === 'menu_item' ? 'Menu Item' : 'Product'}</Text>
            )}
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
};
