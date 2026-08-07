import { minorToMoney, moneyToMinor } from '@ximo/shared';
import type { CartProduct } from '@/store/cart';

export interface PosComboComponent {
  productId: string;
  requiredQuantity: number;
  role: string;
  id: string;
  name: string;
  sku: string;
  unit?: CartProduct['unit'];
  unitKind?: CartProduct['unitKind'];
  defaultStep?: number;
  trackInventory?: boolean;
  sellingPrice: string;
  taxRate: string;
  isTaxInclusive: boolean;
  status?: string;
  categoryName?: string | null;
  availableQuantity?: number | null;
}

export interface PosComboPromotion {
  id: string;
  name: string;
  code?: string | null;
  type: 'combo_bundle';
  comboPrice: string;
  description?: string | null;
  components: PosComboComponent[];
}

/** Split combo price across components proportional to regular line totals. */
export function allocateComboUnitPrices(
  components: Array<{ sellingPrice: string; requiredQuantity: number }>,
  comboPrice: string,
): string[] {
  if (!components.length) return [];
  const comboMinor = moneyToMinor(comboPrice);
  const weights = components.map(
    (component) => moneyToMinor(component.sellingPrice) * BigInt(component.requiredQuantity),
  );
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0n);

  let allocatedLine = 0n;
  return components.map((component, index) => {
    const qty = BigInt(component.requiredQuantity);
    let lineTotal: bigint;
    if (index === components.length - 1) {
      lineTotal = comboMinor - allocatedLine;
    } else if (weightSum === 0n) {
      lineTotal = comboMinor / BigInt(components.length);
      allocatedLine += lineTotal;
    } else {
      lineTotal = (comboMinor * weights[index]!) / weightSum;
      allocatedLine += lineTotal;
    }
    if (qty <= 0n) return minorToMoney(0n);
    const unitMinor = lineTotal / qty;
    return minorToMoney(unitMinor);
  });
}

export function comboCartLines(
  promo: PosComboPromotion,
): Array<{ product: CartProduct; quantity: number }> {
  const unitPrices = allocateComboUnitPrices(promo.components, promo.comboPrice);
  return promo.components.map((component, index) => ({
    quantity: component.requiredQuantity,
    product: {
      id: component.id,
      name: component.name,
      sku: component.sku,
      unit: component.unit,
      unitKind: component.unitKind,
      defaultStep: component.defaultStep,
      trackInventory: component.trackInventory,
      categoryName: component.categoryName ?? undefined,
      sellingPrice: unitPrices[index] ?? component.sellingPrice,
      taxRate: component.taxRate,
      isTaxInclusive: component.isTaxInclusive,
      status: component.status,
      availableQuantity: component.availableQuantity,
      variantId: null,
      unitsPerBase: 1,
      priceLocked: true,
      promoId: promo.id,
      promoName: promo.name,
    },
  }));
}

export function comboSoldOut(
  promo: PosComboPromotion,
  cartQuantities: Map<string, number>,
): boolean {
  return promo.components.some((component) => {
    if (component.trackInventory === false) return false;
    if (component.availableQuantity === null || component.availableQuantity === undefined) {
      return false;
    }
    const inCart = cartQuantities.get(component.id) ?? 0;
    return inCart + component.requiredQuantity > component.availableQuantity;
  });
}
