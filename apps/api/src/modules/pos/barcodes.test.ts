import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { posRouter, normalizeBarcode } from './routes.js';
import { errorHandler } from '../../middleware/errors.js';

const VALID_PRODUCT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const VALID_VARIANT_ID = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
const VALID_BRANCH_ID = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';

function appFor(database: any, authUser?: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.authUser = authUser ?? {
      id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a99',
      role: 'cashier',
      modules: ['pos'],
      permissions: ['sales:create'],
      organization: { id: 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a10' },
      branches: [{ id: VALID_BRANCH_ID }],
    };
    next();
  });
  app.use('/api/v1/pos', posRouter(database));
  app.use(errorHandler);
  return app;
}

class TestPOSDatabase {
  public calls: Array<{ text: string; values: any[] | undefined }> = [];

  constructor(
    private readonly matchData: any[] = [],
    private readonly shouldFail = false,
  ) {}

  async query<T = any>(text: string, values?: any[]): Promise<{ rows: T[] }> {
    this.calls.push({ text, values });
    if (this.shouldFail) {
      throw new Error('Database connection failed');
    }
    if (text.includes('from product_barcodes pb')) {
      const barcode = values?.[2];
      if (barcode === 'EXISTS_OTHER') {
        const error: any = new Error('duplicate key value violates unique constraint');
        error.code = '23505';
        error.constraint = 'product_barcodes_organization_id_barcode_key';
        throw error;
      }
      return { rows: this.matchData as T[] };
    }
    return { rows: [] };
  }
}

describe('POS Barcode Resolution API Server Tests', () => {
  it('1. Barcode normalization preserves leading zeroes and trims whitespace', () => {
    expect(normalizeBarcode('  0012345678  ')).toBe('0012345678');
  });

  it('2. Barcode normalization rejects blank values with 400 Bad Request', () => {
    expect(() => normalizeBarcode('   ')).toThrow();
  });

  it('3. Barcode normalization rejects barcodes exceeding 120 characters', () => {
    const longBarcode = 'A'.repeat(121);
    expect(() => normalizeBarcode(longBarcode)).toThrow();
  });

  it('4. GET /api/v1/pos/barcodes/:barcode resolves base unit product', async () => {
    const db = new TestPOSDatabase([
      {
        barcode: '1111111111111',
        productId: VALID_PRODUCT_ID,
        productName: 'Bottled Water',
        productStatus: 'active',
        baseUnit: 'piece',
        basePrice: '20.00',
        inventoryRole: 'sellable',
        isTaxInclusive: true,
        taxRate: '0.12',
        variantId: null,
        variantName: null,
        variantUnit: null,
        variantUnitsPerBase: null,
        variantPrice: null,
        variantIsActive: null,
        currentStock: '100',
      },
    ]);

    const res = await request(appFor(db))
      .get('/api/v1/pos/barcodes/1111111111111')
      .expect(200);

    expect(res.body.data).toMatchObject({
      productId: VALID_PRODUCT_ID,
      productName: 'Bottled Water',
      sellingUnitCode: 'piece',
      baseUnitsPerSellingUnit: 1,
      unitPrice: '20.00',
      barcode: '1111111111111',
      currentStock: '100',
    });
  });

  it('5. GET /api/v1/pos/barcodes/:barcode resolves alternate selling unit (Box of 12)', async () => {
    const db = new TestPOSDatabase([
      {
        barcode: '2222222222222',
        productId: VALID_PRODUCT_ID,
        productName: 'Bottled Water',
        productStatus: 'active',
        baseUnit: 'piece',
        basePrice: '20.00',
        inventoryRole: 'sellable',
        isTaxInclusive: true,
        taxRate: '0.12',
        variantId: VALID_VARIANT_ID,
        variantName: 'Box of 12',
        variantUnit: 'box',
        variantUnitsPerBase: 12,
        variantPrice: '220.00',
        variantIsActive: true,
        currentStock: '120',
      },
    ]);

    const res = await request(appFor(db))
      .get('/api/v1/pos/barcodes/2222222222222')
      .expect(200);

    expect(res.body.data).toMatchObject({
      productId: VALID_PRODUCT_ID,
      productName: 'Bottled Water',
      sellingUnitId: VALID_VARIANT_ID,
      productVariantId: VALID_VARIANT_ID,
      sellingUnitCode: 'box',
      sellingUnitName: 'Box of 12',
      baseUnitsPerSellingUnit: 12,
      unitPrice: '220.00',
    });
  });

  it('6. Unknown barcode returns 404 NOT_FOUND response', async () => {
    const db = new TestPOSDatabase([]);
    const res = await request(appFor(db))
      .get('/api/v1/pos/barcodes/9999999999999')
      .expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('7. Ambiguous barcode matching multiple items returns 409 Conflict', async () => {
    const db = new TestPOSDatabase([
      { productId: VALID_PRODUCT_ID, variantId: null, productStatus: 'active', baseUnit: 'piece', basePrice: '10' },
      { productId: VALID_PRODUCT_ID, variantId: null, productStatus: 'active', baseUnit: 'piece', basePrice: '10' },
    ]);
    const res = await request(appFor(db))
      .get('/api/v1/pos/barcodes/1111111111111')
      .expect(409);

    expect(res.body.error.code).toBe('AMBIGUOUS_BARCODE');
    expect(res.body.error.message).toContain('more than one item');
  });

  it('8. Inactive product returns 422 INACTIVE_PRODUCT', async () => {
    const db = new TestPOSDatabase([
      {
        barcode: '1111111111111',
        productId: VALID_PRODUCT_ID,
        productName: 'Archived Item',
        productStatus: 'archived',
        baseUnit: 'piece',
        basePrice: '20.00',
        variantId: null,
      },
    ]);
    const res = await request(appFor(db))
      .get('/api/v1/pos/barcodes/1111111111111')
      .expect(422);

    expect(res.body.error.code).toBe('INACTIVE_PRODUCT');
  });

  it('9. Inactive alternate selling unit returns 422 INACTIVE_UNIT', async () => {
    const db = new TestPOSDatabase([
      {
        barcode: '2222222222222',
        productId: VALID_PRODUCT_ID,
        productName: 'Bottled Water',
        productStatus: 'active',
        baseUnit: 'piece',
        basePrice: '20.00',
        variantId: VALID_VARIANT_ID,
        variantName: 'Box of 12',
        variantUnit: 'box',
        variantUnitsPerBase: 12,
        variantPrice: '220.00',
        variantIsActive: false,
      },
    ]);
    const res = await request(appFor(db))
      .get('/api/v1/pos/barcodes/2222222222222')
      .expect(422);

    expect(res.body.error.code).toBe('INACTIVE_UNIT');
  });

  it('10. Unauthorized user without sales:create permission receives 403 PERMISSION_DENIED', async () => {
    const db = new TestPOSDatabase([]);
    const res = await request(
      appFor(db, {
        id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a99',
        role: 'inventory_staff',
        modules: ['pos'],
        permissions: ['inventory:read'],
        organization: { id: 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a10' },
      }),
    )
      .get('/api/v1/pos/barcodes/1111111111111')
      .expect(403);

    expect(res.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('11. URL-encoded barcode path parameter resolves correctly', async () => {
    const db = new TestPOSDatabase([
      {
        barcode: 'BOX 12/WATER#1',
        productId: VALID_PRODUCT_ID,
        productName: 'Water',
        productStatus: 'active',
        baseUnit: 'piece',
        basePrice: '20.00',
        inventoryRole: 'sellable',
        isTaxInclusive: true,
        variantId: null,
        currentStock: '50',
      },
    ]);
    const encoded = encodeURIComponent('BOX 12/WATER#1');
    const res = await request(appFor(db))
      .get(`/api/v1/pos/barcodes/${encoded}`)
      .expect(200);

    expect(res.body.data.barcode).toBe('BOX 12/WATER#1');
  });
});
