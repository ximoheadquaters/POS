import type { CartProduct } from '@/store/cart';

export function normalizeBarcode(value: string): string {
  return value.trim();
}

export function findExactScannedProduct(
  products: CartProduct[],
  scannedValue: string,
): CartProduct | undefined {
  const barcode = normalizeBarcode(scannedValue);
  if (!barcode) return undefined;
  return products.find(
    (product) =>
      product.sku === barcode ||
      product.barcodes?.includes(barcode) ||
      product.sellingUnits?.some(
        (unit) => unit.sku === barcode || unit.barcodes?.includes(barcode),
      ),
  );
}

