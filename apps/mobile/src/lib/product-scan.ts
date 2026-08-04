import type { CartProduct, SellingUnit } from '../store/cart';
import { selectSellingUnit } from '../store/cart';

export function normalizeBarcode(value: string): string {
  return value.trim();
}

export type ProductScanResult =
  | {
      matchType: 'base';
      product: CartProduct;
      sellingUnit: null;
    }
  | {
      matchType: 'alternate';
      product: CartProduct;
      sellingUnit: SellingUnit;
    };

export function resolveScannedProduct(
  products: CartProduct[],
  scannedValue: string,
): ProductScanResult | null {
  const barcode = normalizeBarcode(scannedValue);
  if (!barcode) return null;

  for (const product of products) {
    // 1. Check alternate selling unit barcodes & SKUs first for explicit alternate match
    if (product.sellingUnits?.length) {
      const matchedUnit = product.sellingUnits.find(
        (unit) => unit.sku === barcode || unit.barcodes?.includes(barcode),
      );
      if (matchedUnit) {
        return {
          matchType: 'alternate',
          product,
          sellingUnit: matchedUnit,
        };
      }
    }

    // 2. Check base product barcode & SKU
    if (product.sku === barcode || product.barcodes?.includes(barcode)) {
      return {
        matchType: 'base',
        product,
        sellingUnit: null,
      };
    }
  }

  return null;
}

export function findExactScannedProduct(
  products: CartProduct[],
  scannedValue: string,
): CartProduct | undefined {
  const resolved = resolveScannedProduct(products, scannedValue);
  if (!resolved) return undefined;
  if (resolved.matchType === 'alternate') {
    return selectSellingUnit(resolved.product, resolved.sellingUnit);
  }
  return selectSellingUnit(resolved.product);
}
