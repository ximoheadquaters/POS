import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ProductFormEngine } from '@/components/forms/product-form-engine';

export default function EditIngredientScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ProductFormEngine mode="ingredient" productId={id} />;
}
