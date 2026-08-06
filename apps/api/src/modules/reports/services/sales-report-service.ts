import type { Database } from '../../../database/types.js';
import type { CanonicalReportResponse, SummaryCardContract, ReportSeriesContract, ReportDetailRowContract } from '@ximo/shared';
import { formatMoney } from '@ximo/shared';
import type { ReportScopeContext } from '../report-permission-resolver.js';
import { sanitizeReportSensitiveFields } from '../report-permission-resolver.js';

export class SalesReportService {
  constructor(private readonly database: Database) {}

  async generate(
    scope: ReportScopeContext,
    filter: { from: string; to: string; branchId?: string; search?: string; page?: number; pageSize?: number; sortField?: string; sortOrder?: 'asc' | 'desc' },
  ): Promise<CanonicalReportResponse> {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(10, filter.pageSize ?? 20));
    const offset = (page - 1) * pageSize;
    const searchPattern = filter.search ? `%${filter.search}%` : null;

    const values = [
      scope.organizationId,
      scope.fromIso,
      scope.toIso,
      scope.branchId ?? null,
      scope.hasAllBranchesAccess,
      scope.allowedBranchIds,
      searchPattern,
      pageSize,
      offset,
    ] as const;

    const branchScopeSQL = (alias: string) =>
      `($4::uuid is null or ${alias}.branch_id=$4)
       and ($5::boolean or ${alias}.branch_id=any($6::uuid[]))`;

    const searchSQL = (alias: string) =>
      `($7::text is null or ${alias}.receipt_number ilike $7)`;

    const [summaryResult, listResult, countResult, trendResult, branchInfo] = await Promise.all([
      this.database.query<{
        merchandiseSubtotal: string;
        discounts: string;
        taxesCollected: string;
        finalSales: string;
        customerRefunds: string;
        netSalesAfterRefunds: string;
        transactions: number;
        averageTransactionValue: string;
        averageNetRevenuePerTransaction: string;
        cogs: string;
        grossProfit: string;
        grossMarginPercent: string;
      }>(
        `with scoped_sales as (
           select * from sales s
           where s.organization_id=$1 and s.completed_at >= $2 and s.completed_at < $3
             and s.status in ('completed','partially_refunded','refunded')
             and ${branchScopeSQL('s')}
             and ${searchSQL('s')}
         ),
         sale_cost as (
           select coalesce(sum(si.quantity * si.unit_cost), 0) as total
           from sale_items si join scoped_sales s on s.id = si.sale_id
         ),
         scoped_returns as (
           select r.* from returns r
           where r.organization_id=$1 and r.created_at >= $2 and r.created_at < $3
             and ${branchScopeSQL('r')}
         ),
         return_cost as (
           select coalesce(sum(ri.quantity * si.unit_cost), 0) as total
           from return_items ri
           join scoped_returns r on r.id = ri.return_id
           join sale_items si on si.id = ri.sale_item_id
         )
         select
           coalesce(sum(s.subtotal), 0)::text as "merchandiseSubtotal",
           coalesce(sum(s.discount_total), 0)::text as "discounts",
           coalesce(sum(s.tax_total), 0)::text as "taxesCollected",
           coalesce(sum(s.total), 0)::text as "finalSales",
           coalesce((select sum(refund_total) from scoped_returns), 0)::text as "customerRefunds",
           (coalesce(sum(s.total), 0) - coalesce((select sum(refund_total) from scoped_returns), 0))::text as "netSalesAfterRefunds",
           count(distinct s.id)::int as "transactions",
           case when count(distinct s.id) > 0
             then round(coalesce(sum(s.total), 0) / count(distinct s.id), 2)::text
             else '0.00' end as "averageTransactionValue",
           case when count(distinct s.id) > 0
             then round((coalesce(sum(s.total), 0) - coalesce((select sum(refund_total) from scoped_returns), 0)) / count(distinct s.id), 2)::text
             else '0.00' end as "averageNetRevenuePerTransaction",
           ((select total from sale_cost) - (select total from return_cost))::text as "cogs",
           (coalesce(sum(s.total), 0) - coalesce((select sum(refund_total) from scoped_returns), 0) - ((select total from sale_cost) - (select total from return_cost)))::text as "grossProfit",
           case when (coalesce(sum(s.total), 0) - coalesce((select sum(refund_total) from scoped_returns), 0)) > 0
             then round(100 * (coalesce(sum(s.total), 0) - coalesce((select sum(refund_total) from scoped_returns), 0) - ((select total from sale_cost) - (select total from return_cost))) / (coalesce(sum(s.total), 0) - coalesce((select sum(refund_total) from scoped_returns), 0)), 2)::text
             else '0.00' end as "grossMarginPercent"
         from scoped_sales s`,
        values,
      ),

      this.database.query<{
        id: string;
        receiptNumber: string;
        completedAt: string;
        branchName: string;
        cashierName: string;
        subtotal: string;
        discountTotal: string;
        taxTotal: string;
        total: string;
        refundTotal: string;
        netTotal: string;
        status: string;
        paymentMethod: string;
        itemCount: number;
        sellingUnitsSold: number;
        baseUnitsSold: number;
        saleCost: string;
        saleProfit: string;
      }>(
        `select
           s.id,
           s.receipt_number as "receiptNumber",
           s.completed_at::text as "completedAt",
           b.name as "branchName",
           coalesce(p.display_name, 'Unknown Cashier') as "cashierName",
           s.subtotal::text,
           s.discount_total::text as "discountTotal",
           s.tax_total::text as "taxTotal",
           s.total::text,
           coalesce((select sum(refund_total) from returns r where r.sale_id = s.id), 0)::text as "refundTotal",
           (s.total - coalesce((select sum(refund_total) from returns r where r.sale_id = s.id), 0))::text as "netTotal",
           s.status,
           coalesce((select string_agg(distinct method::text, ', ') from payments pay where pay.sale_id = s.id), 'cash') as "paymentMethod",
           coalesce((select count(*) from sale_items si where si.sale_id = s.id), 0)::int as "itemCount",
           coalesce((select sum(si.quantity) from sale_items si where si.sale_id = s.id), 0)::float8 as "sellingUnitsSold",
           coalesce((select sum(si.quantity * coalesce(si.units_per_base, 1)) from sale_items si where si.sale_id = s.id), 0)::float8 as "baseUnitsSold",
           coalesce((select sum(si.quantity * si.unit_cost) from sale_items si where si.sale_id = s.id), 0)::text as "saleCost",
           (s.total - coalesce((select sum(si.quantity * si.unit_cost) from sale_items si where si.sale_id = s.id), 0))::text as "saleProfit"
         from sales s
         join branches b on b.id = s.branch_id
         left join profiles p on p.id = s.cashier_id
         where s.organization_id = $1 and s.completed_at >= $2 and s.completed_at < $3
           and s.status in ('completed','partially_refunded','refunded')
           and ${branchScopeSQL('s')}
           and ${searchSQL('s')}
         order by s.completed_at desc
         limit $8 offset $9`,
        values,
      ),

      this.database.query<{ totalRows: number }>(
        `select count(*)::int as "totalRows" from sales s
         where s.organization_id = $1 and s.completed_at >= $2 and s.completed_at < $3
           and s.status in ('completed','partially_refunded','refunded')
           and ${branchScopeSQL('s')}
           and ${searchSQL('s')}`,
        values,
      ),

      this.database.query<{ period: string; finalSales: string; refunds: string; netSales: string }>(
        `select
           to_char(s.completed_at at time zone $10, 'YYYY-MM-DD') as period,
           coalesce(sum(s.total), 0)::text as "finalSales",
           coalesce((select sum(refund_total) from returns r where r.organization_id = $1 and r.created_at >= $2 and r.created_at < $3 and ${branchScopeSQL('r')}), 0)::text as refunds,
           (coalesce(sum(s.total), 0) - coalesce((select sum(refund_total) from returns r where r.organization_id = $1 and r.created_at >= $2 and r.created_at < $3 and ${branchScopeSQL('r')}), 0))::text as "netSales"
         from sales s
         where s.organization_id = $1 and s.completed_at >= $2 and s.completed_at < $3
           and s.status in ('completed','partially_refunded','refunded')
           and ${branchScopeSQL('s')}
         group by 1 order by 1 asc`,
        [...values, scope.organizationTimezone],
      ),

      filter.branchId
        ? this.database.query<{ name: string }>('select name from branches where id=$1 and organization_id=$2', [filter.branchId, scope.organizationId])
        : Promise.resolve({ rows: [] }),
    ]);

    const kpis = summaryResult.rows[0] ?? {
      merchandiseSubtotal: '0.00',
      discounts: '0.00',
      taxesCollected: '0.00',
      finalSales: '0.00',
      customerRefunds: '0.00',
      netSalesAfterRefunds: '0.00',
      transactions: 0,
      averageTransactionValue: '0.00',
      averageNetRevenuePerTransaction: '0.00',
      cogs: '0.00',
      grossProfit: '0.00',
      grossMarginPercent: '0.00',
    };

    const summaryCards: SummaryCardContract[] = [
      {
        cardId: 'merchandise_subtotal',
        label: 'Merchandise Subtotal',
        value: Number(kpis.merchandiseSubtotal),
        formattedValue: formatMoney(kpis.merchandiseSubtotal),
        drillDownAvailable: true,
        exportAvailable: true,
        formulaDescription: 'SUM(sales.subtotal)',
      },
      {
        cardId: 'discounts',
        label: 'Discounts',
        value: Number(kpis.discounts),
        formattedValue: formatMoney(kpis.discounts),
        drillDownAvailable: true,
        exportAvailable: true,
        formulaDescription: 'SUM(sales.discount_total)',
      },
      {
        cardId: 'taxes_collected',
        label: 'Taxes Collected',
        value: Number(kpis.taxesCollected),
        formattedValue: formatMoney(kpis.taxesCollected),
        drillDownAvailable: true,
        exportAvailable: true,
        formulaDescription: 'SUM(sales.tax_total)',
      },
      {
        cardId: 'final_sales',
        label: 'Final Sales',
        value: Number(kpis.finalSales),
        formattedValue: formatMoney(kpis.finalSales),
        drillDownAvailable: true,
        exportAvailable: true,
        formulaDescription: 'Merchandise Subtotal - Discounts + Taxes Collected',
      },
      {
        cardId: 'customer_refunds',
        label: 'Customer Refunds',
        value: Number(kpis.customerRefunds),
        formattedValue: formatMoney(kpis.customerRefunds),
        drillDownAvailable: true,
        exportAvailable: true,
        formulaDescription: 'SUM(returns.refund_total)',
      },
      {
        cardId: 'net_sales_after_refunds',
        label: 'Net Sales After Refunds',
        value: Number(kpis.netSalesAfterRefunds),
        formattedValue: formatMoney(kpis.netSalesAfterRefunds),
        drillDownAvailable: true,
        exportAvailable: true,
        formulaDescription: 'Final Sales - Customer Refunds',
      },
      {
        cardId: 'transactions',
        label: 'Transaction Count',
        value: kpis.transactions,
        formattedValue: String(kpis.transactions),
        drillDownAvailable: true,
        exportAvailable: true,
        formulaDescription: 'COUNT(completed sales)',
      },
    ];

    if (scope.canViewCost) {
      summaryCards.push({
        cardId: 'cogs',
        label: 'Cost of Goods Sold (COGS)',
        value: Number(kpis.cogs),
        formattedValue: formatMoney(kpis.cogs),
        drillDownAvailable: true,
        exportAvailable: true,
        formulaDescription: 'SUM(sold_item_qty * sale_item_cost) - SUM(returned_qty * sale_item_cost)',
        isSensitive: true,
      });
    }

    if (scope.canViewProfit) {
      summaryCards.push({
        cardId: 'gross_profit',
        label: 'Gross Profit',
        value: Number(kpis.grossProfit),
        formattedValue: formatMoney(kpis.grossProfit),
        drillDownAvailable: true,
        exportAvailable: true,
        formulaDescription: 'Net Sales After Refunds - COGS',
        isSensitive: true,
      });
    }

    const rows: ReportDetailRowContract[] = listResult.rows.map((row) => {
      const sanitized = sanitizeReportSensitiveFields(
        {
          id: row.id,
          title: `Receipt #${row.receiptNumber}`,
          category: row.branchName,
          quantity: row.sellingUnitsSold,
          unit: 'item',
          baseQuantity: row.baseUnitsSold,
          baseUnit: 'base unit',
          value: formatMoney(row.netTotal),
          subValue: `Branch: ${row.branchName} • Cashier: ${row.cashierName} • Payment: ${row.paymentMethod}`,
          netCost: formatMoney(row.saleCost),
          grossProfit: formatMoney(row.saleProfit),
          statusTag: row.status.toUpperCase(),
          statusTone: (row.status === 'completed' ? 'green' : row.status === 'partially_refunded' ? 'amber' : 'red') as any,
        },
        scope.canViewCost,
        scope.canViewProfit,
      );
      return sanitized;
    });

    return {
      reportId: 'sales',
      title: 'Detailed Sales Report',
      description: 'Transaction-level checkout history, refunds, taxes, and branch activity log',
      generatedAt: new Date().toISOString(),
      timezone: scope.organizationTimezone,
      currency: 'PHP',
      appliedFilters: {
        from: filter.from,
        to: filter.to,
        branchId: filter.branchId ?? null,
        branchName: branchInfo.rows[0]?.name ?? 'All Accessible Branches',
      },
      summaryCards,
      series: [
        {
          seriesId: 'sales_trend',
          label: 'Sales Trend',
          chartType: 'line',
          xAxis: 'date',
          yAxis: 'netSales',
          data: trendResult.rows.map((r) => ({ x: r.period, y: Number(r.netSales), label: formatMoney(r.netSales) })),
        },
      ],
      rows,
      pagination: {
        totalRows: countResult.rows[0]?.totalRows ?? 0,
        page,
        pageSize,
      },
      warnings: [],
    };
  }
}
