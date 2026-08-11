import type { Database } from '../../../database/types.js';
import type { CanonicalReportResponse, SummaryCardContract } from '@ximo/shared';
import { formatMoney } from '@ximo/shared';
import type { ReportScopeContext } from '../report-permission-resolver.js';
import { sanitizeReportSensitiveFields } from '../report-permission-resolver.js';

export class SalesSummaryReportService {
  constructor(private readonly database: Database) {}

  async generate(
    scope: ReportScopeContext,
    filter: { from: string; to: string; branchId?: string },
  ): Promise<CanonicalReportResponse> {
    const values = [
      scope.organizationId,
      scope.fromIso,
      scope.toIso,
      scope.branchId ?? null,
      scope.hasAllBranchesAccess,
      scope.allowedBranchIds,
    ] as const;

    const branchScopeSQL = (alias: string) =>
      `($4::uuid is null or ${alias}.branch_id=$4)
       and ($5::boolean or ${alias}.branch_id=any($6::uuid[]))`;

    const [summaryResult, itemsResult, branchInfo] = await Promise.all([
      this.database.query<{
        grossSales: string;
        customerRefunds: string;
        netSales: string;
        discounts: string;
        taxes: string;
        transactions: number;
        averageTransaction: string;
        netCost: string;
        grossProfit: string;
        grossMarginPercent: string;
      }>(
        `with scoped_sales as (
           select * from sales s
           where s.organization_id=$1 and s.completed_at >= $2 and s.completed_at < $3
             and s.status in ('completed','partially_refunded','refunded')
             and ${branchScopeSQL('s')}
         ),
         sale_cost as (
           select coalesce(sum(si.quantity*si.unit_cost),0) as total,
             coalesce(sum(si.quantity*si.unit_price),0) as gross_sales,
             coalesce(sum(si.quantity),0) as items_sold
           from sale_items si join scoped_sales s on s.id=si.sale_id
         ),
         scoped_returns as (
           select r.* from returns r
           where r.organization_id=$1 and r.created_at >= $2 and r.created_at < $3
             and ${branchScopeSQL('r')}
         ),
         return_cost as (
           select coalesce(sum(ri.quantity*si.unit_cost),0) as total
           from return_items ri
           join scoped_returns r on r.id=ri.return_id
           join sale_items si on si.id=ri.sale_item_id
         )
         select
           (select gross_sales from sale_cost)::text as "grossSales",
           coalesce((select sum(refund_total) from scoped_returns),0)::text as "customerRefunds",
           ((select gross_sales from sale_cost) - coalesce(sum(s.discount_total),0) -
             coalesce((select sum(refund_total) from scoped_returns),0))::text as "netSales",
           coalesce(sum(s.discount_total),0)::text as discounts,
           coalesce(sum(s.tax_total),0)::text as taxes,
           count(s.id)::int as transactions,
           case when count(s.id) > 0
             then round(((select gross_sales from sale_cost) - coalesce(sum(s.discount_total),0) -
               coalesce((select sum(refund_total) from scoped_returns),0)) / count(s.id), 2)::text
             else '0.00' end as "averageTransaction",
           ((select total from sale_cost) - (select total from return_cost))::text as "netCost",
           ((select gross_sales from sale_cost) - coalesce(sum(s.discount_total),0) -
             coalesce((select sum(refund_total) from scoped_returns),0) -
             ((select total from sale_cost) - (select total from return_cost)))::text as "grossProfit",
           case when ((select gross_sales from sale_cost) - coalesce(sum(s.discount_total),0) -
             coalesce((select sum(refund_total) from scoped_returns),0)) > 0
             then round(100 * ((select gross_sales from sale_cost) - coalesce(sum(s.discount_total),0) -
               coalesce((select sum(refund_total) from scoped_returns),0) -
               ((select total from sale_cost) - (select total from return_cost))) /
               ((select gross_sales from sale_cost) - coalesce(sum(s.discount_total),0) -
                coalesce((select sum(refund_total) from scoped_returns),0)), 2)::text
             else '0.00' end as "grossMarginPercent"
         from scoped_sales s`,
        values,
      ),

      this.database.query<{
        id: string;
        name: string;
        sku: string;
        category: string;
        quantity: number;
        sellingUnit: string;
        unitsPerBase: number;
        baseQuantity: number;
        baseUnit: string;
        sales: string;
        cost: string;
        profit: string;
      }>(
        `select
           p.id,
           si.product_name as name,
           si.sku,
           coalesce(c.name, 'Uncategorized') as category,
           coalesce(sum(si.quantity), 0)::float8 as quantity,
           coalesce(v.unit, p.unit) as "sellingUnit",
           coalesce(si.units_per_base, v.units_per_base, 1)::float8 as "unitsPerBase",
           coalesce(sum(si.quantity * coalesce(si.units_per_base, v.units_per_base, 1)), 0)::float8 as "baseQuantity",
           p.unit as "baseUnit",
           coalesce(sum(si.line_total), 0)::text as sales,
           coalesce(sum(si.quantity * si.unit_cost), 0)::text as cost,
           (coalesce(sum(si.line_total), 0) - coalesce(sum(si.quantity * si.unit_cost), 0))::text as profit
         from sale_items si
         join sales s on s.id = si.sale_id
         join products p on p.id = si.product_id
         left join product_variants v on v.id = si.variant_id
         left join categories c on c.id = p.category_id
         where si.organization_id = $1 and s.completed_at >= $2 and s.completed_at < $3
           and s.status in ('completed','partially_refunded','refunded')
           and ${branchScopeSQL('s')}
         group by p.id, si.product_name, si.sku, c.name, coalesce(v.unit, p.unit), si.units_per_base, v.units_per_base, p.unit
         order by sum(si.line_total) desc limit 50`,
        values,
      ),

      filter.branchId
        ? this.database.query<{ name: string }>(
            'select name from branches where id=$1 and organization_id=$2',
            [filter.branchId, scope.organizationId],
          )
        : Promise.resolve({ rows: [] }),
    ]);

    const kpis = summaryResult.rows[0] ?? {
      grossSales: '0.00',
      customerRefunds: '0.00',
      netSales: '0.00',
      discounts: '0.00',
      taxes: '0.00',
      transactions: 0,
      averageTransaction: '0.00',
      netCost: '0.00',
      grossProfit: '0.00',
      grossMarginPercent: '0.00',
    };

    const netSalesNum = Number(kpis.netSales);
    const grossSalesNum = Number(kpis.grossSales);
    const refundsNum = Number(kpis.customerRefunds);
    const discountsNum = Number(kpis.discounts);
    const taxesNum = Number(kpis.taxes);
    const netCostNum = Number(kpis.netCost);
    const grossProfitNum = Number(kpis.grossProfit);
    const marginNum = Number(kpis.grossMarginPercent);

    const summaryCards: SummaryCardContract[] = [
      {
        cardId: 'gross_sales',
        label: 'Gross Sales',
        value: grossSalesNum,
        formattedValue: formatMoney(kpis.grossSales),
        drillDownAvailable: true,
        exportAvailable: true,
        formulaDescription: 'SUM(sale_items.unit_price × sale_items.quantity)',
      },
      {
        cardId: 'net_sales',
        label: 'Net Sales',
        value: netSalesNum,
        formattedValue: formatMoney(kpis.netSales),
        drillDownAvailable: true,
        exportAvailable: true,
        formulaDescription: 'Gross Sales − Total Discounts − Refund Amount',
      },
      {
        cardId: 'customer_refunds',
        label: 'Customer Refunds',
        value: refundsNum,
        formattedValue: formatMoney(kpis.customerRefunds),
        drillDownAvailable: true,
        exportAvailable: true,
        formulaDescription: 'SUM(returns.refund_total)',
      },
      {
        cardId: 'discounts',
        label: 'Discounts',
        value: discountsNum,
        formattedValue: formatMoney(kpis.discounts),
        drillDownAvailable: true,
        exportAvailable: true,
        formulaDescription: 'SUM(sales.discount_total)',
      },
      {
        cardId: 'taxes',
        label: 'Taxes Collected',
        value: taxesNum,
        formattedValue: formatMoney(kpis.taxes),
        drillDownAvailable: true,
        exportAvailable: true,
        formulaDescription: 'SUM(sales.tax_total)',
      },
      {
        cardId: 'transactions',
        label: 'Transactions',
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
        value: netCostNum,
        formattedValue: formatMoney(kpis.netCost),
        drillDownAvailable: true,
        exportAvailable: true,
        formulaDescription: 'SUM(sold_item_quantity * sale_item_cost) - SUM(returned_item_quantity * sale_item_cost)',
        isSensitive: true,
      });
    }

    if (scope.canViewProfit) {
      summaryCards.push(
        {
          cardId: 'gross_profit',
          label: 'Gross Profit',
          value: grossProfitNum,
          formattedValue: formatMoney(kpis.grossProfit),
          drillDownAvailable: true,
          exportAvailable: true,
          formulaDescription: 'Net Sales minus Cost of Goods Sold',
          isSensitive: true,
        },
        {
          cardId: 'gross_margin_percent',
          label: 'Gross Margin %',
          value: marginNum,
          formattedValue: `${marginNum.toFixed(2)}%`,
          drillDownAvailable: true,
          exportAvailable: true,
          formulaDescription: '(Gross Profit / Net Sales) * 100',
          isSensitive: true,
        },
      );
    }

    const rows = itemsResult.rows.map((item) => {
      const sanitized = sanitizeReportSensitiveFields(
        {
          id: item.id,
          title: item.name,
          sku: item.sku,
          category: item.category,
          quantity: item.quantity,
          unit: item.sellingUnit,
          baseQuantity: item.baseQuantity,
          baseUnit: item.baseUnit,
          value: formatMoney(item.sales),
          subValue: `${item.quantity} ${item.sellingUnit} (${item.baseQuantity} ${item.baseUnit})`,
          netCost: formatMoney(item.cost),
          grossProfit: formatMoney(item.profit),
          statusTag: 'Completed',
          statusTone: 'green' as const,
        },
        scope.canViewCost,
        scope.canViewProfit,
      );
      return sanitized;
    });

    return {
      reportId: 'sales_summary',
      title: 'Sales Summary Proof Report',
      description: 'Canonical sales, refund, tax, discount, and alternate-unit performance summary',
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
          seriesId: 'sales_by_product',
          label: 'Sales Volume by Product',
          chartType: 'bar',
          xAxis: 'product',
          yAxis: 'sales',
          data: itemsResult.rows.slice(0, 10).map((r) => ({
            x: r.name,
            y: Number(r.sales),
            label: formatMoney(r.sales),
          })),
        },
      ],
      rows,
      pagination: {
        totalRows: itemsResult.rows.length,
        page: 1,
        pageSize: 50,
      },
      warnings: [],
    };
  }
}
