import type { ReturnInput } from '@ximo/shared';
import { minorToMoney, moneyToMinor } from '@ximo/shared';
import type { Database } from '../database/types.js';
import { badRequest, notFound } from '../shared/errors.js';

interface ReturnActor {
  userId: string;
  organizationId: string;
}

interface SaleItemRow {
  id: string;
  product_id: string;
  variant_id: string | null;
  quantity: number;
  returned_quantity: number;
  line_total: string;
}

export class ReturnService {
  constructor(private readonly database: Database) {}

  create(actor: ReturnActor, saleId: string, input: ReturnInput) {
    return this.database.transaction(async (tx) => {
      const sale = await tx.query<{ branch_id: string; status: string }>(
        `select branch_id, status from sales where id = $1 and organization_id = $2
         and branch_id = $3 and status in ('completed','partially_refunded') for update`,
        [saleId, actor.organizationId, input.branchId],
      );
      if (!sale.rows[0]) throw notFound('Completed sale');

      const items: Array<{ source: SaleItemRow; quantity: number; refund: bigint }> = [];
      let refundTotal = 0n;
      for (const requested of input.items) {
        const found = await tx.query<SaleItemRow>(
          `select id, product_id, variant_id, quantity, returned_quantity, line_total::text
           from sale_items where id = $1 and sale_id = $2 and organization_id = $3 for update`,
          [requested.saleItemId, saleId, actor.organizationId],
        );
        const source = found.rows[0];
        if (!source) throw notFound('Sale item');
        if (source.returned_quantity + requested.quantity > source.quantity) {
          throw badRequest('RETURN_QUANTITY_EXCEEDED', 'Return quantity exceeds the quantity sold');
        }
        const refund =
          (moneyToMinor(source.line_total) * BigInt(requested.quantity)) / BigInt(source.quantity);
        refundTotal += refund;
        items.push({ source, quantity: requested.quantity, refund });
      }
      const numberResult = await tx.query<{ value: string }>(
        `select 'RET-' || to_char(now() at time zone 'UTC','YYYYMMDD') || '-' ||
         lpad(nextval('return_number_seq')::text, 8, '0') as value`,
      );
      const created = await tx.query<{ id: string; return_number: string }>(
        `insert into returns (
          organization_id, branch_id, sale_id, return_number, reason,
          refund_method, refund_total, created_by
         ) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id, return_number`,
        [
          actor.organizationId,
          input.branchId,
          saleId,
          numberResult.rows[0]!.value,
          input.reason,
          input.refundMethod,
          minorToMoney(refundTotal),
          actor.userId,
        ],
      );
      const returnId = created.rows[0]!.id;
      for (const item of items) {
        await tx.query(
          `insert into return_items (organization_id, return_id, sale_item_id, quantity, refund_amount)
           values ($1,$2,$3,$4,$5)`,
          [
            actor.organizationId,
            returnId,
            item.source.id,
            item.quantity,
            minorToMoney(item.refund),
          ],
        );
        await tx.query(
          `update sale_items set returned_quantity = returned_quantity + $2 where id = $1`,
          [item.source.id, item.quantity],
        );
        const inventory = await tx.query<{ quantity: number }>(
          `update branch_inventory set quantity = quantity + $5, updated_at = now()
           where organization_id = $1 and branch_id = $2 and product_id = $3
             and variant_id is not distinct from $4 returning quantity`,
          [
            actor.organizationId,
            input.branchId,
            item.source.product_id,
            item.source.variant_id,
            item.quantity,
          ],
        );
        await tx.query(
          `insert into inventory_movements (
            organization_id, branch_id, product_id, variant_id, movement_type,
            quantity_delta, quantity_after, reason, reference_type, reference_id, created_by
           ) values ($1,$2,$3,$4,'return',$5,$6,$7,'return',$8,$9)`,
          [
            actor.organizationId,
            input.branchId,
            item.source.product_id,
            item.source.variant_id,
            item.quantity,
            inventory.rows[0]!.quantity,
            input.reason,
            returnId,
            actor.userId,
          ],
        );
      }
      await tx.query(
        `insert into payments (organization_id, sale_id, method, kind, amount, reference)
         values ($1,$2,$3,'refund',$4,$5)`,
        [
          actor.organizationId,
          saleId,
          input.refundMethod,
          minorToMoney(refundTotal),
          created.rows[0]!.return_number,
        ],
      );
      await tx.query(
        `update sales set status = case
          when not exists (
            select 1 from sale_items where sale_id = $1 and returned_quantity < quantity
          ) then 'refunded'::sale_status else 'partially_refunded'::sale_status end,
          updated_at = now() where id = $1`,
        [saleId],
      );
      await tx.query(
        `insert into audit_logs (
          organization_id, branch_id, actor_id, action, entity_type, entity_id, after_data
         ) values ($1,$2,$3,'return.completed','return',$4,$5::jsonb)`,
        [
          actor.organizationId,
          input.branchId,
          actor.userId,
          returnId,
          JSON.stringify({ refundTotal: minorToMoney(refundTotal), reason: input.reason }),
        ],
      );
      return {
        id: returnId,
        returnNumber: created.rows[0]!.return_number,
        refundTotal: minorToMoney(refundTotal),
      };
    });
  }
}
