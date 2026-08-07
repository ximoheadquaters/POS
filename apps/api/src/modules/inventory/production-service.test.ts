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
    if (sql.startsWith('insert into branch_inventory')) {
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

  it('multiplies fractional BOM line quantity (0.5kg per unit) by output quantity and base cost', async () => {
    class FractionalBomDatabase implements Database {
      async query<T extends QueryResultRow>(text: string) {
        const sql = text.replace(/\s+/g, ' ').trim();
        if (sql.startsWith('select allow_negative_inventory')) {
          return result([{ allowNegativeInventory: false } as unknown as T]);
        }
        if (sql.startsWith('select p.id,p.name,p.sku')) {
          return result([
            {
              id: 'finished-frac',
              name: 'White Sugar 500g',
              sku: 'SUGAR-500G',
              unit: 'piece',
              unitKind: 'discrete',
              quantity: 0,
            } as unknown as T,
          ]);
        }
        if (sql.startsWith('select pr.ingredient_product_id')) {
          return result([
            {
              ingredientProductId: 'raw-sugar',
              ingredientName: 'Bulk White Sugar',
              ingredientVariantId: null,
              quantityRequired: 0.5, // 0.5 kg per pack
              recipeUnit: 'kg',
              baseUnit: 'kg',
              quantity: 100,
              averageCost: 40, // ₱40/kg
              sealedQuantity: 0,
              openedQuantity: 0,
              portioningVariantId: null,
              containerName: null,
              containerUnit: null,
              unitsPerBase: null,
            } as unknown as T,
          ]);
        }
        if (sql.startsWith("select b.code || '-PRD-'")) {
          return result([{ batchNumber: 'MAIN-PRD-20260803-000004' } as unknown as T]);
        }
        if (sql.startsWith('insert into production_batches')) {
          return result([{ id: 'batch-4' } as unknown as T]);
        }
        if (sql.startsWith('update branch_inventory set quantity=quantity-$4')) {
          return result([{ quantity: 95, sealedQuantity: 0, openedQuantity: 0 } as unknown as T]);
        }
        if (sql.startsWith('update branch_inventory set quantity=quantity+$4')) {
          return result([{ quantity: 10, averageCost: '20.00', inventoryValue: '200.00' } as unknown as T]);
        }
        return result([]);
      }
      async transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> {
        return work(this);
      }
      async close() {}
    }

    const recorded = await new ProductionService(new FractionalBomDatabase()).create(
      { userId: 'user-1', organizationId: 'org-1' },
      { branchId: 'branch-1', productId: 'finished-frac', quantityProduced: 10 },
    );

    // 10 units produced * 0.5 kg/unit = 5 kg consumed. 5 kg * ₱40/kg = ₱200 total cost. ₱200 / 10 units = ₱20/unit.
    expect(recorded.totalCost).toBe('200.0000');
    expect(recorded.unitCost).toBe('20.0000');
    expect(recorded.ingredients[0]!.quantityConsumed).toBe(5);
  });

  it('sums multiple BOM lines (raw bulk + packaging materials) into finished cost', async () => {
    class MultiBomDatabase implements Database {
      state = { rawStock: 100, pouchStock: 50 };
      async query<T extends QueryResultRow>(text: string) {
        const sql = text.replace(/\s+/g, ' ').trim();
        if (sql.startsWith('select allow_negative_inventory')) {
          return result([{ allowNegativeInventory: false } as unknown as T]);
        }
        if (sql.startsWith('select p.id,p.name,p.sku')) {
          return result([
            {
              id: 'finished-1',
              name: 'Packaged Coffee 250g',
              sku: 'COFFEE-250G',
              unit: 'piece',
              unitKind: 'discrete',
              quantity: 0,
            } as unknown as T,
          ]);
        }
        if (sql.startsWith('select pr.ingredient_product_id')) {
          // 2 BOM lines: 1 bulk raw coffee bean (0.25kg @ ₱100/kg = ₱25), 1 plastic pouch (1 pouch @ ₱5/pouch = ₱5)
          return result([
            {
              ingredientProductId: 'bulk-coffee',
              ingredientName: 'Bulk Coffee Beans',
              ingredientVariantId: null,
              quantityRequired: 0.25,
              recipeUnit: 'kg',
              baseUnit: 'kg',
              quantity: 100,
              averageCost: 100,
              sealedQuantity: 0,
              openedQuantity: 0,
              portioningVariantId: null,
              containerName: null,
              containerUnit: null,
              unitsPerBase: null,
            } as unknown as T,
            {
              ingredientProductId: 'plastic-pouch',
              ingredientName: 'Plastic Pouch 250g',
              ingredientVariantId: null,
              quantityRequired: 1,
              recipeUnit: 'piece',
              baseUnit: 'piece',
              quantity: 50,
              averageCost: 5,
              sealedQuantity: 0,
              openedQuantity: 0,
              portioningVariantId: null,
              containerName: null,
              containerUnit: null,
              unitsPerBase: null,
            } as unknown as T,
          ]);
        }
        if (sql.startsWith("select b.code || '-PRD-'")) {
          return result([{ batchNumber: 'MAIN-PRD-20260803-000002' } as unknown as T]);
        }
        if (sql.startsWith('insert into production_batches')) {
          return result([{ id: 'batch-2' } as unknown as T]);
        }
        if (sql.startsWith('update branch_inventory set quantity=quantity-$4')) {
          return result([{ quantity: 10, sealedQuantity: 0, openedQuantity: 0 } as unknown as T]);
        }
        if (sql.startsWith('update branch_inventory set quantity=quantity+$4')) {
          return result([{ quantity: 10, averageCost: '30.00', inventoryValue: '300.00' } as unknown as T]);
        }
        return result([]);
      }
      async transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> {
        return work(this);
      }
      async close() {}
    }

    const recorded = await new ProductionService(new MultiBomDatabase()).create(
      {
        userId: 'user-1',
        organizationId: 'org-1',
      },
      {
        branchId: 'branch-1',
        productId: 'finished-1',
        quantityProduced: 10,
      },
    );

    // 10 packs: (0.25kg * 10 * ₱100 = ₱250 raw) + (1 pouch * 10 * ₱5 = ₱50 packaging) = ₱300 total (₱30/unit)
    expect(recorded.totalCost).toBe('300.0000');
    expect(recorded.unitCost).toBe('30.0000');
    expect(recorded.ingredients).toHaveLength(2);
  });

  it('rolls back transaction on failed BOM consumption', async () => {
    class FailingBomDatabase implements Database {
      rolledBack = false;
      async query<T extends QueryResultRow>(text: string) {
        const sql = text.replace(/\s+/g, ' ').trim();
        if (sql.startsWith('select allow_negative_inventory')) {
          return result([{ allowNegativeInventory: false } as unknown as T]);
        }
        if (sql.startsWith('select p.id,p.name,p.sku')) {
          return result([
            {
              id: 'finished-1',
              name: 'Packaged Coffee 250g',
              sku: 'COFFEE-250G',
              unit: 'piece',
              unitKind: 'discrete',
              quantity: 0,
            } as unknown as T,
          ]);
        }
        if (sql.startsWith('select pr.ingredient_product_id')) {
          return result([
            {
              ingredientProductId: 'bulk-coffee',
              ingredientName: 'Bulk Coffee Beans',
              ingredientVariantId: null,
              quantityRequired: 1,
              recipeUnit: 'kg',
              baseUnit: 'kg',
              quantity: 0, // Insufficient stock
              averageCost: 100,
              sealedQuantity: 0,
              openedQuantity: 0,
              portioningVariantId: null,
              containerName: null,
              containerUnit: null,
              unitsPerBase: null,
            } as unknown as T,
          ]);
        }
        if (sql.startsWith("select b.code || '-PRD-'")) {
          return result([{ batchNumber: 'MAIN-PRD-20260803-000003' } as unknown as T]);
        }
        if (sql.startsWith('insert into production_batches')) {
          return result([{ id: 'batch-3' } as unknown as T]);
        }
        if (sql.startsWith('update branch_inventory set quantity=quantity-$4')) {
          return result([]); // Update returns 0 rows due to insufficient stock
        }
        return result([]);
      }
      async transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> {
        try {
          return await work(this);
        } catch (err) {
          this.rolledBack = true;
          throw err;
        }
      }
      async close() {}
    }

    const db = new FailingBomDatabase();
    await expect(
      new ProductionService(db).create(
        { userId: 'user-1', organizationId: 'org-1' },
        { branchId: 'branch-1', productId: 'finished-1', quantityProduced: 5 },
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_PRODUCTION_INVENTORY' });
    expect(db.rolledBack).toBe(true);
  });

  it('previews repacking requirement and estimated costs without writing to database', async () => {
    const service = new ProductionService(new ProductionDatabase());
    const preview = await service.preview(
      { userId: 'user-1', organizationId: 'org-1' },
      {
        branchId: '11111111-1111-4111-8111-111111111111',
        productId: '55555555-5555-4555-8555-555555555555',
        quantity: 10,
      },
    );

    expect(preview.quantity).toBe(10);
    expect(preview.canProduce).toBe(true);
    expect(preview.requirements).toHaveLength(1);
    expect(preview.requirements[0]?.requiredQuantity).toBe(1); // 0.1 kg * 10
    expect(preview.estimatedTotalCost).toBe('40.00');
    expect(preview.estimatedUnitCost).toBe('4.00');
  });
});
