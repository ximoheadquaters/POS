import type { Database } from '../database/types.js';
import { notFound } from '../shared/errors.js';

export interface ResumedHeldSaleItem {
  productId: string;
  variantId: string | null;
  productName: string;
  unitPrice: string;
  quantity: number;
  unit: string;
  unitsPerBase: number;
  taxRate: string;
  isTaxInclusive: boolean;
  sku: string;
  image: string | null;
}

export interface ResumedHeldSale {
  id: string;
  receiptNumber: string;
  customerId: string | null;
  note: string | null;
  items: ResumedHeldSaleItem[];
}

export class HeldSaleService {
  constructor(private readonly database: Database) {}

  async resume(
    organizationId: string,
    userId: string,
    branchId: string,
    id: string,
  ): Promise<ResumedHeldSale> {
    return this.database.transaction(async (transaction) => {
      const saleResult = await transaction.query<{
        id: string;
        branch_id: string;
        receipt_number: string;
        customer_id: string | null;
        note: string | null;
      }>(
        `select id, branch_id, receipt_number, customer_id, note
         from sales
         where id = $1 and organization_id = $2 and branch_id = $3 and status = 'held'
         for update`,
        [id, organizationId, branchId],
      );
      const sale = saleResult.rows[0];
      if (!sale) throw notFound('Held sale');

      const itemsResult = await transaction.query<ResumedHeldSaleItem>(
        `select si.product_id as "productId", si.variant_id as "variantId",
           si.product_name as "productName", si.unit_price::text as "unitPrice",
           si.quantity::float8 as quantity, coalesce(v.unit, p.unit) as unit,
           si.units_per_base::float8 as "unitsPerBase", p.tax_rate::text as "taxRate",
           p.is_tax_inclusive as "isTaxInclusive", si.sku, p.image_path as image
         from sale_items si
         join products p
           on p.id = si.product_id and p.organization_id = si.organization_id
         left join product_variants v
           on v.id = si.variant_id and v.organization_id = si.organization_id
         where si.sale_id = $1 and si.organization_id = $2
         order by si.created_at, si.id`,
        [id, organizationId],
      );

      await transaction.query(
        `update sales
         set status = 'voided'
         where id = $1 and organization_id = $2 and status = 'held'`,
        [id, organizationId],
      );
      await transaction.query(
        `insert into audit_logs (
           organization_id, actor_id, branch_id, action, entity_type, entity_id, after_data
         ) values ($1, $2, $3, 'sale.resumed', 'sale', $4, $5::jsonb)`,
        [
          organizationId,
          userId,
          sale.branch_id,
          id,
          JSON.stringify({ receiptNumber: sale.receipt_number, itemCount: itemsResult.rows.length }),
        ],
      );

      return {
        id: sale.id,
        receiptNumber: sale.receipt_number,
        customerId: sale.customer_id,
        note: sale.note,
        items: itemsResult.rows,
      };
    });
  }

  async discard(organizationId: string, userId: string, branchId: string, id: string): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const saleResult = await transaction.query<{
        id: string;
        branch_id: string;
        receipt_number: string;
      }>(
        `select id, branch_id, receipt_number
         from sales
         where id = $1 and organization_id = $2 and branch_id = $3 and status = 'held'
         for update`,
        [id, organizationId, branchId],
      );
      const sale = saleResult.rows[0];
      if (!sale) throw notFound('Held sale');

      await transaction.query(
        `update sales
         set status = 'voided'
         where id = $1 and organization_id = $2 and status = 'held'`,
        [id, organizationId],
      );
      await transaction.query(
        `insert into audit_logs (
           organization_id, actor_id, branch_id, action, entity_type, entity_id, after_data
         ) values ($1, $2, $3, 'sale.discarded', 'sale', $4, $5::jsonb)`,
        [
          organizationId,
          userId,
          sale.branch_id,
          id,
          JSON.stringify({ receiptNumber: sale.receipt_number }),
        ],
      );
    });
  }
}
