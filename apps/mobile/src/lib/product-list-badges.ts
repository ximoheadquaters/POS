import { isMeasurementUnit } from './retail-product-mode';
import { validateUnitConversion } from '@ximo/shared';

export interface ProductBadgeItem {
  key: string;
  label: string;
  type: 'bulk_source' | 'repacked' | 'recipe_configured' | 'weighted' | 'alternate_unit';
}

export interface CatalogProductInput {
  unit?: string | null;
  inventoryRole?: string | null;
  preparationBehavior?: string | null;
  hasRecipe?: boolean;
  sellingPrice?: string | number | null;
  availableQuantity?: number | null;
  lowStockThreshold?: number | null;
  sellingUnits?: Array<{
    name?: string;
    unit?: string;
    unitsPerBase?: number;
    sellingPrice?: string | number;
  }> | null;
}

export function getRetailProductTypeBadges(product: CatalogProductInput): ProductBadgeItem[] {
  const badges: ProductBadgeItem[] = [];

  if (product.inventoryRole === 'ingredient') {
    badges.push({ key: 'bulk_source', label: 'Bulk Source', type: 'bulk_source' });
  }

  if (product.preparationBehavior === 'preproduced') {
    badges.push({ key: 'repacked', label: 'Repacked', type: 'repacked' });
  } else if (product.hasRecipe) {
    badges.push({ key: 'recipe_configured', label: 'Repacking recipe configured', type: 'recipe_configured' });
  }

  if (isMeasurementUnit(product.unit)) {
    badges.push({ key: 'weighted', label: 'Weighted', type: 'weighted' });
  }

  const altBadge = formatAlternateSellingUnitBadge(product.sellingUnits, product.unit);
  if (altBadge) {
    badges.push({ key: 'alternate_unit', label: altBadge, type: 'alternate_unit' });
  }

  return badges;
}

export function formatAlternateSellingUnitBadge(
  sellingUnits?: CatalogProductInput['sellingUnits'],
  _baseUnit?: string | null,
): string | null {
  if (!sellingUnits || sellingUnits.length === 0) return null;
  const first = sellingUnits[0];
  if (!first || !first.unitsPerBase || first.unitsPerBase <= 0) return null;

  const unitName = (first.name || first.unit || 'unit').trim();
  const price = first.sellingPrice ? `₱${parseFloat(String(first.sellingPrice)).toFixed(2)}` : '';
  const factorStr = `${unitName} of ${first.unitsPerBase}`;
  return price ? `${factorStr}: ${price}` : factorStr;
}

export function getStockStatus(
  availableQuantity?: number | null,
  lowStockThreshold?: number | null,
): { status: 'out_of_stock' | 'low_stock' | 'in_stock'; label: string } {
  if (availableQuantity === null || availableQuantity === undefined) {
    return { status: 'in_stock', label: 'In Stock' };
  }

  if (availableQuantity <= 0) {
    return { status: 'out_of_stock', label: 'Out of Stock' };
  }

  if (
    lowStockThreshold !== null &&
    lowStockThreshold !== undefined &&
    lowStockThreshold > 0 &&
    availableQuantity <= lowStockThreshold
  ) {
    return { status: 'low_stock', label: 'Low Stock' };
  }

  return { status: 'in_stock', label: 'In Stock' };
}

export function hasLegacyInvalidConversion(product: CatalogProductInput): {
  isInvalid: boolean;
  warning?: string;
} {
  if (!product.unit || !product.sellingUnits || product.sellingUnits.length === 0) {
    return { isInvalid: false };
  }

  for (const variant of product.sellingUnits) {
    if (!variant.unit || !variant.unitsPerBase) continue;
    const check = validateUnitConversion(product.unit, variant.unit, variant.unitsPerBase);
    if (!check.valid) {
      return {
        isInvalid: true,
        warning: 'Review unit setup',
      };
    }
  }

  return { isInvalid: false };
}

export function formatCatalogUnitPrice(
  sellingPrice?: string | number | null,
  unit?: string | null,
): string {
  const price = parseFloat(String(sellingPrice || 0));
  const formattedPrice = `₱${price.toFixed(2)}`;
  if (isMeasurementUnit(unit)) {
    return `${formattedPrice} / ${unit!.trim().toLowerCase()}`;
  }
  return formattedPrice;
}
