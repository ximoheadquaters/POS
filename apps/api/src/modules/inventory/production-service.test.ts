import { describe, expect, it } from 'vitest';
import type { QueryResultRow } from 'pg';
import type { Database } from '../../database/types.js';
import { result } from '../../test/fakes.js';
import { ProductionService } from './production-service.js';

class ProductionDatabase implements Database {
  state = {
    rawQuantity: 50,
    rawSealed: 5,
    rawOpened: 0,
    finishedQuantity: 0,
    finishedValue: 0,
  };

  async query<T extends QueryResultRow>(text: string, values: readonly unknown[] = []) {
    const sql = text.replace(/\s+/g, ' ').trim();
    if (sql.startsWith('select allow_negative_inventory')) {
      return result([{ allowNegativeInventory: false } as unknown as T]);
    }
    if (sql.startsWith('select p.id,p.name,p.sku')) {
      return result([
        {
          id: '55555555-5555-4555-8555-555555555555',
          name: 'Brown Sugar 100g',
          sku: 'SUGAR-100G',
          unit: 'piece',
          unitKind: 'discrete',
          quantity: this.state.finishedQuantity,
        } as unknown as T,
      ]);
    }
    if (sql.startsWith('select pr.ingredient_product_id')) {
      return result([
        {
          ingredientProductId: '88888888-8888-4888-8888-888888888888',
          ingredientName: 'Brown Sugar 10kg Sack',
          ingredientVariantId: null,
          quantityRequired: 0.1,
          recipeUnit: 'kg',
          baseUnit: 'kg',
          quantity: this.state.rawQuantity,
          averageCost: 40,
          sealedQuantity: this.state.rawSealed,
          openedQuantity: this.state.rawOpened,
          portioningVariantId: '99999999-9999-4999-8999-999999999999',
          containerName: '10kg sack',
          containerUnit: 'sack',
          unitsPerBase: 10,
        } as unknown as T,
      ]);
    }
    if (sql.startsWith("select b.code || '-PRD-'")) {
      return result([{ batchNumber: 'MAIN-PRD-20260802-000001' } as unknown as T]);
    }
    if (sql.startsWith('insert into production_batches')) {
      return result([{ id: '77777777-7777-4777-8777-777777777777' } as unknown as T]);
    }
    if (sql.startsWith('update branch_inventory set sealed_quantity')) {
      const containers = Number(values[3]);
      const unitsPerBase = Number(values[4]);
      this.state.rawSealed -= containers;
      this.state.rawOpened += containers * unitsPerBase;
      return result([
        {
          sealedQuantity: this.state.rawSealed,
          openedQuantity: this.state.rawOpened,
        } as unknown as T,
      ]);
    }
    if (sql.startsWith('update branch_inventory set quantity=quantity-$4')) {
      const consumed = Number(values[3]);
      this.state.rawQuantity -= consumed;
      this.state.rawOpened -= consumed;
      return result([
        {
          quantity: this.state.rawQuantity,
          sealedQuantity: this.state.rawSealed,
          openedQuantity: this.state.rawOpened,
        } as unknown as T,
      ]);
    }
    if (sql.startsWith('update branch_inventory set quantity=quantity+$4')) {
      const produced = Number(values[3]);
      const totalCost = Number(values[4]);
      this.state.finishedQuantity += produced;
      this.state.finishedValue += totalCost;
      return result([
        {
          quantity: this.state.finishedQuantity,
          averageCost: String(this.state.finishedValue / this.state.finishedQuantity),
          inventoryValue: String(this.state.finishedValue),
        } as unknown as T,
      ]);
    }
    return result([]);
  }

  async transaction<T>(work: (database: Database) => Promise<T>): Promise<T> {
    const snapshot = structuredClone(this.state);
    try {
      return await work(this);
    } catch (error) {
      this.state = snapshot;
      throw error;
    }
  }

  async close() {}
}

describe('inventory production', () => {
  it('opens one sack, consumes 1kg, and creates ten finished packs atomically', async () => {
    const database = new ProductionDatabase();
    const recorded = await new ProductionService(database).create(
      {
        userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        organizationId: '11111111-1111-4111-8111-111111111111',
      },
      {
        branchId: '22222222-2222-4222-8222-222222222222',
        productId: '55555555-5555-4555-8555-555555555555',
        quantityProduced: 10,
      },
    );

    expect(database.state).toEqual({
      rawQuantity: 49,
      rawSealed: 4,
      rawOpened: 9,
      finishedQuantity: 10,
      finishedValue: 40,
    });
    expect(recorded).toMatchObject({
      batchNumber: 'MAIN-PRD-20260802-000001',
      quantityProduced: 10,
      unitCost: '4.0000',
      totalCost: '40.0000',
      ingredients: [{ quantityConsumed: 1, containersOpened: 1 }],
    });
  });
});
