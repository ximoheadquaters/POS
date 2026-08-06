import type { Database } from '../../../database/types.js';
import { formatMoney } from '@ximo/shared';
import type { ReportScopeContext } from '../report-permission-resolver.js';
import { notFound } from '../../../shared/errors.js';

export interface SaleTransactionDetailResponse {
  id: string;
  receiptNumber: string;
  completedAt: string;
  status: string;
  branchName: string;
  registerName: string;
  shiftId: string | null;
  cashierName: string;
  customerName: string | null;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  refundTotal: string;
  netTotal: string;
  payments: Array<{ method: string; amount: string; reference?: string | null }>;
  items: Array<{
    id: string;
    productName: string;
    sku: string;
    sellingUnit: string;
    quantity: number;
    unitsPerBase: number;
    baseQuantity: number;
    baseUnit: string;
    unitPrice: string;
    unitCost: string | null;
    discountTotal: string;
    taxTotal: string;
    lineTotal: string;
    lineProfit: string | null;
  }>;
}

export class TransactionDetailService {
  constructor(private readonly database: Database) {}

  async getTransactionDetail(
    scope: ReportScopeContext,
    saleId: string,
  ): Promise<SaleTransactionDetailResponse> {
    const saleResult = await this.database.query<{
      id: string;
      receiptNumber: string;
      completedAt: string;
      status: string;
      branchId: string;
      branchName: string;
      registerName: string;
      shiftId: string | null;
      cashierName: string;
      customerName: string | null;
      subtotal: string;
      discountTotal: string;
      taxTotal: string;
      total: string;
      refundTotal: string;
      netTotal: string;
    }>(
      `select
         s.id,
         s.receipt_number as "receiptNumber",
         s.completed_at::text as "completedAt",
         s.status,
         s.branch_id as "branchId",
         b.name as "branchName",
         coalesce(reg.name, 'Main Register') as "registerName",
         s.shift_id as "shiftId",
         coalesce(p.display_name, 'Unknown Cashier') as "cashierName",
         c.name as "customerName",
         s.subtotal::text,
         s.discount_total::text as "discountTotal",
         s.tax_total::text as "taxTotal",
         s.total::text,
         coalesce((select sum(refund_total) from returns r where r.sale_id = s.id), 0)::text as "refundTotal",
         (s.total - coalesce((select sum(refund_total) from returns r where r.sale_id = s.id), 0))::text as "netTotal"
       from sales s
       join branches b on b.id = s.branch_id
       left join registers reg on reg.id = s.register_id
       left join profiles p on p.id = s.cashier_id
       left join customers c on c.id = s.customer_id
       where s.id = $1 and s.organization_id = $2`,
      [saleId, scope.organizationId],
    );

    const sale = saleResult.rows[0];
    if (!sale) throw notFound('Sale transaction');

    if (
      scope.branchId &&
      !scope.hasAllBranchesAccess &&
      scope.branchId !== sale.branchId
    ) {
      throw notFound('Sale transaction');
    }

    const [itemsResult, paymentsResult] = await Promise.all([
      this.database.query<{
        id: string;
        productName: string;
        sku: string;
        sellingUnit: string;
        quantity: number;
        unitsPerBase: number;
        baseQuantity: number;
        baseUnit: string;
        unitPrice: string;
        unitCost: string;
        discountTotal: string;
        taxTotal: string;
        lineTotal: string;
        lineProfit: string;
      }>(
        `select
           si.id,
           si.product_name as "productName",
           si.sku,
           coalesce(v.unit, prod.unit) as "sellingUnit",
           si.quantity::float8 as quantity,
           coalesce(si.units_per_base, v.units_per_base, 1)::float8 as "unitsPerBase",
           (si.quantity * coalesce(si.units_per_base, v.units_per_base, 1))::float8 as "baseQuantity",
           prod.unit as "baseUnit",
           si.unit_price::text as "unitPrice",
           si.unit_cost::text as "unitCost",
           si.discount_total::text as "discountTotal",
           si.tax_total::text as "taxTotal",
           si.line_total::text as "lineTotal",
           (si.line_total - (si.quantity * si.unit_cost))::text as "lineProfit"
         from sale_items si
         join products prod on prod.id = si.product_id
         left join product_variants v on v.id = si.variant_id
         where si.sale_id = $1 and si.organization_id = $2`,
        [saleId, scope.organizationId],
      ),

      this.database.query<{ method: string; amount: string; reference: string | null }>(
        `select method, amount::text, reference from payments where sale_id = $1 and organization_id = $2`,
        [saleId, scope.organizationId],
      ),
    ]);

    const items = itemsResult.rows.map((item) => ({
      id: item.id,
      productName: item.productName,
      sku: item.sku,
      sellingUnit: item.sellingUnit,
      quantity: item.quantity,
      unitsPerBase: item.unitsPerBase,
      baseQuantity: item.baseQuantity,
      baseUnit: item.baseUnit,
      unitPrice: formatMoney(item.unitPrice),
      unitCost: scope.canViewCost ? formatMoney(item.unitCost) : null,
      discountTotal: formatMoney(item.discountTotal),
      taxTotal: formatMoney(item.taxTotal),
      lineTotal: formatMoney(item.lineTotal),
      lineProfit: scope.canViewProfit ? formatMoney(item.lineProfit) : null,
    }));

    const payments = paymentsResult.rows.map((p) => ({
      method: p.method,
      amount: formatMoney(p.amount),
      reference: p.reference,
    }));

    return {
      id: sale.id,
      receiptNumber: sale.receiptNumber,
      completedAt: sale.completedAt,
      status: sale.status,
      branchName: sale.branchName,
      registerName: sale.registerName,
      shiftId: sale.shiftId,
      cashierName: sale.cashierName,
      customerName: sale.customerName,
      subtotal: formatMoney(sale.subtotal),
      discountTotal: formatMoney(sale.discountTotal),
      taxTotal: formatMoney(sale.taxTotal),
      total: formatMoney(sale.total),
      refundTotal: formatMoney(sale.refundTotal),
      netTotal: formatMoney(sale.netTotal),
      payments,
      items,
    };
  }
}
