import { describe, expect, it } from 'vitest';
import type { CheckoutInput } from '@ximo/shared';
import type { QueryResultRow } from 'pg';
import type { Database } from '../database/types.js';
import type { AppError } from '../shared/errors.js';
import { result } from '../test/fakes.js';
import { calculateLine, CheckoutService } from './checkout-service.js';

const actor = {
  userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  organizationId: '11111111-1111-4111-8111-111111111111',
};

const input: CheckoutInput = {
  branchId: '22222222-2222-4222-8222-222222222222',
  registerId: '33333333-3333-4333-8333-333333333333',
  shiftId: '44444444-4444-4444-8444-444444444444',
  items: [{ productId: '55555555-5555-4555-8555-555555555555', quantity: 2 }],
  payments: [{ method: 'cash', amount: '33.60', tendered: '40.00' }],
};

interface State {
  inventory: number;
  sealedInventory: number;
  openedInventory: number;
  ingredientInventory: number;
  ingredientSealedInventory: number;
  ingredientOpenedInventory: number;
  sales: Array<Record<string, string>>;
  payments: number;
  movements: number;
  failOnPayment: boolean;
}

class CheckoutDatabase implements Database {
  state: State = {
    inventory: 10,
    sealedInventory: 0,
    openedInventory: 0,
    ingredientInventory: 0,
    ingredientSealedInventory: 0,
    ingredientOpenedInventory: 0,
    sales: [],
    payments: 0,
    movements: 0,
    failOnPayment: false,
  };
  unitsPerBase = 1;
  sellingUnit = 'piece';
  portioningVariantId: string | null = null;
  trackInventory = true;
  preparationBehavior: 'standard' | 'cook_to_order' | 'preproduced' | null = null;
  recipeQuantityRequired: number | null = null;
  ingredientPortioningVariantId: string | null = null;
  readonly ingredientProductId = '88888888-8888-4888-8888-888888888888';

  async query<T extends QueryResultRow>(text: string, values: readonly unknown[] = []) {
    const sql = text.replace(/\s+/g, ' ').trim();
    if (sql.startsWith('select id, receipt_number')) {
      const sale = this.state.sales.find((entry) => entry.idempotencyKey === values[1]);
      return result(
        sale
          ? ([
              {
                id: sale.id,
                receiptNumber: sale.receiptNumber,
                subtotal: sale.subtotal,
                discountTotal: '0.00',
                taxTotal: sale.taxTotal,
                total: sale.total,
                changeDue: sale.changeDue,
                status: 'completed',
              },
            ] as unknown as T[])
          : [],
      );
    }
    if (sql.startsWith('select b.code as branch_code')) {
      return result([{ branch_code: 'AUTH', allow_negative_inventory: false } as unknown as T]);
    }
    if (sql.startsWith('select p.id as product_id')) {
      return result([
        {
          product_id: input.items[0]!.productId,
          variant_id: (values[3] as string | null) ?? null,
          name: 'Demo Product',
          sku: 'DEMO-1',
          unit_price: '15.00',
          unit_cost: '8.00',
          tax_rate: '12.00',
          is_tax_inclusive: false,
          track_inventory: this.trackInventory,
          preparation_behavior: this.preparationBehavior ?? (this.trackInventory ? 'standard' : 'cook_to_order'),
          units_per_base: this.unitsPerBase,
          selling_unit: this.sellingUnit,
          quantity: this.state.inventory,
          portioning_variant_id: this.portioningVariantId,
          sealed_quantity: this.state.sealedInventory,
          opened_quantity: this.state.openedInventory,
        } as unknown as T,
      ]);
    }
    if (sql.startsWith('select $1 ||')) {
      return result([{ receipt_number: 'AUTH-20260726-00000001' } as unknown as T]);
    }
    if (sql.startsWith('insert into sales')) {
      const sale = {
        id: '66666666-6666-4666-8666-666666666666',
        receiptNumber: String(values[6]),
        idempotencyKey: String(values[7]),
        subtotal: String(values[8]),
        taxTotal: String(values[10]),
        total: String(values[11]),
        changeDue: String(values[13]),
      };
      this.state.sales.push(sale);
      return result([{ id: sale.id } as unknown as T]);
    }
    if (sql.startsWith('select pr.ingredient_product_id')) {
      return result(
        this.recipeQuantityRequired === null
          ? []
          : ([
              {
                ingredient_product_id: this.ingredientProductId,
                ingredient_variant_id: null,
                quantity_required: this.recipeQuantityRequired,
                unit: 'ml',
                base_unit: 'ml',
                portioning_variant_id: this.ingredientPortioningVariantId,
              },
            ] as unknown as T[]),
      );
    }
    if (sql.startsWith('update branch_inventory')) {
      if (values[2] === this.ingredientProductId) {
        const deduction = Number(values[3]);
        const allowNegative = Boolean(values[5]);
        if (
          !allowNegative &&
          (this.state.ingredientInventory < deduction ||
            (this.ingredientPortioningVariantId !== null &&
              this.state.ingredientOpenedInventory < deduction))
        ) {
          return result([]);
        }
        this.state.ingredientInventory -= deduction;
        if (this.ingredientPortioningVariantId) {
          this.state.ingredientOpenedInventory -= deduction;
        }
        return result([
          {
            quantity: this.state.ingredientInventory,
            sealedQuantity: this.state.ingredientSealedInventory,
            openedQuantity: this.state.ingredientOpenedInventory,
          } as unknown as T,
        ]);
      }
      this.state.inventory -= Number(values[3]);
      this.state.sealedInventory -= Number(values[4] ?? 0);
      this.state.openedInventory -= Number(values[5] ?? 0);
      return result([
        {
          quantity: this.state.inventory,
          sealedQuantity: this.state.sealedInventory,
          openedQuantity: this.state.openedInventory,
        } as unknown as T,
      ]);
    }
    if (sql.startsWith('insert into inventory_movements')) {
      this.state.movements += 1;
      return result([]);
    }
    if (sql.startsWith('insert into payments')) {
      if (this.state.failOnPayment) throw new Error('simulated database failure');
      this.state.payments += 1;
      return result([]);
    }
    return result([]);
  }

  async transaction<T>(work: (transaction: Database) => Promise<T>): Promise<T> {
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

describe('checkout transaction', () => {
  it('uses exact integer calculations for tax and totals', () => {
    expect(calculateLine('0.10', '0.03', 3, '12.00', false)).toEqual({
      subtotal: 30n,
      tax: 4n,
      total: 34n,
      cost: 9n,
    });
  });

  it('calculates fractional weight without floating point money drift', () => {
    expect(calculateLine('320.00', '250.00', 0.25, '0.00', false)).toEqual({
      subtotal: 8_000n,
      tax: 0n,
      total: 8_000n,
      cost: 6_250n,
    });
  });

  it('creates the sale, payment and inventory ledger atomically', async () => {
    const database = new CheckoutDatabase();
    const resultValue = await new CheckoutService(database).complete(
      actor,
      input,
      'checkout-key-0001',
    );
    expect(resultValue).toMatchObject({
      total: '33.60',
      changeDue: '6.40',
      replayed: false,
    });
    expect(database.state).toMatchObject({ inventory: 8, payments: 1, movements: 1 });
    expect(database.state.sales).toHaveLength(1);
  });

  it('deducts base pieces when a pack is sold', async () => {
    const database = new CheckoutDatabase();
    database.unitsPerBase = 10;
    database.sellingUnit = 'pack';
    await new CheckoutService(database).complete(
      actor,
      {
        ...input,
        items: [
          {
            productId: input.items[0]!.productId,
            variantId: '77777777-7777-4777-8777-777777777777',
            quantity: 1,
          },
        ],
        payments: [{ method: 'cash', amount: '16.80' }],
      },
      'checkout-pack-0001',
    );
    expect(database.state.inventory).toBe(0);
  });

  it('sells a designated whole container from sealed stock only', async () => {
    const database = new CheckoutDatabase();
    const containerVariantId = '77777777-7777-4777-8777-777777777777';
    database.portioningVariantId = containerVariantId;
    database.unitsPerBase = 1_000;
    database.sellingUnit = 'bottle';
    database.state.inventory = 2_000;
    database.state.sealedInventory = 2;
    database.state.openedInventory = 0;

    await new CheckoutService(database).complete(
      actor,
      {
        ...input,
        items: [
          { productId: input.items[0]!.productId, variantId: containerVariantId, quantity: 1 },
        ],
        payments: [{ method: 'cash', amount: '16.80' }],
      },
      'checkout-sealed-0001',
    );

    expect(database.state.inventory).toBe(1_000);
    expect(database.state.sealedInventory).toBe(1);
    expect(database.state.openedInventory).toBe(0);
  });

  it('sells portions from opened stock without consuming a sealed container', async () => {
    const database = new CheckoutDatabase();
    database.portioningVariantId = '77777777-7777-4777-8777-777777777777';
    database.state.inventory = 1_500;
    database.state.sealedInventory = 1;
    database.state.openedInventory = 500;

    await new CheckoutService(database).complete(
      actor,
      {
        ...input,
        items: [{ productId: input.items[0]!.productId, quantity: 2 }],
      },
      'checkout-opened-0001',
    );

    expect(database.state.inventory).toBe(1_498);
    expect(database.state.sealedInventory).toBe(1);
    expect(database.state.openedInventory).toBe(498);
  });

  it('deducts measured recipe ingredients and keeps the opened-container remainder', async () => {
    const database = new CheckoutDatabase();
    database.trackInventory = false;
    database.recipeQuantityRequired = 500;
    database.state.ingredientInventory = 1_500;
    await new CheckoutService(database).complete(actor, input, 'checkout-recipe-0001');
    expect(database.state.ingredientInventory).toBe(500);
  });

  it('rolls back checkout when a recipe ingredient is insufficient', async () => {
    const database = new CheckoutDatabase();
    database.trackInventory = false;
    database.recipeQuantityRequired = 500;
    database.state.ingredientInventory = 750;
    await expect(
      new CheckoutService(database).complete(actor, input, 'checkout-recipe-0002'),
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_RECIPE_INVENTORY',
    } satisfies Partial<AppError>);
    expect(database.state.ingredientInventory).toBe(750);
    expect(database.state.sales).toHaveLength(0);
  });

  it('does not let a recipe consume sealed ingredient stock', async () => {
    const database = new CheckoutDatabase();
    database.trackInventory = false;
    database.recipeQuantityRequired = 500;
    database.ingredientPortioningVariantId = '99999999-9999-4999-8999-999999999999';
    database.state.ingredientInventory = 1_500;
    database.state.ingredientSealedInventory = 1;
    database.state.ingredientOpenedInventory = 250;

    await expect(
      new CheckoutService(database).complete(actor, input, 'checkout-recipe-pool-0001'),
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_RECIPE_INVENTORY',
    } satisfies Partial<AppError>);
    expect(database.state.ingredientSealedInventory).toBe(1);
    expect(database.state.ingredientOpenedInventory).toBe(250);
  });

  it('does not consume a BOM again when selling tracked finished stock', async () => {
    const database = new CheckoutDatabase();
    database.recipeQuantityRequired = 500;
    database.state.ingredientInventory = 1_500;

    await new CheckoutService(database).complete(actor, input, 'checkout-finished-stock-0001');

    expect(database.state.inventory).toBe(8);
    expect(database.state.ingredientInventory).toBe(1_500);
  });

  it('rolls back the entire checkout when a database step fails', async () => {
    const database = new CheckoutDatabase();
    database.state.failOnPayment = true;
    await expect(
      new CheckoutService(database).complete(actor, input, 'checkout-key-0002'),
    ).rejects.toThrow('simulated database failure');
    expect(database.state).toMatchObject({ inventory: 10, payments: 0, movements: 0 });
    expect(database.state.sales).toHaveLength(0);
  });

  it('replays an idempotent checkout without duplicate records', async () => {
    const database = new CheckoutDatabase();
    const service = new CheckoutService(database);
    await service.complete(actor, input, 'checkout-key-0003');
    const replay = await service.complete(actor, input, 'checkout-key-0003');
    expect(replay.replayed).toBe(true);
    expect(database.state.sales).toHaveLength(1);
    expect(database.state.payments).toBe(1);
  });

  it('prevents checkout with insufficient inventory', async () => {
    const database = new CheckoutDatabase();
    database.state.inventory = 1;
    await expect(
      new CheckoutService(database).complete(actor, input, 'checkout-key-0004'),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_INVENTORY' } satisfies Partial<AppError>);
    expect(database.state.sales).toHaveLength(0);
  });

  it('requires split payments to equal the server-calculated total', async () => {
    const database = new CheckoutDatabase();
    const invalid: CheckoutInput = {
      ...input,
      payments: [
        { method: 'cash', amount: '10.00' },
        { method: 'card', amount: '20.00' },
      ],
    };
    await expect(
      new CheckoutService(database).complete(actor, invalid, 'checkout-key-0005'),
    ).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' } satisfies Partial<AppError>);
    expect(database.state.sales).toHaveLength(0);
  });

  it('honors locked combo unitPrice overrides so payment totals match', async () => {
    const database = new CheckoutDatabase();
    const comboCheckout: CheckoutInput = {
      ...input,
      items: [
        {
          productId: input.items[0]!.productId,
          quantity: 2,
          unitPrice: '10.00',
        },
      ],
      payments: [{ method: 'cash', amount: '22.40', tendered: '22.40' }],
    };
    const resultValue = await new CheckoutService(database).complete(
      actor,
      comboCheckout,
      'checkout-combo-price-0001',
    );
    expect(resultValue.total).toBe('22.40');
    expect(database.state.sales).toHaveLength(1);
  });
});
