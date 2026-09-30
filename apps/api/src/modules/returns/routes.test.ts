import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { QueryResultRow } from 'pg';
import type { Database } from '../../database/types.js';
import { errorHandler } from '../../middleware/errors.js';
import { result, testUser } from '../../test/fakes.js';
import { returnsRouter } from './routes.js';

const saleId = '66666666-6666-4666-8666-666666666666';

class PinDatabase implements Database {
  readonly statements: string[] = [];

  async query<T extends QueryResultRow>(text: string) {
    this.statements.push(text);
    return result([] as T[]);
  }

  async transaction<T>(work: (transaction: Database) => Promise<T>): Promise<T> {
    return work(this);
  }

  async close() {}
}

describe('returns PIN authorization', () => {
  it('rejects a wrong PIN before any return mutation', async () => {
    const database = new PinDatabase();
    const user = testUser({ modules: ['returns'], permissions: ['returns:create'] });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.authUser = user;
      next();
    });
    app.use('/returns', returnsRouter(database));
    app.use(errorHandler);

    const response = await request(app).post(`/returns/sales/${saleId}`).send({
      branchId: user.branches[0]!.id,
      registerId: '33333333-3333-4333-8333-333333333333',
      shiftId: '44444444-4444-4444-8444-444444444444',
      reason: 'Customer return request',
      refundMethod: 'cash',
      managerPin: '0000',
      items: [{ saleItemId: '77777777-7777-4777-8777-777777777777', quantity: 1 }],
    });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('INVALID_MANAGER_PIN');
    expect(database.statements).toHaveLength(1);
    expect(database.statements[0]).toContain('p.pin=$3');
  });
});
