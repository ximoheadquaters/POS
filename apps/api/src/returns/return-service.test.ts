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
    if (sql.startsWith('select id, product_id')) {
      return result([
        {
          id: '77777777-7777-4777-8777-777777777777',
          product_id: '55555555-5555-4555-8555-555555555555',
          variant_id: null,
          quantity: 2,
          returned_quantity: 1,
          line_total: '30.00',
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
          reason: 'Damaged item',
          refundMethod: 'cash',
          items: [{ saleItemId: '77777777-7777-4777-8777-777777777777', quantity: 2 }],
        },
      ),
    ).rejects.toMatchObject({ code: 'RETURN_QUANTITY_EXCEEDED' });
  });
});
