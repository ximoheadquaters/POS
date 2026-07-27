import { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { productSchema, type ProductInput } from '@ximo/shared';
import type { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button, Field, Header, Screen } from '@/components/ui';
import { useBranchStore } from '@/store/branch';
import { useCartStore, type CartProduct } from '@/store/cart';

export default function ProductFormScreen() {
  const params = useLocalSearchParams<{ barcode?: string; addToCart?: string }>();
  const scannedBarcode = typeof params.barcode === 'string' ? params.barcode.trim() : '';
  const addToCart = params.addToCart === '1';
  const branch = useBranchStore((state) => state.activeBranch)!;
  const add = useCartStore((state) => state.add);
  const [openingQuantity, setOpeningQuantity] = useState(addToCart ? '1' : '0');
  const queryClient = useQueryClient();
  const form = useForm<z.input<typeof productSchema>, unknown, ProductInput>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: '',
      sku: scannedBarcode,
      barcode: scannedBarcode,
      cost: '0.00',
      sellingPrice: '0.00',
      taxRate: '12.00',
      isTaxInclusive: false,
      status: 'active',
    },
  });
  const mutation = useMutation({
    mutationFn: (input: ProductInput) => {
      const quantity = Number(openingQuantity);
      if (!Number.isInteger(quantity) || quantity < 0) {
        throw new Error('Stock on hand must be a whole number of zero or more');
      }
      return api<CartProduct>('/products', {
        method: 'POST',
        body: JSON.stringify({
          ...input,
          branchId: branch.id,
          openingQuantity: quantity,
        }),
      });
    },
    onSuccess: async (product) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['pos-products'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory', branch.id] }),
      ]);
      if (addToCart) {
        add(product);
        router.replace('/(tabs)/pos');
      } else {
        router.back();
      }
    },
    onError: (error) => Alert.alert('Could not save product', error.message),
  });
  const fields: Array<{
    name: keyof ProductInput;
    label: string;
    keyboard?: 'default' | 'decimal-pad';
  }> = [
    { name: 'name', label: 'Product name' },
    { name: 'sku', label: 'SKU' },
    { name: 'barcode', label: 'Barcode' },
    { name: 'cost', label: 'Cost', keyboard: 'decimal-pad' },
    { name: 'sellingPrice', label: 'Selling price', keyboard: 'decimal-pad' },
    { name: 'taxRate', label: 'Tax rate (%)', keyboard: 'decimal-pad' },
    { name: 'imagePath', label: 'Optional image storage path' },
  ];
  return (
    <Screen>
      <Header
        title={scannedBarcode ? 'Add scanned product' : 'New product'}
        subtitle={
          scannedBarcode
            ? `Barcode ${scannedBarcode} is ready. Complete the product details.`
            : 'Prices and stock are validated again by the API.'
        }
        showBack
        backLabel={addToCart ? 'POS' : 'Products'}
        fallbackHref={addToCart ? '/(tabs)/pos' : '/products'}
      />
      <ScrollView contentContainerClassName="p-5 pb-10">
        {scannedBarcode ? (
          <View className="mb-5 rounded-2xl bg-brand-50 p-4">
            <Text className="font-bold text-brand-900">Barcode captured</Text>
            <Text className="mt-1 text-sm leading-5 text-slate-600">
              The barcode is also used as the initial SKU for faster setup. You can change the SKU
              below without changing the barcode.
            </Text>
          </View>
        ) : null}
        {fields.map((field) => (
          <Controller
            key={field.name}
            control={form.control}
            name={field.name}
            render={({ field: controlled, fieldState }) => (
              <Field
                label={field.label}
                value={typeof controlled.value === 'string' ? controlled.value : ''}
                onChangeText={controlled.onChange}
                onBlur={controlled.onBlur}
                keyboardType={field.keyboard}
                error={fieldState.error?.message}
              />
            )}
          />
        ))}
        <Field
          label={`Stock currently on hand at ${branch.name}`}
          value={openingQuantity}
          onChangeText={setOpeningQuantity}
          keyboardType="number-pad"
          placeholder="0"
        />
        <View className="mb-5 rounded-2xl bg-slate-100 p-4">
          <Text className="text-sm leading-5 text-slate-600">
            Count the sellable pieces, not cases. This creates the opening inventory record and
            keeps checkout from failing when negative stock is disabled.
          </Text>
        </View>
        <Button
          title={
            mutation.isPending ? 'Saving…' : addToCart ? 'Save and add to cart' : 'Save product'
          }
          disabled={mutation.isPending}
          onPress={form.handleSubmit((value) => mutation.mutate(value))}
        />
      </ScrollView>
    </Screen>
  );
}
