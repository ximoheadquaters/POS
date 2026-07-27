import { describe, expect, it } from 'vitest';
import { createProductSchema } from './schemas';

const validProduct = {
  branchId: '22222222-2222-4222-8222-222222222222',
  name: 'Instant coffee sachet',
  sku: '4800012345678',
  barcode: '4800012345678',
  cost: '5.00',
  sellingPrice: '7.00',
  taxRate: '0.00',
  isTaxInclusive: false,
  status: 'active' as const,
};

describe('createProductSchema', () => {
  it('accepts a scanned product with opening stock', () => {
    expect(
      createProductSchema.parse({
        ...validProduct,
        openingQuantity: 24,
      }),
    ).toMatchObject({
      barcode: '4800012345678',
      openingQuantity: 24,
    });
  });

  it('rejects fractional or negative opening stock', () => {
    expect(() => createProductSchema.parse({ ...validProduct, openingQuantity: 1.5 })).toThrow();
    expect(() => createProductSchema.parse({ ...validProduct, openingQuantity: -1 })).toThrow();
  });

  it('allows a manually created product without a barcode', () => {
    expect(
      createProductSchema.parse({
        ...validProduct,
        barcode: '',
      }).barcode,
    ).toBeUndefined();
  });
});
