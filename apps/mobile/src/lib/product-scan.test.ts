import { describe, expect, it } from 'vitest';
import { findExactScannedProduct, normalizeBarcode } from './product-scan';

const products = [
  {
    id: 'one',
    name: 'Coffee',
    sku: 'COF-001',
    barcodes: ['4800012345678'],
    sellingPrice: '12.00',
    taxRate: '0.00',
    isTaxInclusive: false,
  },
  {
    id: 'two',
    name: 'Soap',
    sku: 'SOAP-001',
    barcodes: ['4800098765432'],
    sellingPrice: '20.00',
    taxRate: '0.00',
    isTaxInclusive: false,
  },
];

describe('product barcode scanning', () => {
  it('normalizes scanner input before lookup', () => {
    expect(normalizeBarcode(' 4800012345678\r\n')).toBe('4800012345678');
  });

  it('matches an exact barcode instead of a partial product search result', () => {
    expect(findExactScannedProduct(products, '4800098765432')?.id).toBe('two');
    expect(findExactScannedProduct(products, '4800098')).toBeUndefined();
  });

  it('also accepts an exact SKU from a keyboard scanner', () => {
    expect(findExactScannedProduct(products, 'COF-001')?.id).toBe('one');
  });

  it('matches barcode on selling units', () => {
    const productsWithUnits = [
      ...products,
      {
        id: 'three',
        name: 'Juice',
        sku: 'JUICE-001',
        sellingPrice: '15.00',
        taxRate: '0.00',
        isTaxInclusive: false,
        sellingUnits: [
          {
            variantId: 'v1',
            name: 'Pack of 6',
            sku: 'JUICE-PACK',
            unit: 'piece' as const,
            unitsPerBase: 6,
            sellingPrice: '80.00',
            barcodes: ['4800077777777'],
          },
        ],
      },
    ];
    expect(findExactScannedProduct(productsWithUnits, '4800077777777')?.id).toBe('three');
  });

  it('returns undefined for empty input', () => {
    expect(findExactScannedProduct(products, '')).toBeUndefined();
  });
});

