import type { CheckoutInput } from '@ximo/shared';
import { convertRecipeQuantity, minorToMoney, moneyToMinor } from '@ximo/shared';
import type { Database, Queryable } from '../database/types.js';
import { badRequest, conflict, forbidden, notFound } from '../shared/errors.js';

interface CheckoutContext {
  branch_code: string;
  allow_negative_inventory: boolean;
}

interface ProductRow {
  product_id: string;
  variant_id: string | null;
  name: string;
  sku: string;
  unit_price: string;
  unit_cost: string;
  tax_rate: string;
  is_tax_inclusive: boolean;
  track_inventory: boolean;
  preparation_behavior: 'standard' | 'cook_to_order' | 'preproduced';
  units_per_base: number;
  selling_unit: string;
  unit_kind: 'discrete' | 'decimal';
  quantity: number;
  portioning_variant_id: string | null;
  sealed_quantity: number;
  opened_quantity: number;
}

type InventoryPool = 'shared' | 'sealed' | 'opened';

export interface CheckoutActor {
  userId: string;
  organizationId: string;
}

export interface CheckoutResult {
  id: string;
  receiptNumber: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  changeDue: string;
  status: 'completed';
  replayed: boolean;
}

function divideRounded(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

function percentToHundredths(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

function quantityToThousandths(value: number): bigint {
  return BigInt(Math.round(value * 1_000));
}

export function calculateLine(
  unitPrice: string,
  unitCost: string,
  quantity: number,
  taxRate: string,
  taxInclusive: boolean,
) {
  const price = moneyToMinor(unitPrice);
  const cost = moneyToMinor(unitCost);
  const rateHundredths = percentToHundredths(taxRate);
  const quantityThousandths = quantityToThousandths(quantity);
  const base = divideRounded(price * quantityThousandths, 1_000n);
  const tax = taxInclusive
    ? divideRounded(base * rateHundredths, 10_000n + rateHundredths)
    : divideRounded(base * rateHundredths, 10_000n);
  return {
    subtotal: taxInclusive ? base - tax : base,
    tax,
    total: taxInclusive ? base : base + tax,
    cost: divideRounded(cost * quantityThousandths, 1_000n),
  };
}

export class CheckoutService {
  constructor(private readonly database: Database) {}

  async complete(
    actor: CheckoutActor,
    input: CheckoutInput,
    idempotencyKey: string,
  ): Promise<CheckoutResult> {
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      throw badRequest(
        'INVALID_IDEMPOTENCY_KEY',
        'Idempotency-Key must contain 8 to 200 characters',
      );
    }

    return this.database.transaction(async (transaction) => {
      const previous = await transaction.query<Omit<CheckoutResult, 'replayed'>>(
        `select id, receipt_number as "receiptNumber", subtotal::text,
          discount_total::text as "discountTotal", tax_total::text as "taxTotal",
          total::text, change_due::text as "changeDue", status
         from sales where organization_id = $1 and idempotency_key = $2`,
        [actor.organizationId, idempotencyKey],
      );
      if (previous.rows[0]) return { ...previous.rows[0], replayed: true };

      const context = await this.validateContext(transaction, actor, input);
      const requested = new Map<
        string,
        { productId: string; variantId: string | null; quantity: number }
      >();
      for (const item of input.items) {
        const key = `${item.productId}:${item.variantId ?? ''}`;
        const existing = requested.get(key);
        if (existing) existing.quantity += item.quantity;
        else
          requested.set(key, {
            productId: item.productId,
            variantId: item.variantId ?? null,
            quantity: item.quantity,
          });
      }

      const rows: Array<{
        product: ProductRow;
        quantity: number;
        inventoryQuantity: number;
        inventoryPool: InventoryPool;
      }> = [];
      for (const item of requested.values()) {
        const result = await transaction.query<ProductRow>(
          `select p.id as product_id, v.id as variant_id, p.name,
            coalesce(v.sku, p.sku) as sku,
            coalesce(v.selling_price, p.selling_price)::text as unit_price,
            coalesce(
              case when p.track_inventory
                then coalesce(bi.average_cost, v.cost, p.cost, 0) * coalesce(v.units_per_base,1)
                else coalesce(v.cost, p.cost, 0) * coalesce(v.units_per_base,1)
              end, 0
            )::text as unit_cost,
            p.tax_rate::text, p.is_tax_inclusive, p.track_inventory,
            coalesce(p.preparation_behavior, 'standard') as preparation_behavior,
            coalesce(v.units_per_base,1)::float8 as units_per_base,
            coalesce(v.unit,p.unit) as selling_unit,
            pu.kind as unit_kind,
            coalesce(bi.quantity, 0)::float8 as quantity,
            portioning.id as portioning_variant_id,
            coalesce(bi.sealed_quantity, 0)::float8 as sealed_quantity,
            coalesce(bi.opened_quantity, 0)::float8 as opened_quantity
           from products p
           left join product_variants v
             on v.product_id = p.id and v.organization_id = p.organization_id and v.id = $4
           join product_units pu
             on pu.organization_id=p.organization_id and pu.code=coalesce(v.unit,p.unit)
           left join branch_inventory bi
             on bi.organization_id = p.organization_id and bi.branch_id = $2
             and bi.product_id = p.id and bi.variant_id is null
           left join product_variants portioning
             on portioning.organization_id=p.organization_id
             and portioning.product_id=p.id and portioning.is_portioning_container
           where p.organization_id = $1 and p.branch_id = $2
             and p.id = $3 and p.status = 'active'
             and ($4::uuid is null or v.id is not null)`,
          [actor.organizationId, input.branchId, item.productId, item.variantId],
        );
        const product = result.rows[0];
        if (!product) throw notFound('Product or branch inventory');
        if (product.unit_kind === 'discrete' && !Number.isInteger(item.quantity)) {
          throw badRequest(
            'INVALID_SELLING_QUANTITY',
            `${product.name} must be sold in whole ${product.selling_unit} quantities`,
          );
        }
        const inventoryQuantity = item.quantity * product.units_per_base;
        const inventoryPool: InventoryPool = product.portioning_variant_id
          ? product.variant_id === product.portioning_variant_id
            ? 'sealed'
            : 'opened'
          : 'shared';
        const availableQuantity =
          inventoryPool === 'sealed'
            ? product.sealed_quantity
            : inventoryPool === 'opened'
              ? product.opened_quantity
              : product.quantity;
        const requiredQuantity = inventoryPool === 'sealed' ? item.quantity : inventoryQuantity;
        if (
          product.track_inventory &&
          !context.allow_negative_inventory &&
          availableQuantity < requiredQuantity
        ) {
          const poolLabel =
            inventoryPool === 'sealed'
              ? 'sealed container'
              : inventoryPool === 'opened'
                ? 'opened portion'
                : '';
          throw conflict(
            'INSUFFICIENT_INVENTORY',
            `${product.name} has insufficient ${poolLabel} inventory`.replace('  ', ' '),
          );
        }
        rows.push({ product, quantity: item.quantity, inventoryQuantity, inventoryPool });
      }
      if (!context.allow_negative_inventory) {
        const inventoryDemand = new Map<
          string,
          { name: string; requested: number; available: number; tracked: boolean }
        >();
        for (const row of rows) {
          const demandKey = `${row.product.product_id}:${row.inventoryPool}`;
          const requestedQuantity =
            row.inventoryPool === 'sealed' ? row.quantity : row.inventoryQuantity;
          const availableQuantity =
            row.inventoryPool === 'sealed'
              ? row.product.sealed_quantity
              : row.inventoryPool === 'opened'
                ? row.product.opened_quantity
                : row.product.quantity;
          const demand = inventoryDemand.get(demandKey);
          if (demand) demand.requested += requestedQuantity;
          else {
            inventoryDemand.set(demandKey, {
              name: row.product.name,
              requested: requestedQuantity,
              available: availableQuantity,
              tracked: row.product.track_inventory,
            });
          }
        }
        for (const demand of inventoryDemand.values()) {
          if (demand.tracked && demand.requested > demand.available) {
            throw conflict(
              'INSUFFICIENT_INVENTORY',
              `${demand.name} has insufficient shared inventory`,
            );
          }
        }
      }

      let subtotal = 0n;
      let taxTotal = 0n;
      let totalBeforeDiscount = 0n;
      let costTotal = 0n;
      const calculated = rows.map(({ product, quantity, inventoryQuantity, inventoryPool }) => {
        const line = calculateLine(
          product.unit_price,
          product.unit_cost,
          quantity,
          product.tax_rate,
          product.is_tax_inclusive,
        );
        subtotal += line.subtotal;
        taxTotal += line.tax;
        totalBeforeDiscount += line.total;
        costTotal += line.cost;
        return { product, quantity, inventoryQuantity, inventoryPool, line };
      });

      let discountTotal = 0n;
      if (input.discount?.type === 'fixed') {
        discountTotal = moneyToMinor(input.discount.value);
      } else if (input.discount?.type === 'percentage') {
        const rate = percentToHundredths(input.discount.value);
        discountTotal = divideRounded(totalBeforeDiscount * rate, 10_000n);
      }
      if (discountTotal > totalBeforeDiscount) {
        throw badRequest('INVALID_DISCOUNT', 'Discount cannot exceed the sale total');
      }
      const finalTotal = totalBeforeDiscount - discountTotal;
      const paidTotal = input.payments.reduce(
        (sum, payment) => sum + moneyToMinor(payment.amount),
        0n,
      );
      if (paidTotal !== finalTotal) {
        throw badRequest('PAYMENT_MISMATCH', 'Split payment amounts must equal the final total');
      }
      let changeDue = 0n;
      for (const payment of input.payments) {
        if (payment.method !== 'cash' && payment.tendered) {
          throw badRequest('INVALID_TENDER', 'Tendered amount is only valid for cash');
        }
        if (payment.method === 'cash') {
          const amount = moneyToMinor(payment.amount);
          const tendered = moneyToMinor(payment.tendered ?? payment.amount);
          if (tendered < amount)
            throw badRequest('INSUFFICIENT_TENDER', 'Cash received is too low');
          changeDue += tendered - amount;
        }
      }

      const receipt = await transaction.query<{ receipt_number: string }>(
        `select $1 || '-' || to_char(now() at time zone 'UTC','YYYYMMDD') || '-' ||
          lpad(nextval('receipt_number_seq')::text, 8, '0') as receipt_number`,
        [context.branch_code],
      );
      const receiptNumber = receipt.rows[0]!.receipt_number;
      const sale = await transaction.query<{ id: string }>(
        `insert into sales (
          organization_id, branch_id, register_id, shift_id, cashier_id, customer_id,
          receipt_number, idempotency_key, status, subtotal, discount_total, tax_total,
          total, cost_total, change_due, note, completed_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,'completed',$9,$10,$11,$12,$13,$14,$15,now())
         returning id`,
        [
          actor.organizationId,
          input.branchId,
          input.registerId,
          input.shiftId,
          actor.userId,
          input.customerId ?? null,
          receiptNumber,
          idempotencyKey,
          minorToMoney(subtotal),
          minorToMoney(discountTotal),
          minorToMoney(taxTotal),
          minorToMoney(finalTotal),
          minorToMoney(costTotal),
          minorToMoney(changeDue),
          input.note ?? null,
        ],
      );
      const saleId = sale.rows[0]!.id;

      let allocatedSoFar = 0n;
      for (const [index, item] of calculated.entries()) {
        const allocatedDiscount =
          index === calculated.length - 1
            ? discountTotal - allocatedSoFar
            : totalBeforeDiscount === 0n
              ? 0n
              : divideRounded(discountTotal * item.line.total, totalBeforeDiscount);
        allocatedSoFar += allocatedDiscount;
        await transaction.query(
          `insert into sale_items (
            organization_id, sale_id, product_id, variant_id, product_name, sku, quantity,
            unit_price, unit_cost, discount_total, tax_total, line_total, units_per_base
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            actor.organizationId,
            saleId,
            item.product.product_id,
            item.product.variant_id,
            item.product.name,
            item.product.sku,
            item.quantity,
            item.product.unit_price,
            item.product.unit_cost ?? '0.00',
            minorToMoney(allocatedDiscount),
            minorToMoney(item.line.tax),
            minorToMoney(item.line.total - allocatedDiscount),
            item.product.units_per_base,
          ],
        );
        if (item.product.track_inventory) {
          const sealedDeduction = item.inventoryPool === 'sealed' ? item.quantity : 0;
          const openedDeduction = item.inventoryPool === 'opened' ? item.inventoryQuantity : 0;
          const inventory = await transaction.query<{
            quantity: number;
            sealedQuantity: number;
            openedQuantity: number;
          }>(
            `update branch_inventory set
               quantity = quantity - $4,
               inventory_value = round(average_cost * (quantity - $4), 4),
               sealed_quantity = sealed_quantity - $5,
               opened_quantity = opened_quantity - $6,
               updated_at = now()
             where organization_id = $1 and branch_id = $2 and product_id = $3
               and variant_id is null
             returning quantity::float8 as quantity,
               sealed_quantity::float8 as "sealedQuantity",
               opened_quantity::float8 as "openedQuantity"`,
            [
              actor.organizationId,
              input.branchId,
              item.product.product_id,
              item.inventoryQuantity,
              sealedDeduction,
              openedDeduction,
            ],
          );
          let afterQty = inventory.rows[0]?.quantity;
          if (afterQty === undefined) {
            const upsertInv = await transaction.query<{ quantity: number }>(
              `insert into branch_inventory (
                 organization_id, branch_id, product_id, variant_id, quantity, average_cost, inventory_value
               ) values ($1, $2, $3, null, -$4, $5, 0)
               on conflict (organization_id, branch_id, product_id) where variant_id is null
               do update set quantity = branch_inventory.quantity - $4, updated_at = now()
               returning quantity::float8 as quantity`,
              [
                actor.organizationId,
                input.branchId,
                item.product.product_id,
                item.inventoryQuantity,
                item.product.unit_cost ?? '0.00',
              ],
            );
            afterQty = upsertInv.rows[0]?.quantity ?? -item.inventoryQuantity;
          }

          await transaction.query(
            `insert into inventory_movements (
              organization_id, branch_id, product_id, variant_id, movement_type,
              quantity_delta, quantity_after, reason, reference_type, reference_id, created_by
             ) values ($1,$2,$3,$4,'sale',$5,$6,'POS sale','sale',$7,$8)`,
            [
              actor.organizationId,
              input.branchId,
              item.product.product_id,
              item.product.variant_id,
              -item.inventoryQuantity,
              afterQty,
              saleId,
              actor.userId,
            ],
          );
          if (item.inventoryPool !== 'shared') {
            await transaction.query(
              `insert into inventory_pool_movements (
                organization_id,branch_id,product_id,container_variant_id,movement_type,
                sealed_quantity_delta,opened_quantity_delta,sealed_quantity_after,
                opened_quantity_after,reason,reference_type,reference_id,created_by
               ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'POS sale','sale',$10,$11)`,
              [
                actor.organizationId,
                input.branchId,
                item.product.product_id,
                item.product.portioning_variant_id,
                item.inventoryPool === 'sealed' ? 'whole_sale' : 'portion_sale',
                -sealedDeduction,
                -openedDeduction,
                inventory.rows[0]?.sealedQuantity ?? 0,
                inventory.rows[0]?.openedQuantity ?? 0,
                saleId,
                actor.userId,
              ],
            );
          }
        }

        // Cooked-to-order products consume their BOM at checkout. Preproduced and standard
        // products do not consume BOM at checkout.
        const recipeRes = item.product.preparation_behavior === 'cook_to_order'
          ? await transaction.query<{
              ingredient_product_id: string;
              ingredient_variant_id: string | null;
              quantity_required: number;
              unit: string;
              base_unit: string;
              portioning_variant_id: string | null;
            }>(
              `select pr.ingredient_product_id, pr.ingredient_variant_id, pr.quantity_required::float8 as quantity_required,
                  pr.unit, p.unit as base_unit,portioning.id as portioning_variant_id
           from product_recipes pr
           join products p on p.id = pr.ingredient_product_id and p.organization_id = pr.organization_id
           left join product_variants portioning
             on portioning.organization_id=p.organization_id
             and portioning.product_id=p.id and portioning.is_portioning_container
           where pr.organization_id = $1 and pr.parent_product_id = $2`,
              [actor.organizationId, item.product.product_id],
            )
          : { rows: [] };

        for (const ingredient of recipeRes.rows) {
          const effectiveQty = convertRecipeQuantity(
            ingredient.quantity_required,
            ingredient.unit,
            ingredient.base_unit,
          );
          const totalDeduction = effectiveQty * item.quantity;
          const ingredientInv = await transaction.query<{
            quantity: number;
            sealedQuantity: number;
            openedQuantity: number;
          }>(
            `update branch_inventory set
               quantity = quantity - $4,
               inventory_value = round(average_cost * (quantity - $4), 4),
               opened_quantity = opened_quantity - case when $7::uuid is null then 0 else $4 end,
               updated_at = now()
             where organization_id = $1 and branch_id = $2 and product_id = $3
               and variant_id is not distinct from $5::uuid
               and ($6::boolean or quantity >= $4)
               and ($7::uuid is null or $6::boolean or opened_quantity >= $4)
             returning quantity::float8 as quantity,
               sealed_quantity::float8 as "sealedQuantity",
               opened_quantity::float8 as "openedQuantity"`,
            [
              actor.organizationId,
              input.branchId,
              ingredient.ingredient_product_id,
              totalDeduction,
              ingredient.ingredient_variant_id ?? null,
              context.allow_negative_inventory,
              ingredient.portioning_variant_id,
            ],
          );

          if (!ingredientInv.rows[0]) {
            throw conflict(
              'INSUFFICIENT_RECIPE_INVENTORY',
              `${item.product.name} cannot be completed because an ingredient has insufficient inventory`,
            );
          }
          await transaction.query(
            `insert into inventory_movements (
               organization_id, branch_id, product_id, variant_id, movement_type,
               quantity_delta, quantity_after, reason, reference_type, reference_id, created_by
             ) values ($1,$2,$3,$4,'recipe_deduction',$5,$6,$7,'sale',$8,$9)`,
            [
              actor.organizationId,
              input.branchId,
              ingredient.ingredient_product_id,
              ingredient.ingredient_variant_id ?? null,
              -totalDeduction,
              ingredientInv.rows[0].quantity,
              `Recipe deduction for ${item.product.name}`,
              saleId,
              actor.userId,
            ],
          );
          if (ingredient.portioning_variant_id) {
            await transaction.query(
              `insert into inventory_pool_movements (
                organization_id,branch_id,product_id,container_variant_id,movement_type,
                sealed_quantity_delta,opened_quantity_delta,sealed_quantity_after,
                opened_quantity_after,reason,reference_type,reference_id,created_by
               ) values ($1,$2,$3,$4,'recipe_deduction',0,$5,$6,$7,$8,
                 'sale',$9,$10)`,
              [
                actor.organizationId,
                input.branchId,
                ingredient.ingredient_product_id,
                ingredient.portioning_variant_id,
                -totalDeduction,
                ingredientInv.rows[0]?.sealedQuantity ?? 0,
                ingredientInv.rows[0]?.openedQuantity ?? 0,
                `Recipe deduction for ${item.product.name}`,
                saleId,
                actor.userId,
              ],
            );
          }
        }
      }

      for (const payment of input.payments) {
        await transaction.query(
          `insert into payments (organization_id, sale_id, method, amount, tendered, reference)
           values ($1,$2,$3,$4,$5,$6)`,
          [
            actor.organizationId,
            saleId,
            payment.method,
            payment.amount,
            payment.tendered ?? null,
            payment.reference ?? null,
          ],
        );
      }
      const cashTotal = input.payments
        .filter((payment) => payment.method === 'cash')
        .reduce((sum, payment) => sum + moneyToMinor(payment.amount), 0n);
      await transaction.query(
        `update register_shifts set cash_sales = cash_sales + $3, updated_at = now()
         where id = $1 and organization_id = $2 and status = 'open'`,
        [input.shiftId, actor.organizationId, minorToMoney(cashTotal)],
      );
      await transaction.query(
        `insert into audit_logs (
          organization_id, branch_id, actor_id, action, entity_type, entity_id, after_data
         ) values ($1,$2,$3,'sale.completed','sale',$4,$5::jsonb)`,
        [
          actor.organizationId,
          input.branchId,
          actor.userId,
          saleId,
          JSON.stringify({ receiptNumber, total: minorToMoney(finalTotal) }),
        ],
      );
      return {
        id: saleId,
        receiptNumber,
        subtotal: minorToMoney(subtotal),
        discountTotal: minorToMoney(discountTotal),
        taxTotal: minorToMoney(taxTotal),
        total: minorToMoney(finalTotal),
        changeDue: minorToMoney(changeDue),
        status: 'completed',
        replayed: false,
      };
    });
  }

  private async validateContext(
    transaction: Queryable,
    actor: CheckoutActor,
    input: CheckoutInput,
  ): Promise<CheckoutContext> {
    const result = await transaction.query<CheckoutContext>(
      `select b.code as branch_code, os.allow_negative_inventory
       from branches b
       join registers r on r.organization_id = b.organization_id and r.branch_id = b.id
       join register_shifts rs on rs.organization_id = r.organization_id and rs.register_id = r.id
       join organization_settings os on os.organization_id = b.organization_id
       where b.organization_id = $1 and b.id = $2 and b.is_active
         and r.id = $3 and r.is_active and rs.id = $4 and rs.status = 'open'
       for update of rs`,
      [actor.organizationId, input.branchId, input.registerId, input.shiftId],
    );
    if (!result.rows[0]) {
      throw forbidden('INVALID_CHECKOUT_CONTEXT', 'Branch, register, or active shift is invalid');
    }
    if (input.customerId) {
      const customer = await transaction.query(
        `select 1 from customers
         where id = $1 and organization_id = $2 and branch_id = $3 and is_active`,
        [input.customerId, actor.organizationId, input.branchId],
      );
      if (!customer.rowCount) throw notFound('Customer');
    }
    return result.rows[0];
  }
}
