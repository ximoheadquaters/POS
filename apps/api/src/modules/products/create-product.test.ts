import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { QueryResultRow } from 'pg';
import type { Database, Queryable } from '../../database/types.js';
import { errorHandler } from '../../middleware/errors.js';
import { result, testUser } from '../../test/fakes.js';
import { productsRouter } from './routes.js';

class ProductCreateDatabase implements Database {
  readonly calls: Array<{ text: string; values?: readonly unknown[] }> = [];

  async query<T extends QueryResultRow>(text: string, values?: readonly unknown[]) {
    this.calls.push(values ? { text, values } : { text });
    if (text.includes('exists(select 1 from product_units')) {
      return result([
        { unitValid: false, categoryValid: true, brandValid: true } as unknown as T,
      ]);
    }
    if (text.includes('insert into products')) {
      return result([
        {
          id: '55555555-5555-4555-8555-555555555555',
          name: values?.[3],
          sku: values?.[4],
          unit: values?.[5],
          inventoryRole: values?.[6],
          preparationBehavior: values?.[7],
          trackInventory: values?.[8],
          sellingPrice: values?.[11],
          taxRate: values?.[12],
          isTaxInclusive: values?.[13],
          status: values?.[14],
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

function productApp(database: Database) {
  const app = express();
  app.use(express.json());
  app.use((incoming, _response, next) => {
    incoming.authUser = testUser({
      role: 'owner',
      permissions: ['products:read', 'products:manage'],
      modules: ['products', 'ingredients'],
    });
    next();
  });
  app.use('/products', productsRouter(database));
  app.use(errorHandler);
  return app;
}

describe('POST /products', () => {
  it('repairs a missing built-in unit before saving an older organization product', async () => {
    const database = new ProductCreateDatabase();
    const response = await request(productApp(database)).post('/products').send({
      branchId: '22222222-2222-4222-8222-222222222222',
      name: 'Bulk sugar',
      sku: 'SUGAR-25KG',
      barcode: null,
      unit: 'kg',
      inventoryRole: 'ingredient',
      preparationBehavior: 'standard',
      trackInventory: true,
      cost: '50.00',
      sellingPrice: '0.00',
      taxRate: '0.00',
      isTaxInclusive: false,
      status: 'active',
      openingQuantity: 0,
      openingContainerQuantity: 0,
      sellingUnits: [],
    });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ name: 'Bulk sugar', unit: 'kg' });
    expect(
      database.calls.some(
        (call) => call.text.includes('insert into product_units') && call.values?.[1] === 'kg',
      ),
    ).toBe(true);
  });
});
