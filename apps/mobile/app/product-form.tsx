import { Alert, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { productSchema, type ProductInput } from '@ximo/shared';
import type { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button, Field, Header, Screen } from '@/components/ui';

export default function ProductFormScreen() {
  const queryClient = useQueryClient();
  const form = useForm<z.input<typeof productSchema>, unknown, ProductInput>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: '',
      sku: '',
      barcode: '',
      cost: '0.00',
      sellingPrice: '0.00',
      taxRate: '12.00',
      isTaxInclusive: false,
      status: 'active',
    },
  });
  const mutation = useMutation({
    mutationFn: (input: ProductInput) =>
      api('/products', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      router.back();
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
        title="New product"
        subtitle="Prices are validated again by the API."
        showBack
        backLabel="Products"
        fallbackHref="/products"
      />
      <ScrollView contentContainerClassName="p-5 pb-10">
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
        <Button
          title={mutation.isPending ? 'Saving…' : 'Save product'}
          disabled={mutation.isPending}
          onPress={form.handleSubmit((value) => mutation.mutate(value))}
        />
      </ScrollView>
    </Screen>
  );
}
