import { useEffect, useState } from 'react';
import { TextInput } from 'react-native';
import type { CartProduct } from '@/store/cart';
import { isDiscreteUnit, normalizeQuantity } from '@/store/cart';

interface QuantityInputProps {
  product: CartProduct;
  quantity: number;
  onChange(quantity: number): void;
  compact?: boolean;
}

export function QuantityInput({
  product,
  quantity,
  onChange,
  compact = false,
}: QuantityInputProps) {
  const [draft, setDraft] = useState(String(quantity));

  useEffect(() => setDraft(String(quantity)), [quantity]);

  const commit = () => {
    const parsed = Number(draft.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setDraft(String(quantity));
      return;
    }
    const maximum =
      product.trackInventory !== false && typeof product.availableQuantity === 'number'
        ? product.availableQuantity
        : parsed;
    const bounded = Math.min(parsed, maximum);
    const next = isDiscreteUnit(product.unit, product.unitKind)
      ? Math.floor(bounded)
      : normalizeQuantity(bounded);
    if (next <= 0) {
      setDraft(String(quantity));
      return;
    }
    onChange(next);
    setDraft(String(next));
  };

  return (
    <TextInput
      accessibilityLabel={`${product.name} quantity in ${product.unit ?? 'pieces'}`}
      value={draft}
      onChangeText={setDraft}
      onBlur={commit}
      onSubmitEditing={commit}
      selectTextOnFocus
      keyboardType="decimal-pad"
      returnKeyType="done"
      className={`rounded-lg border border-slate-200 bg-white text-center font-medium text-slate-900 ${
        compact ? 'h-8 w-14 text-sm' : 'h-10 w-20 text-base'
      }`}
    />
  );
}
