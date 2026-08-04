import { describe, expect, it } from 'vitest';
import type { QueryResultRow } from 'pg';
import type { Database } from '../database/types.js';
import { result } from '../test/fakes.js';
import { ReturnService } from './return-service.js';

class ReturnDatabase implements Database {
  async query<T extends QueryResultRow>(text: string) {
    const sql = text.replace(/\s+/g, ' ').trim();
    if (sql.startsWith('select branch_id, status')) {
      return result([{ branch_id: 'branch', status: 'completed' } as unknown as T]);
    }
    if (sql.includes('from register_shifts')) {
      return result([{ '?column?': 1 } as unknown as T]);
    }
    if (sql.startsWith('select si.id, si.product_id')) {
      return result([
        {
          id: '77777777-7777-4777-8777-777777777777',
          product_id: '55555555-5555-4555-8555-555555555555',
          variant_id: null,
          quantity: 2,
          returned_quantity: 1,
          line_total: '30.00',
          track_inventory: true,
          units_per_base: 1,
        } as unknown as T,
      ]);
    }
    return result([]);
  }
  async transaction<T>(work: (transaction: Database) => Promise<T>): Promise<T> {
    return work(this);
  }
  async close() {}
}

describe('returns', () => {
  it('cannot return more than the remaining sold quantity', async () => {
    const service = new ReturnService(new ReturnDatabase());
    await expect(
      service.create(
        {
          userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          organizationId: '11111111-1111-4111-8111-111111111111',
        },
        '66666666-6666-4666-8666-666666666666',
        {
          branchId: '22222222-2222-4222-8222-222222222222',
          registerId: '33333333-3333-4333-8333-333333333333',
          shiftId: '44444444-4444-4444-8444-444444444444',
          reason: 'Damaged item',
          refundMethod: 'cash',
          items: [{ saleItemId: '77777777-7777-4777-8777-777777777777', quantity: 2 }],
        },
      ),
    ).rejects.toMatchObject({ code: 'RETURN_QUANTITY_EXCEEDED' });
  });

  it('one returned box of 12 restores 12 base units', async () => {
    let restockedBaseQty = 0;
    class MultiUnitReturnDatabase implements Database {
      async query<T extends QueryResultRow>(text: string, values: readonly unknown[] = []) {
        const sql = text.replace(/\s+/g, ' ').trim();
        if (sql.startsWith('select branch_id, status')) {
          return result([{ branch_id: 'branch', status: 'completed' } as unknown as T]);
        }
        if (sql.includes('from register_shifts')) {
          return result([
            {
              opening_cash: '100.00',
              cash_sales: '500.00',
              cash_refunds: '0.00',
              cash_in: '0.00',
              cash_out: '0.00',
            } as unknown as T,
          ]);
        }
        if (sql.startsWith('select si.id, si.product_id')) {
          return result([
            {
              id: '77777777-7777-4777-8777-777777777777',
              product_id: '55555555-5555-4555-8555-555555555555',
              variant_id: '88888888-8888-4888-8888-888888888888',
              quantity: 2,
              returned_quantity: 0,
              line_total: '240.00',
              unit_cost: '5.00',
              track_inventory: true,
              units_per_base: 12,
              portioning_variant_id: null,
            } as unknown as T,
          ]);
        }
        if (sql.startsWith("select 'RET-'")) {
          return result([{ value: 'RET-20260803-00000001' } as unknown as T]);
        }
        if (sql.startsWith('insert into returns')) {
          return result([{ id: 'ret-1', return_number: 'RET-20260803-00000001' } as unknown as T]);
        }
        if (sql.startsWith('update branch_inventory set')) {
          restockedBaseQty = Number(values[3]);
          return result([
            { quantity: restockedBaseQty, sealedQuantity: 0, openedQuantity: 0 } as unknown as T,
          ]);
        }
        return result([]);
      }
      async transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> {
        return work(this);
      }
      async close() {}
    }

    const service = new ReturnService(new MultiUnitReturnDatabase());
    await service.create(
      {
        userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        organizationId: '11111111-1111-4111-8111-111111111111',
      },
      '66666666-6666-4666-8666-666666666666',
      {
        branchId: '22222222-2222-4222-8222-222222222222',
        registerId: '33333333-3333-4333-8333-333333333333',
        shiftId: '44444444-4444-4444-8444-444444444444',
        reason: 'Customer return',
        refundMethod: 'cash',
        items: [{ saleItemId: '77777777-7777-4777-8777-777777777777', quantity: 1 }],
      },
    );
    expect(restockedBaseQty).toBe(12);
  });

  it('partial multi-unit return restores the correct base quantity', async () => {
    let restockedBaseQty = 0;
    class PartialReturnDatabase implements Database {
      async query<T extends QueryResultRow>(text: string, values: readonly unknown[] = []) {
        const sql = text.replace(/\s+/g, ' ').trim();
        if (sql.startsWith('select branch_id, status')) {
          return result([{ branch_id: 'branch', status: 'completed' } as unknown as T]);
        }
        if (sql.includes('from register_shifts')) {
          return result([
            {
              opening_cash: '100.00',
              cash_sales: '500.00',
              cash_refunds: '0.00',
              cash_in: '0.00',
              cash_out: '0.00',
            } as unknown as T,
          ]);
        }
        if (sql.startsWith('select si.id, si.product_id')) {
          return result([
            {
              id: '77777777-7777-4777-8777-777777777777',
              product_id: '55555555-5555-4555-8555-555555555555',
              variant_id: '88888888-8888-4888-8888-888888888888',
              quantity: 5,
              returned_quantity: 1,
              line_total: '600.00',
              unit_cost: '5.00',
              track_inventory: true,
              units_per_base: 24,
              portioning_variant_id: null,
            } as unknown as T,
          ]);
        }
        if (sql.startsWith("select 'RET-'")) {
          return result([{ value: 'RET-20260803-00000002' } as unknown as T]);
        }
        if (sql.startsWith('insert into returns')) {
          return result([{ id: 'ret-2', return_number: 'RET-20260803-00000002' } as unknown as T]);
        }
        if (sql.startsWith('update branch_inventory set')) {
          restockedBaseQty = Number(values[3]);
          return result([
            { quantity: restockedBaseQty, sealedQuantity: 0, openedQuantity: 0 } as unknown as T,
          ]);
        }
        return result([]);
      }
      async transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> {
        return work(this);
      }
      async close() {}
    }

    const service = new ReturnService(new PartialReturnDatabase());
    await service.create(
      {
        userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        organizationId: '11111111-1111-4111-8111-111111111111',
      },
      '66666666-6666-4666-8666-666666666666',
      {
        branchId: '22222222-2222-4222-8222-222222222222',
        registerId: '33333333-3333-4333-8333-333333333333',
        shiftId: '44444444-4444-4444-8444-444444444444',
        reason: 'Customer return',
        refundMethod: 'cash',
        items: [{ saleItemId: '77777777-7777-4777-8777-777777777777', quantity: 2 }],
      },
    );
    // 2 boxes * 24 unitsPerBase = 48 base units
    expect(restockedBaseQty).toBe(48);
  });

  it('changed product conversion after sale does not alter return restoration', async () => {
    let restockedBaseQty = 0;
    class HistoricalConversionReturnDatabase implements Database {
      async query<T extends QueryResultRow>(text: string, values: readonly unknown[] = []) {
        const sql = text.replace(/\s+/g, ' ').trim();
        if (sql.startsWith('select branch_id, status')) {
          return result([{ branch_id: 'branch', status: 'completed' } as unknown as T]);
        }
        if (sql.includes('from register_shifts')) {
          return result([
            {
              opening_cash: '100.00',
              cash_sales: '500.00',
              cash_refunds: '0.00',
              cash_in: '0.00',
              cash_out: '0.00',
            } as unknown as T,
          ]);
        }
        if (sql.startsWith('select si.id, si.product_id')) {
          // Sale item recorded units_per_base = 6 at sale time, even if current variant is updated to 10
          return result([
            {
              id: '77777777-7777-4777-8777-777777777777',
              product_id: '55555555-5555-4555-8555-555555555555',
              variant_id: '88888888-8888-4888-8888-888888888888',
              quantity: 1,
              returned_quantity: 0,
              line_total: '60.00',
              unit_cost: '5.00',
              track_inventory: true,
              units_per_base: 6, // Historical units_per_base stored on sale_item
              portioning_variant_id: null,
            } as unknown as T,
          ]);
        }
        if (sql.startsWith("select 'RET-'")) {
          return result([{ value: 'RET-20260803-00000003' } as unknown as T]);
        }
        if (sql.startsWith('insert into returns')) {
          return result([{ id: 'ret-3', return_number: 'RET-20260803-00000003' } as unknown as T]);
        }
        if (sql.startsWith('update branch_inventory set')) {
          restockedBaseQty = Number(values[3]);
          return result([
            { quantity: restockedBaseQty, sealedQuantity: 0, openedQuantity: 0 } as unknown as T,
          ]);
        }
        return result([]);
      }
      async transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> {
        return work(this);
      }
      async close() {}
    }

    const service = new ReturnService(new HistoricalConversionReturnDatabase());
    await service.create(
      {
        userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        organizationId: '11111111-1111-4111-8111-111111111111',
      },
      '66666666-6666-4666-8666-666666666666',
      {
        branchId: '22222222-2222-4222-8222-222222222222',
        registerId: '33333333-3333-4333-8333-333333333333',
        shiftId: '44444444-4444-4444-8444-444444444444',
        reason: 'Customer return',
        refundMethod: 'cash',
        items: [{ saleItemId: '77777777-7777-4777-8777-777777777777', quantity: 1 }],
      },
    );
    // 1 box * 6 historical units_per_base = 6 base units
    expect(restockedBaseQty).toBe(6);
  });

  it('legacy rows with resolvable variants restore correct base stock', async () => {
    let restockedBaseQty = 0;
    class LegacyRowReturnDatabase implements Database {
      async query<T extends QueryResultRow>(text: string, values: readonly unknown[] = []) {
        const sql = text.replace(/\s+/g, ' ').trim();
        if (sql.startsWith('select branch_id, status')) {
          return result([{ branch_id: 'branch', status: 'completed' } as unknown as T]);
        }
        if (sql.includes('from register_shifts')) {
          return result([
            {
              opening_cash: '100.00',
              cash_sales: '500.00',
              cash_refunds: '0.00',
              cash_in: '0.00',
              cash_out: '0.00',
            } as unknown as T,
          ]);
        }
        if (sql.startsWith('select si.id, si.product_id')) {
          // Legacy row where si.units_per_base was backfilled to variant conversion 12
          return result([
            {
              id: '77777777-7777-4777-8777-777777777777',
              product_id: '55555555-5555-4555-8555-555555555555',
              variant_id: '88888888-8888-4888-8888-888888888888',
              quantity: 1,
              returned_quantity: 0,
              line_total: '120.00',
              unit_cost: '5.00',
              track_inventory: true,
              units_per_base: 12,
              portioning_variant_id: null,
            } as unknown as T,
          ]);
        }
        if (sql.startsWith("select 'RET-'")) {
          return result([{ value: 'RET-20260803-00000004' } as unknown as T]);
        }
        if (sql.startsWith('insert into returns')) {
          return result([{ id: 'ret-4', return_number: 'RET-20260803-00000004' } as unknown as T]);
        }
        if (sql.startsWith('update branch_inventory set')) {
          restockedBaseQty = Number(values[3]);
          return result([
            { quantity: restockedBaseQty, sealedQuantity: 0, openedQuantity: 0 } as unknown as T,
          ]);
        }
        return result([]);
      }
      async transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> {
        return work(this);
      }
      async close() {}
    }

    const service = new ReturnService(new LegacyRowReturnDatabase());
    await service.create(
      {
        userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        organizationId: '11111111-1111-4111-8111-111111111111',
      },
      '66666666-6666-4666-8666-666666666666',
      {
        branchId: '22222222-2222-4222-8222-222222222222',
        registerId: '33333333-3333-4333-8333-333333333333',
        shiftId: '44444444-4444-4444-8444-444444444444',
        reason: 'Customer return',
        refundMethod: 'cash',
        items: [{ saleItemId: '77777777-7777-4777-8777-777777777777', quantity: 1 }],
      },
    );
    expect(restockedBaseQty).toBe(12);
  });
});
