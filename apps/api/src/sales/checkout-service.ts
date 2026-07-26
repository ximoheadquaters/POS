import type { CheckoutInput } from '@ximo/shared';
import { minorToMoney, moneyToMinor } from '@ximo/shared';
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
  quantity: number;
}

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
  const base = price * BigInt(quantity);
  const tax = taxInclusive
    ? divideRounded(base * rateHundredths, 10_000n + rateHundredths)
    : divideRounded(base * rateHundredths, 10_000n);
  return {
    subtotal: taxInclusive ? base - tax : base,
    tax,
    total: taxInclusive ? base : base + tax,
    cost: cost * BigInt(quantity),
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

      const rows: Array<{ product: ProductRow; quantity: number }> = [];
      for (const item of requested.values()) {
        const result = await transaction.query<ProductRow>(
          `select p.id as product_id, v.id as variant_id, p.name,
            coalesce(v.sku, p.sku) as sku,
            coalesce(v.selling_price, p.selling_price)::text as unit_price,
            coalesce(v.cost, p.cost)::text as unit_cost,
            p.tax_rate::text, p.is_tax_inclusive, bi.quantity
           from products p
           left join product_variants v
             on v.product_id = p.id and v.organization_id = p.organization_id and v.id = $4
           join branch_inventory bi
             on bi.organization_id = p.organization_id and bi.branch_id = $2
             and bi.product_id = p.id and bi.variant_id is not distinct from $4
           where p.organization_id = $1 and p.id = $3 and p.status = 'active'
           for update of bi`,
          [actor.organizationId, input.branchId, item.productId, item.variantId],
        );
        const product = result.rows[0];
        if (!product) throw notFound('Product or branch inventory');
        if (!context.allow_negative_inventory && product.quantity < item.quantity) {
          throw conflict('INSUFFICIENT_INVENTORY', `${product.name} has insufficient inventory`);
        }
        rows.push({ product, quantity: item.quantity });
      }

      let subtotal = 0n;
      let taxTotal = 0n;
      let totalBeforeDiscount = 0n;
      let costTotal = 0n;
      const calculated = rows.map(({ product, quantity }) => {
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
        return { product, quantity, line };
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
            unit_price, unit_cost, discount_total, tax_total, line_total
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            actor.organizationId,
            saleId,
            item.product.product_id,
            item.product.variant_id,
            item.product.name,
            item.product.sku,
            item.quantity,
            item.product.unit_price,
            item.product.unit_cost,
            minorToMoney(allocatedDiscount),
            minorToMoney(item.line.tax),
            minorToMoney(item.line.total - allocatedDiscount),
          ],
        );
        const inventory = await transaction.query<{ quantity: number }>(
          `update branch_inventory set quantity = quantity - $5, updated_at = now()
           where organization_id = $1 and branch_id = $2 and product_id = $3
             and variant_id is not distinct from $4 returning quantity`,
          [
            actor.organizationId,
            input.branchId,
            item.product.product_id,
            item.product.variant_id,
            item.quantity,
          ],
        );
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
            -item.quantity,
            inventory.rows[0]!.quantity,
            saleId,
            actor.userId,
          ],
        );
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
        `update register_shifts set cash_sales = cash_sales + $4, updated_at = now()
         where id = $1 and organization_id = $2 and cashier_id = $3 and status = 'open'`,
        [input.shiftId, actor.organizationId, actor.userId, minorToMoney(cashTotal)],
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
         and r.id = $3 and r.is_active and rs.id = $4 and rs.cashier_id = $5 and rs.status = 'open'
       for update of rs`,
      [actor.organizationId, input.branchId, input.registerId, input.shiftId, actor.userId],
    );
    if (!result.rows[0]) {
      throw forbidden('INVALID_CHECKOUT_CONTEXT', 'Branch, register, or active shift is invalid');
    }
    if (input.customerId) {
      const customer = await transaction.query(
        'select 1 from customers where id = $1 and organization_id = $2 and is_active',
        [input.customerId, actor.organizationId],
      );
      if (!customer.rowCount) throw notFound('Customer');
    }
    return result.rows[0];
  }
}
