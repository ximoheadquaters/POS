import type { HoldSaleInput } from '@ximo/shared';
import { minorToMoney } from '@ximo/shared';
import type { Database, Queryable } from '../database/types.js';
import { badRequest, forbidden, notFound } from '../shared/errors.js';
import { calculateLine } from './checkout-service.js';

interface HoldContext {
  branch_code: string;
  register_id: string;
}

interface HeldProductRow {
  product_id: string;
  variant_id: string | null;
  name: string;
  sku: string;
  unit_price: string;
  unit_cost: string;
  tax_rate: string;
  is_tax_inclusive: boolean;
  units_per_base: number;
  selling_unit: string;
  unit_kind: 'discrete' | 'decimal';
}

export interface HoldSaleActor {
  userId: string;
  organizationId: string;
}

export interface HoldSaleResult {
  id: string;
  receiptNumber: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  itemCount: number;
  replayed: boolean;
}

/**
 * Persists a cart without taking payment or deducting inventory. Prices, costs,
 * taxes, and selling-unit conversions are snapshotted so the parked-order list
 * remains accurate. Inventory is validated and deducted only at checkout.
 */
export class HoldSaleService {
  constructor(private readonly database: Database) {}

  async hold(
    actor: HoldSaleActor,
    input: HoldSaleInput,
    idempotencyKey: string,
  ): Promise<HoldSaleResult> {
    if (!input.shiftId) {
      throw badRequest('SHIFT_REQUIRED', 'Open a register shift before holding a sale');
    }
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      throw badRequest(
        'INVALID_IDEMPOTENCY_KEY',
        'Idempotency-Key must contain 8 to 200 characters',
      );
    }

    return this.database.transaction(async (transaction) => {
      const previous = await transaction.query<{
        id: string;
        receiptNumber: string;
        subtotal: string;
        taxTotal: string;
        total: string;
        itemCount: number;
      }>(
        `select s.id, s.receipt_number as "receiptNumber", s.subtotal::text,
           s.tax_total::text as "taxTotal", s.total::text,
           (select count(*)::int from sale_items si where si.sale_id = s.id) as "itemCount"
         from sales s
         where s.organization_id = $1 and s.idempotency_key = $2 and s.status = 'held'`,
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
        else {
          requested.set(key, {
            productId: item.productId,
            variantId: item.variantId ?? null,
            quantity: item.quantity,
          });
        }
      }

      const lines: Array<{
        product: HeldProductRow;
        quantity: number;
        subtotal: bigint;
        tax: bigint;
        total: bigint;
        cost: bigint;
      }> = [];
      let subtotal = 0n;
      let taxTotal = 0n;
      let total = 0n;
      let costTotal = 0n;

      for (const item of requested.values()) {
        const productResult = await transaction.query<HeldProductRow>(
          `select p.id as product_id, v.id as variant_id, p.name,
             coalesce(v.sku, p.sku) as sku,
             coalesce(v.selling_price, p.selling_price)::text as unit_price,
             coalesce(
               case when p.track_inventory
                 then coalesce(bi.average_cost, v.cost, p.cost, 0) * coalesce(v.units_per_base, 1)
                 else coalesce(v.cost, p.cost, 0) * coalesce(v.units_per_base, 1)
               end, 0
             )::text as unit_cost,
             p.tax_rate::text, p.is_tax_inclusive,
             coalesce(v.units_per_base, 1)::float8 as units_per_base,
             coalesce(v.unit, p.unit) as selling_unit,
             pu.kind as unit_kind
           from products p
           left join product_variants v
             on v.product_id = p.id and v.organization_id = p.organization_id and v.id = $4
           join product_units pu
             on pu.organization_id = p.organization_id and pu.code = coalesce(v.unit, p.unit)
           left join branch_inventory bi
             on bi.organization_id = p.organization_id and bi.branch_id = $2
             and bi.product_id = p.id and bi.variant_id is null
           where p.organization_id = $1 and p.branch_id = $2
             and p.id = $3 and p.status = 'active'
             and ($4::uuid is null or v.id is not null)`,
          [actor.organizationId, input.branchId, item.productId, item.variantId],
        );
        const product = productResult.rows[0];
        if (!product) throw notFound('Product');
        if (product.unit_kind === 'discrete' && !Number.isInteger(item.quantity)) {
          throw badRequest(
            'INVALID_SELLING_QUANTITY',
            `${product.name} must be held in whole ${product.selling_unit} quantities`,
          );
        }

        const calculated = calculateLine(
          product.unit_price,
          product.unit_cost,
          item.quantity,
          product.tax_rate,
          product.is_tax_inclusive,
        );
        subtotal += calculated.subtotal;
        taxTotal += calculated.tax;
        total += calculated.total;
        costTotal += calculated.cost;
        lines.push({ product, quantity: item.quantity, ...calculated });
      }

      const receipt = await transaction.query<{ receipt_number: string }>(
        `select 'HOLD-' || $1 || '-' || to_char(now() at time zone 'UTC','YYYYMMDD') || '-' ||
          lpad(nextval('receipt_number_seq')::text, 8, '0') as receipt_number`,
        [context.branch_code],
      );
      const receiptNumber = receipt.rows[0]!.receipt_number;
      const sale = await transaction.query<{ id: string }>(
        `insert into sales (
           organization_id, branch_id, register_id, shift_id, cashier_id, customer_id,
           receipt_number, idempotency_key, status, subtotal, discount_total, tax_total,
           total, cost_total, change_due, note
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,'held',$9,0,$10,$11,$12,0,$13)
         returning id`,
        [
          actor.organizationId,
          input.branchId,
          context.register_id,
          input.shiftId,
          actor.userId,
          input.customerId ?? null,
          receiptNumber,
          idempotencyKey,
          minorToMoney(subtotal),
          minorToMoney(taxTotal),
          minorToMoney(total),
          minorToMoney(costTotal),
          input.note ?? null,
        ],
      );
      const saleId = sale.rows[0]!.id;

      for (const line of lines) {
        await transaction.query(
          `insert into sale_items (
             organization_id, sale_id, product_id, variant_id, product_name, sku,
             quantity, unit_price, unit_cost, discount_total, tax_total, line_total,
             units_per_base
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11,$12)`,
          [
            actor.organizationId,
            saleId,
            line.product.product_id,
            line.product.variant_id,
            line.product.name,
            line.product.sku,
            line.quantity,
            line.product.unit_price,
            line.product.unit_cost,
            minorToMoney(line.tax),
            minorToMoney(line.total),
            line.product.units_per_base,
          ],
        );
      }

      await transaction.query(
        `insert into audit_logs (
           organization_id, actor_id, branch_id, action, entity_type, entity_id, after_data
         ) values ($1, $2, $3, 'sale.held', 'sale', $4, $5::jsonb)`,
        [
          actor.organizationId,
          actor.userId,
          input.branchId,
          saleId,
          JSON.stringify({
            receiptNumber,
            total: minorToMoney(total),
            itemCount: lines.length,
          }),
        ],
      );

      return {
        id: saleId,
        receiptNumber,
        subtotal: minorToMoney(subtotal),
        taxTotal: minorToMoney(taxTotal),
        total: minorToMoney(total),
        itemCount: lines.length,
        replayed: false,
      };
    });
  }

  private async validateContext(
    transaction: Queryable,
    actor: HoldSaleActor,
    input: HoldSaleInput,
  ): Promise<HoldContext> {
    const result = await transaction.query<HoldContext>(
      `select b.code as branch_code, r.id as register_id
       from branches b
       join registers r on r.organization_id = b.organization_id and r.branch_id = b.id
       join register_shifts rs on rs.organization_id = r.organization_id and rs.register_id = r.id
       where b.organization_id = $1 and b.id = $2 and b.is_active
         and rs.id = $3 and rs.status = 'open' and r.is_active
         and ($4::uuid is null or r.id = $4)
       for update of rs`,
      [actor.organizationId, input.branchId, input.shiftId, input.registerId ?? null],
    );
    if (!result.rows[0]) {
      throw forbidden(
        'INVALID_HOLD_CONTEXT',
        'The active register shift is no longer valid. Reopen the shift and try again.',
      );
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
