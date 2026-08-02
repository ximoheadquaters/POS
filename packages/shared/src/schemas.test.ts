import { describe, expect, it } from 'vitest';
import {
  createProductSchema,
  organizationProfileSchema,
  organizationSettingsSchema,
  productUnitSchema,
  saveRecipeSchema,
  supplierInvoiceSchema,
  supplierPaymentSchema,
  supplierRefundSchema,
  updateProductSchema,
} from './schemas.js';

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

  it('accepts thousandth precision and rejects excessive precision or negative stock', () => {
    expect(
      createProductSchema.parse({ ...validProduct, openingQuantity: 1.125 }).openingQuantity,
    ).toBe(1.125);
    expect(() => createProductSchema.parse({ ...validProduct, openingQuantity: 1.1234 })).toThrow();
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

  it('accepts a product that stays hidden until its first purchase receipt', () => {
    expect(
      createProductSchema.parse({
        ...validProduct,
        sku: 'INCOMING-001',
        barcode: '',
        openingQuantity: 0,
        status: 'pending_receipt',
      }).status,
    ).toBe('pending_receipt');
  });

  it('separates POS products from raw ingredients', () => {
    expect(createProductSchema.parse(validProduct).inventoryRole).toBe('sellable');
    expect(
      createProductSchema.parse({ ...validProduct, inventoryRole: 'ingredient' }).inventoryRole,
    ).toBe('ingredient');
    expect(() =>
      createProductSchema.parse({ ...validProduct, inventoryRole: 'sack' }),
    ).toThrow();
  });
});

describe('productUnitSchema', () => {
  it('accepts configurable discrete and decimal units', () => {
    expect(
      productUnitSchema.parse({
        code: 'tray',
        name: 'Tray',
        kind: 'discrete',
        defaultStep: 1,
      }),
    ).toMatchObject({ code: 'tray', kind: 'discrete' });
    expect(
      productUnitSchema.parse({
        code: 'meter',
        name: 'Meter',
        kind: 'decimal',
        defaultStep: 0.1,
      }),
    ).toMatchObject({ code: 'meter', defaultStep: 0.1 });
  });
});

describe('saveRecipeSchema', () => {
  it('accepts BOM items with an optional manually adjusted product cost', () => {
    expect(
      saveRecipeSchema.parse({
        items: [
          {
            ingredientProductId: '11111111-1111-4111-8111-111111111111',
            quantityRequired: 0.25,
            unit: 'kg',
          },
        ],
        costOverride: '32.50',
      }),
    ).toMatchObject({ costOverride: '32.50' });
  });

  it('rejects an invalid manual cost adjustment', () => {
    expect(() =>
      saveRecipeSchema.parse({
        items: [],
        costOverride: '-1.00',
      }),
    ).toThrow();
  });
});

describe('updateProductSchema', () => {
  it('keeps partial updates partial', () => {
    expect(updateProductSchema.parse({ status: 'inactive' })).toEqual({ status: 'inactive' });
  });

  it('accepts null only when removing an existing product barcode', () => {
    expect(updateProductSchema.parse({ barcode: null })).toEqual({ barcode: null });
  });
});

describe('organizationSettingsSchema', () => {
  const validSettings = {
    businessName: 'Ximo Store',
    currency: 'PHP',
    timezone: 'Asia/Manila',
    taxRate: '12.00',
    receiptHeader: '',
    receiptFooter: '',
    allowNegativeInventory: false,
    paymentMethods: ['cash'] as const,
    targetMarginPercent: '25.00',
    lowMarginThresholdPercent: '15.00',
  };

  it('accepts a target margin and a lower warning threshold', () => {
    expect(organizationSettingsSchema.parse(validSettings)).toMatchObject({
      targetMarginPercent: '25.00',
      lowMarginThresholdPercent: '15.00',
    });
  });

  it('rejects a warning threshold above the target margin', () => {
    expect(() =>
      organizationSettingsSchema.parse({
        ...validSettings,
        targetMarginPercent: '10.00',
        lowMarginThresholdPercent: '15.00',
      }),
    ).toThrow('Low-margin warning must not exceed the target margin');
  });
});

describe('organizationProfileSchema', () => {
  it('normalizes the organization currency and accepts a cleared logo', () => {
    expect(
      organizationProfileSchema.parse({
        name: 'Ximo Store Group',
        currency: 'php',
        timezone: 'Asia/Manila',
        logoPath: null,
      }),
    ).toMatchObject({ name: 'Ximo Store Group', currency: 'PHP', logoPath: null });
  });
});

describe('supplier payable schemas', () => {
  it('accepts a supplier invoice and an external payment', () => {
    expect(
      supplierInvoiceSchema.parse({
        invoiceNumber: 'INV-1001',
        invoiceDate: '2026-07-30',
        dueDate: '2026-08-30',
        total: '1250.00',
      }),
    ).toMatchObject({ invoiceNumber: 'INV-1001', total: '1250.00' });
    expect(() =>
      supplierInvoiceSchema.parse({
        invoiceNumber: 'INV-1002',
        invoiceDate: '2026-07-30',
        dueDate: '2026-07-29',
        total: '1250.00',
      }),
    ).toThrow('Due date cannot be before the invoice date');

    expect(
      supplierPaymentSchema.parse({
        amount: '500.00',
        source: 'bank_transfer',
        reference: 'BANK-001',
      }),
    ).toMatchObject({ source: 'bank_transfer' });
  });

  it('requires an open shift context only for cashier-drawer payments', () => {
    expect(() =>
      supplierPaymentSchema.parse({
        amount: '500.00',
        source: 'cashier_drawer',
      }),
    ).toThrow('An open register shift is required');

    expect(() =>
      supplierPaymentSchema.parse({
        amount: '500.00',
        source: 'owner_cash',
        registerId: '33333333-3333-4333-8333-333333333333',
        shiftId: '44444444-4444-4444-8444-444444444444',
      }),
    ).toThrow('Register details are only allowed');
  });

  it('accepts a supplier refund linked to the original payment', () => {
    expect(
      supplierRefundSchema.parse({
        supplierPaymentId: '11111111-1111-4111-8111-111111111111',
        amount: '45.50',
        registerId: '22222222-2222-4222-8222-222222222222',
        shiftId: '33333333-3333-4333-8333-333333333333',
        reference: 'Supplier receipt 778',
      }),
    ).toMatchObject({ amount: '45.50' });
  });
});
