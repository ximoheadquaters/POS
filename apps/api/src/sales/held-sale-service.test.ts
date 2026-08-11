import { describe, expect, it } from 'vitest';
import type { QueryResultRow } from 'pg';
import type { Database } from '../database/types.js';
import type { AppError } from '../shared/errors.js';
import { result } from '../test/fakes.js';
import { HeldSaleService } from './held-sale-service.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const branchId = '22222222-2222-4222-8222-222222222222';
const heldSaleId = '66666666-6666-4666-8666-666666666666';

class HeldSaleDatabase implements Database {
  hasSale = true;
  itemSelectSql = '';
  voidedSales = 0;
  audits = 0;

  async query<T extends QueryResultRow>(text: string) {
    const sql = text.replace(/\s+/g, ' ').trim();
    if (sql.startsWith('select id, branch_id')) {
      return result(
        this.hasSale
          ? ([
              {
                id: heldSaleId,
                branch_id: '22222222-2222-4222-8222-222222222222',
                receipt_number: 'HOLD-MAIN-20260809-00000001',
                customer_id: null,
                note: 'Back shortly',
              },
            ] as unknown as T[])
          : [],
      );
    }
    if (sql.startsWith('select si.product_id')) {
      this.itemSelectSql = sql;
      return result([
        {
          productId: '55555555-5555-4555-8555-555555555555',
          variantId: '77777777-7777-4777-8777-777777777777',
          productName: 'Demo Pack',
          unitPrice: '50.00',
          quantity: 2,
          unit: 'pack',
          unitsPerBase: 10,
          taxRate: '12.00',
          isTaxInclusive: false,
          sku: 'DEMO-PACK',
          image: '/products/demo.png',
        } as unknown as T,
      ]);
    }
    if (sql.startsWith('update sales')) {
      this.voidedSales += 1;
      return result([]);
    }
    if (sql.startsWith('insert into audit_logs')) {
      this.audits += 1;
      return result([]);
    }
    return result([]);
  }

  async transaction<T>(work: (transaction: Database) => Promise<T>): Promise<T> {
    return work(this);
  }

  async close() {}
}

describe('held sale lifecycle', () => {
  it('restores current product fields and closes the parked record without deleting its ledger', async () => {
    const database = new HeldSaleDatabase();
    const resumed = await new HeldSaleService(database).resume(
      organizationId,
      userId,
      branchId,
      heldSaleId,
    );

    expect(resumed).toMatchObject({
      id: heldSaleId,
      receiptNumber: 'HOLD-MAIN-20260809-00000001',
      items: [
        {
          productName: 'Demo Pack',
          unit: 'pack',
          unitsPerBase: 10,
          taxRate: '12.00',
          isTaxInclusive: false,
          image: '/products/demo.png',
        },
      ],
    });
    expect(database.itemSelectSql).toContain('p.image_path as image');
    expect(database.itemSelectSql).not.toContain('primary_image_url');
    expect(database.voidedSales).toBe(1);
    expect(database.audits).toBe(1);
  });

  it('does not change anything when the held sale is missing', async () => {
    const database = new HeldSaleDatabase();
    database.hasSale = false;

    await expect(
      new HeldSaleService(database).resume(organizationId, userId, branchId, heldSaleId),
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' } satisfies Partial<AppError>);
    expect(database.voidedSales).toBe(0);
    expect(database.audits).toBe(0);
  });

  it('discards by closing the parked record and preserving its items', async () => {
    const database = new HeldSaleDatabase();
    await new HeldSaleService(database).discard(organizationId, userId, branchId, heldSaleId);
    expect(database.voidedSales).toBe(1);
    expect(database.audits).toBe(1);
  });
});
