import { describe, expect, it } from 'vitest';
import type { HoldSaleInput } from '@ximo/shared';
import type { QueryResultRow } from 'pg';
import type { Database } from '../database/types.js';
import type { AppError } from '../shared/errors.js';
import { result } from '../test/fakes.js';
import { HoldSaleService } from './hold-sale-service.js';

const actor = {
  userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  organizationId: '11111111-1111-4111-8111-111111111111',
};

const input: HoldSaleInput = {
  branchId: '22222222-2222-4222-8222-222222222222',
  registerId: '33333333-3333-4333-8333-333333333333',
  shiftId: '44444444-4444-4444-8444-444444444444',
  items: [{ productId: '55555555-5555-4555-8555-555555555555', quantity: 2 }],
  note: 'Customer stepped out',
};

class HoldSaleDatabase implements Database {
  validContext = true;
  insertedSaleValues: readonly unknown[] | null = null;
  insertedItemValues: readonly unknown[] | null = null;
  transactionCalls = 0;

  async query<T extends QueryResultRow>(text: string, values: readonly unknown[] = []) {
    const sql = text.replace(/\s+/g, ' ').trim();
    if (sql.startsWith('select s.id, s.receipt_number')) return result([]);
    if (sql.startsWith('select b.code as branch_code')) {
      return result(
        this.validContext
          ? ([
              {
                branch_code: 'MAIN',
                register_id: input.registerId,
              },
            ] as unknown as T[])
          : [],
      );
    }
    if (sql.startsWith('select p.id as product_id')) {
      return result([
        {
          product_id: input.items[0]!.productId,
          variant_id: null,
          name: 'Demo Product',
          sku: 'DEMO-1',
          unit_price: '15.00',
          unit_cost: '8.00',
          tax_rate: '12.00',
          is_tax_inclusive: false,
          units_per_base: 1,
          selling_unit: 'piece',
          unit_kind: 'discrete',
        } as unknown as T,
      ]);
    }
    if (sql.startsWith("select 'HOLD-'")) {
      return result([{ receipt_number: 'HOLD-MAIN-20260809-00000001' } as unknown as T]);
    }
    if (sql.startsWith('insert into sales')) {
      this.insertedSaleValues = values;
      return result([{ id: '66666666-6666-4666-8666-666666666666' } as unknown as T]);
    }
    if (sql.startsWith('insert into sale_items')) {
      this.insertedItemValues = values;
      return result([]);
    }
    if (sql.startsWith('insert into audit_logs')) return result([]);
    return result([]);
  }

  async transaction<T>(work: (transaction: Database) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    return work(this);
  }

  async close() {}
}

describe('hold sale transaction', () => {
  it('stores all required sale and item fields without deducting inventory', async () => {
    const database = new HoldSaleDatabase();
    const held = await new HoldSaleService(database).hold(actor, input, 'hold-key-0001');

    expect(held).toEqual({
      id: '66666666-6666-4666-8666-666666666666',
      receiptNumber: 'HOLD-MAIN-20260809-00000001',
      subtotal: '30.00',
      taxTotal: '3.60',
      total: '33.60',
      itemCount: 1,
      replayed: false,
    });
    expect(database.insertedSaleValues).toEqual([
      actor.organizationId,
      input.branchId,
      input.registerId,
      input.shiftId,
      actor.userId,
      null,
      'HOLD-MAIN-20260809-00000001',
      'hold-key-0001',
      '30.00',
      '3.60',
      '33.60',
      '16.00',
      input.note,
    ]);
    expect(database.insertedItemValues).toEqual([
      actor.organizationId,
      '66666666-6666-4666-8666-666666666666',
      input.items[0]!.productId,
      null,
      'Demo Product',
      'DEMO-1',
      2,
      '15.00',
      '8.00',
      '3.60',
      '33.60',
      1,
    ]);
  });

  it('returns an actionable error when no shift is open', async () => {
    const database = new HoldSaleDatabase();
    await expect(
      new HoldSaleService(database).hold(
        actor,
        { ...input, registerId: undefined, shiftId: undefined },
        'hold-key-0002',
      ),
    ).rejects.toMatchObject({
      status: 400,
      code: 'SHIFT_REQUIRED',
      message: 'Open a register shift before holding a sale',
    } satisfies Partial<AppError>);
    expect(database.transactionCalls).toBe(0);
  });

  it('rejects a stale or mismatched register shift', async () => {
    const database = new HoldSaleDatabase();
    database.validContext = false;
    await expect(
      new HoldSaleService(database).hold(actor, input, 'hold-key-0003'),
    ).rejects.toMatchObject({
      status: 403,
      code: 'INVALID_HOLD_CONTEXT',
    } satisfies Partial<AppError>);
  });
});
