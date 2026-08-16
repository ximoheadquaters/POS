import { minorToMoney, moneyToMinor } from '@ximo/shared';
import type { CartItem, CartProduct } from '@/store/cart';

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

export interface ComboComponentLine {
  productId: string;
  variantId?: string | null;
  name: string;
  sku: string;
  quantityPerBundle: number;
  unitPrice: string;
  taxRate: string;
  isTaxInclusive: boolean;
  unitsPerBase?: number;
  trackInventory?: boolean;
  availableQuantity?: number | null;
  unit?: CartProduct['unit'];
  unitKind?: CartProduct['unitKind'];
}

function percentHundredths(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) return 0n;
  return (numerator + denominator / 2n) / denominator;
}

/** Mirrors API `calculateLine` total in minor units. */
export function checkoutLineTotalMinor(
  unitPrice: string,
  quantity: number,
  taxRate: string,
  taxInclusive: boolean,
): bigint {
  const price = moneyToMinor(unitPrice);
  const quantityThousandths = BigInt(Math.round(quantity * 1_000));
  const base = divideRounded(price * quantityThousandths, 1_000n);
  const rate = percentHundredths(taxRate);
  if (taxInclusive || rate === 0n) return base;
  return base + divideRounded(base * rate, 10_000n);
}

function exclusiveBaseFromFinal(finalMinor: bigint, rateHundredths: bigint): bigint {
  if (rateHundredths === 0n) return finalMinor;
  let base = divideRounded(finalMinor * 10_000n, 10_000n + rateHundredths);
  let best = base;
  let bestDiff = finalMinor + 1n;
  for (let delta = -4n; delta <= 4n; delta++) {
    const candidate = base + delta;
    if (candidate < 0n) continue;
    const tax = divideRounded(candidate * rateHundredths, 10_000n);
    const total = candidate + tax;
    const diff = total >= finalMinor ? total - finalMinor : finalMinor - total;
    if (diff < bestDiff || (diff === bestDiff && total === finalMinor)) {
      best = candidate;
      bestDiff = diff;
      if (diff === 0n) break;
    }
  }
  return best;
}

/** Unit price so API line total matches a target final amount (combo sticker share). */
export function unitPriceForCheckoutFinal(
  finalLineMinor: bigint,
  quantity: number,
  taxRate: string,
  taxInclusive: boolean,
): string {
  const quantityThousandths = BigInt(Math.round(quantity * 1_000));
  if (quantityThousandths <= 0n || finalLineMinor <= 0n) return '0.00';

  const rate = percentHundredths(taxRate);
  const targetBase =
    taxInclusive || rate === 0n
      ? finalLineMinor
      : exclusiveBaseFromFinal(finalLineMinor, rate);

  let unit = divideRounded(targetBase * 1_000n, quantityThousandths);
  let best = unit;
  let bestDiff = targetBase + 1n;
  for (let delta = -4n; delta <= 4n; delta++) {
    const candidate = unit + delta;
    if (candidate < 0n) continue;
    const base = divideRounded(candidate * quantityThousandths, 1_000n);
    const diff = base >= targetBase ? base - targetBase : targetBase - base;
    if (diff < bestDiff || (diff === bestDiff && base === targetBase)) {
      best = candidate;
      bestDiff = diff;
      if (diff === 0n) break;
    }
  }

  // Nudge so the post-tax line total lands on the combo share (exclusive tax can skip).
  let closest = best;
  let closestDiff = finalLineMinor + 1n;
  for (let delta = -12n; delta <= 12n; delta++) {
    const candidate = best + delta;
    if (candidate < 0n) continue;
    const total = checkoutLineTotalMinor(
      minorToMoney(candidate),
      quantity,
      taxRate,
      taxInclusive,
    );
    const diff = total >= finalLineMinor ? total - finalLineMinor : finalLineMinor - total;
    if (diff < closestDiff) {
      closest = candidate;
      closestDiff = diff;
      if (diff === 0n) break;
    }
  }
  return minorToMoney(closest);
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

/** Allocate final (customer-facing) line totals that sum exactly to comboPrice. */
export function allocateComboFinalLineTotals(
  components: Array<{ sellingPrice: string; requiredQuantity: number }>,
  comboPrice: string,
  bundleQuantity = 1,
): bigint[] {
  if (!components.length) return [];
  const comboMinor = moneyToMinor(comboPrice) * BigInt(Math.round(bundleQuantity));
  const weights = components.map(
    (component) => moneyToMinor(component.sellingPrice) * BigInt(component.requiredQuantity),
  );
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0n);
  let allocated = 0n;
  return components.map((_, index) => {
    if (index === components.length - 1) return comboMinor - allocated;
    const share =
      weightSum === 0n
        ? comboMinor / BigInt(components.length)
        : (comboMinor * weights[index]!) / weightSum;
    allocated += share;
    return share;
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

/** Single cart row for a combo (components expand at checkout / hold). */
export function comboCartBundle(promo: PosComboPromotion): CartProduct {
  const lines = comboCartLines(promo);
  return {
    id: promo.id,
    name: promo.name,
    sku: (promo.code && promo.code.trim()) || 'COMBO',
    unit: 'piece',
    unitKind: 'discrete',
    defaultStep: 1,
    sellingPrice: promo.comboPrice,
    taxRate: '0.00',
    isTaxInclusive: true,
    trackInventory: false,
    availableQuantity: null,
    variantId: null,
    unitsPerBase: 1,
    priceLocked: true,
    promoId: promo.id,
    promoName: promo.name,
    isComboBundle: true,
    comboComponents: lines.map((line) => ({
      productId: line.product.id,
      variantId: line.product.variantId ?? null,
      name: line.product.name,
      sku: line.product.sku,
      quantityPerBundle: line.quantity,
      // Allocation weight only; checkout recomputes tax-safe unit prices.
      unitPrice: line.product.sellingPrice,
      taxRate: line.product.taxRate,
      isTaxInclusive: line.product.isTaxInclusive,
      unitsPerBase: line.product.unitsPerBase ?? 1,
      trackInventory: line.product.trackInventory,
      availableQuantity: line.product.availableQuantity,
      unit: line.product.unit,
      unitKind: line.product.unitKind,
    })),
  };
}

export function expandCartItemsForApi(items: CartItem[]): Array<{
  productId: string;
  variantId?: string | null;
  quantity: number;
  unitPrice?: string;
  promoId?: string;
  unitsPerBase?: number;
}> {
  const expanded: Array<{
    productId: string;
    variantId?: string | null;
    quantity: number;
    unitPrice?: string;
    promoId?: string;
    unitsPerBase?: number;
  }> = [];

  for (const item of items) {
    if (item.product.isComboBundle && item.product.comboComponents?.length) {
      const components = item.product.comboComponents;
      const weightComponents = components.map((component) => ({
        sellingPrice: component.unitPrice,
        requiredQuantity: component.quantityPerBundle,
      }));
      const finalTotals = allocateComboFinalLineTotals(
        weightComponents,
        item.product.sellingPrice,
        item.quantity,
      );
      const comboFinal =
        moneyToMinor(item.product.sellingPrice) * BigInt(Math.round(item.quantity));

      let allocatedActual = 0n;
      components.forEach((component, index) => {
        const quantity = component.quantityPerBundle * item.quantity;
        const isLast = index === components.length - 1;
        const targetFinal = isLast ? comboFinal - allocatedActual : (finalTotals[index] ?? 0n);
        const unitPrice = unitPriceForCheckoutFinal(
          targetFinal > 0n ? targetFinal : 0n,
          quantity,
          component.taxRate,
          component.isTaxInclusive,
        );
        const actual = checkoutLineTotalMinor(
          unitPrice,
          quantity,
          component.taxRate,
          component.isTaxInclusive,
        );
        if (!isLast) allocatedActual += actual;

        expanded.push({
          productId: component.productId,
          variantId: component.variantId ?? null,
          quantity,
          unitPrice,
          promoId: item.product.promoId,
          unitsPerBase: component.unitsPerBase ?? 1,
        });
      });
      continue;
    }
    expanded.push({
      productId: item.product.id,
      variantId: item.product.variantId ?? null,
      quantity: item.quantity,
      unitPrice: item.product.sellingPrice,
      ...(item.product.promoId ? { promoId: item.product.promoId } : {}),
      unitsPerBase: item.product.unitsPerBase ?? 1,
    });
  }
  return expanded;
}

/** Base-unit demand by product id (includes combo components). */
export function cartComponentQuantities(items: CartItem[]): Map<string, number> {
  const quantities = new Map<string, number>();
  const add = (productId: string, amount: number) => {
    quantities.set(productId, (quantities.get(productId) ?? 0) + amount);
  };
  for (const item of items) {
    if (item.product.isComboBundle && item.product.comboComponents?.length) {
      for (const component of item.product.comboComponents) {
        add(
          component.productId,
          component.quantityPerBundle * item.quantity * (component.unitsPerBase ?? 1),
        );
      }
      continue;
    }
    add(item.product.id, item.quantity * (item.product.unitsPerBase ?? 1));
  }
  return quantities;
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

export function comboIncludesLabel(components: ComboComponentLine[] | undefined): string {
  if (!components?.length) return 'Combo';
  const names = components.map((component) => component.name);
  if (names.length <= 2) return names.join(' · ');
  return `${names.slice(0, 2).join(' · ')} +${names.length - 2}`;
}
