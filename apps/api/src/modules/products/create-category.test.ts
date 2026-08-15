import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { QueryResultRow } from 'pg';
import type { Database, Queryable } from '../../database/types.js';
import { errorHandler } from '../../middleware/errors.js';
import { result, testUser } from '../../test/fakes.js';
import { categoriesRouter } from './routes.js';

class CategoryCreateDatabase implements Database {
  readonly calls: Array<{ text: string; values?: readonly unknown[] }> = [];

  async query<T extends QueryResultRow>(text: string, values?: readonly unknown[]) {
    this.calls.push(values ? { text, values } : { text });
    if (text.includes('insert into categories')) {
      return result([
        {
          id: '66666666-6666-4666-8666-666666666666',
          name: values?.[2],
          description: values?.[3],
          isActive: values?.[4],
        } as unknown as T,
      ]);
    }
    return result([]);
  }

  async transaction<T>(work: (database: Queryable) => Promise<T>) {
    return work(this);
  }

  async close() {}
}

function categoryApp(database: Database) {
  const app = express();
  app.use(express.json());
  app.use((incoming, _response, next) => {
    incoming.authUser = testUser({
      role: 'owner',
      permissions: ['products:read', 'products:manage'],
      modules: ['products'],
    });
    next();
  });
  app.use('/categories', categoriesRouter(database));
  app.use(errorHandler);
  return app;
}

describe('POST /categories', () => {
  it('creates the category inside the authenticated organization and branch', async () => {
    const database = new CategoryCreateDatabase();
    const response = await request(categoryApp(database)).post('/categories').send({
      branchId: '22222222-2222-4222-8222-222222222222',
      name: 'Beverages',
      description: 'Cold and shelf-stable drinks',
      isActive: true,
    });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      name: 'Beverages',
      description: 'Cold and shelf-stable drinks',
      isActive: true,
    });
    const insert = database.calls.find((call) => call.text.includes('insert into categories'));
    expect(insert?.values?.slice(0, 2)).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]);
  });

  it('rejects a stale or foreign branch before writing a category', async () => {
    const database = new CategoryCreateDatabase();
    const response = await request(categoryApp(database)).post('/categories').send({
      branchId: '99999999-9999-4999-8999-999999999999',
      name: 'Foreign branch category',
      isActive: true,
    });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('BRANCH_ACCESS_DENIED');
    expect(database.calls.some((call) => call.text.includes('insert into categories'))).toBe(false);
  });
});
