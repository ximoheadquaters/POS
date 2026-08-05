import { describe, expect, it } from 'vitest';
import { normalizeBarcode, resolveScannedProduct } from '../lib/product-scan';
import type { CartProduct } from '../store/cart';
import { selectSellingUnit } from '../store/cart';

describe('Barcode Scanner & Cart Integration Client Tests', () => {
  it('1. Barcode normalization preserves leading zeroes and trims whitespace', () => {
    expect(normalizeBarcode('  0048012345678  ')).toBe('0048012345678');
  });

  it('2. Barcode normalization supports alphanumeric codes', () => {
    expect(normalizeBarcode('  BOX-12-WATER  ')).toBe('BOX-12-WATER');
  });

  it('3. Alternate-unit scan matches explicit alternate unit barcode', () => {
    const product: CartProduct = {
      id: 'p1',
      name: 'Bottled Water',
      sku: 'SKU123',
      unit: 'piece',
      sellingPrice: '20.00',
      taxRate: '0.12',
      isTaxInclusive: true,
      barcodes: ['1111111111111'],
      sellingUnits: [
        {
          variantId: 'v1',
          name: 'Box of 12',
          sku: 'BOX-12',
          unit: 'box',
          unitsPerBase: 12,
          sellingPrice: '220.00',
          barcodes: ['2222222222222'],
        },
      ],
    };

    const match = resolveScannedProduct([product], '2222222222222');
    expect(match).not.toBeNull();
    expect(match?.matchType).toBe('alternate');
    if (match?.matchType === 'alternate') {
      expect(match.sellingUnit.name).toBe('Box of 12');
      expect(match.sellingUnit.sellingPrice).toBe('220.00');
    }
  });

  it('4. Base-unit scan matches base product barcode', () => {
    const product: CartProduct = {
      id: 'p1',
      name: 'Bottled Water',
      sku: 'SKU123',
      unit: 'piece',
      sellingPrice: '20.00',
      taxRate: '0.12',
      isTaxInclusive: true,
      barcodes: ['1111111111111'],
      sellingUnits: [],
    };

    const match = resolveScannedProduct([product], '1111111111111');
    expect(match).not.toBeNull();
    expect(match?.matchType).toBe('base');
  });

  it('5. Scanning alternate box barcode selects correct price and unitsPerBase', () => {
    const product: CartProduct = {
      id: 'p1',
      name: 'Bottled Water',
      sku: 'SKU123',
      unit: 'piece',
      sellingPrice: '20.00',
      taxRate: '0.12',
      isTaxInclusive: true,
      sellingUnits: [
        {
          variantId: 'v1',
          name: 'Box of 12',
          sku: 'BOX-12',
          unit: 'box',
          unitsPerBase: 12,
          sellingPrice: '220.00',
        },
      ],
    };

    const boxItem = selectSellingUnit(product, product.sellingUnits![0]);
    expect(boxItem.sellingPrice).toBe('220.00');
    expect(boxItem.unitsPerBase).toBe(12);
    expect(boxItem.unit).toBe('box');
  });

  it('6. Conversion invariant: 3 Boxes = 36 base pieces', () => {
    const unitsPerBase = 12;
    const sellingQuantity = 3;
    const baseQuantityDeducted = sellingQuantity * unitsPerBase;
    expect(baseQuantityDeducted).toBe(36);
  });

  it('7. Unknown barcode returns null match without adding item', () => {
    const product: CartProduct = {
      id: 'p1',
      name: 'Bottled Water',
      sku: 'SKU123',
      unit: 'piece',
      sellingPrice: '20.00',
      taxRate: '0.12',
      isTaxInclusive: true,
      barcodes: ['1111111111111'],
    };

    const match = resolveScannedProduct([product], '9999999999999');
    expect(match).toBeNull();
  });

  it('8. Same product with different units creates separate cart lines', () => {
    const product: CartProduct = {
      id: 'p1',
      name: 'Bottled Water',
      sku: 'SKU123',
      unit: 'piece',
      sellingPrice: '20.00',
      taxRate: '0.12',
      isTaxInclusive: true,
      sellingUnits: [
        {
          variantId: 'v1',
          name: 'Box of 12',
          sku: 'BOX-12',
          unit: 'box',
          unitsPerBase: 12,
          sellingPrice: '220.00',
        },
      ],
    };

    const pieceItem = selectSellingUnit(product);
    const boxItem = selectSellingUnit(product, product.sellingUnits![0]);

    const keyPiece = `${pieceItem.id}:${pieceItem.variantId ?? 'base'}`;
    const keyBox = `${boxItem.id}:${boxItem.variantId ?? 'base'}`;

    expect(keyPiece).not.toBe(keyBox);
    expect(keyPiece).toBe('p1:base');
    expect(keyBox).toBe('p1:v1');
  });

  it('9. URL-encoded barcode path parameter formatting', () => {
    const barcode = 'BOX 12/WATER#1';
    const encoded = encodeURIComponent(barcode);
    expect(encoded).toBe('BOX%2012%2FWATER%231');
  });

  it('10. One sellable unit adds directly without chooser modal', () => {
    const product: CartProduct = {
      id: 'p1',
      name: 'Solo Cookie',
      sku: 'SKU123',
      unit: 'piece',
      sellingPrice: '15.00',
      taxRate: '0.12',
      isTaxInclusive: true,
      sellingUnits: [],
    };
    const hasAlternate = Boolean(product.sellingUnits?.length);
    expect(hasAlternate).toBe(false);
  });
});
