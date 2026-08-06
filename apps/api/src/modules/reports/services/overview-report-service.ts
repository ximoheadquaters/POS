import type { Database } from '../../../database/types.js';
import type { CanonicalReportResponse, SummaryCardContract, ReportSeriesContract } from '@ximo/shared';
import { formatMoney } from '@ximo/shared';
import type { ReportScopeContext } from '../report-permission-resolver.js';
import { sanitizeReportSensitiveFields } from '../report-permission-resolver.js';

export class OverviewReportService {
  constructor(private readonly database: Database) {}

  async generate(
    scope: ReportScopeContext,
    filter: { from: string; to: string; branchId?: string; comparison?: string },
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

    const [kpiResult, trendResult, branchSalesResult, catSalesResult, paymentDistResult, topProductsResult, hourlyResult, branchInfo] =
      await Promise.all([
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
          sellingUnitsSold: number;
          equivalentBaseUnitsSold: number;
          cogs: string;
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
             select coalesce(sum(si.quantity * si.unit_cost), 0) as total,
                    coalesce(sum(si.quantity), 0) as total_units,
                    coalesce(sum(si.quantity * coalesce(si.units_per_base, 1)), 0) as total_base_units
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
             coalesce((select total_units from sale_cost), 0)::float8 as "sellingUnitsSold",
             coalesce((select total_base_units from sale_cost), 0)::float8 as "equivalentBaseUnitsSold",
             ((select total from sale_cost) - (select total from return_cost))::text as "cogs",
             (coalesce(sum(s.total), 0) - coalesce((select sum(refund_total) from scoped_returns), 0) - ((select total from sale_cost) - (select total from return_cost)))::text as "grossProfit",
             case when (coalesce(sum(s.total), 0) - coalesce((select sum(refund_total) from scoped_returns), 0)) > 0
               then round(100 * (coalesce(sum(s.total), 0) - coalesce((select sum(refund_total) from scoped_returns), 0) - ((select total from sale_cost) - (select total from return_cost))) / (coalesce(sum(s.total), 0) - coalesce((select sum(refund_total) from scoped_returns), 0)), 2)::text
               else '0.00' end as "grossMarginPercent"
           from scoped_sales s`,
          values,
        ),

        this.database.query<{ period: string; sales: string; transactions: number }>(
          `select
             to_char(s.completed_at at time zone $7, 'YYYY-MM-DD') as period,
             coalesce(sum(s.total), 0)::text as sales,
             count(distinct s.id)::int as transactions
           from sales s
           where s.organization_id = $1 and s.completed_at >= $2 and s.completed_at < $3
             and s.status in ('completed','partially_refunded','refunded')
             and ${branchScopeSQL('s')}
           group by 1 order by 1 asc`,
          [...values, scope.organizationTimezone],
        ),

        this.database.query<{ branchName: string; totalSales: string }>(
          `select b.name as "branchName", coalesce(sum(s.total), 0)::text as "totalSales"
           from sales s join branches b on b.id = s.branch_id
           where s.organization_id = $1 and s.completed_at >= $2 and s.completed_at < $3
             and s.status in ('completed','partially_refunded','refunded')
             and ${branchScopeSQL('s')}
           group by b.name order by sum(s.total) desc`,
          values,
        ),

        this.database.query<{ categoryName: string; totalSales: string }>(
          `select coalesce(c.name, 'Uncategorized') as "categoryName", coalesce(sum(si.line_total), 0)::text as "totalSales"
           from sale_items si
           join sales s on s.id = si.sale_id
           join products p on p.id = si.product_id
           left join categories c on c.id = p.category_id
           where si.organization_id = $1 and s.completed_at >= $2 and s.completed_at < $3
             and s.status in ('completed','partially_refunded','refunded')
             and ${branchScopeSQL('s')}
           group by c.name order by sum(si.line_total) desc limit 10`,
          values,
        ),

        this.database.query<{ method: string; totalAmount: string }>(
          `select p.method, coalesce(sum(p.amount), 0)::text as "totalAmount"
           from payments p join sales s on s.id = p.sale_id
           where p.organization_id = $1 and s.completed_at >= $2 and s.completed_at < $3
             and s.status in ('completed','partially_refunded','refunded')
             and ${branchScopeSQL('s')}
           group by p.method order by sum(p.amount) desc`,
          values,
        ),

        this.database.query<{ name: string; sales: string; quantity: number; unit: string }>(
          `select si.product_name as name, coalesce(sum(si.line_total), 0)::text as sales,
                  coalesce(sum(si.quantity), 0)::float8 as quantity,
                  coalesce(v.unit, p.unit) as unit
           from sale_items si
           join sales s on s.id = si.sale_id
           join products p on p.id = si.product_id
           left join product_variants v on v.id = si.variant_id
           where si.organization_id = $1 and s.completed_at >= $2 and s.completed_at < $3
             and s.status in ('completed','partially_refunded','refunded')
             and ${branchScopeSQL('s')}
           group by si.product_name, coalesce(v.unit, p.unit)
           order by sum(si.line_total) desc limit 10`,
          values,
        ),

        this.database.query<{ hourOfDay: number; sales: string; transactions: number }>(
          `select extract(hour from s.completed_at at time zone $7)::int as "hourOfDay",
                  coalesce(sum(s.total), 0)::text as sales,
                  count(distinct s.id)::int as transactions
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

    const kpis = kpiResult.rows[0] ?? {
      merchandiseSubtotal: '0.00',
      discounts: '0.00',
      taxesCollected: '0.00',
      finalSales: '0.00',
      customerRefunds: '0.00',
      netSalesAfterRefunds: '0.00',
      transactions: 0,
      averageTransactionValue: '0.00',
      averageNetRevenuePerTransaction: '0.00',
      sellingUnitsSold: 0,
      equivalentBaseUnitsSold: 0,
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
        formulaDescription: 'SUM(sales.subtotal) list merchandise price before discounts',
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
        formulaDescription: 'SUM(returns.refund_total) created in period',
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
      {
        cardId: 'average_transaction_value',
        label: 'Average Transaction Value',
        value: Number(kpis.averageTransactionValue),
        formattedValue: formatMoney(kpis.averageTransactionValue),
        drillDownAvailable: true,
        exportAvailable: true,
        formulaDescription: 'Final Sales / Transaction Count',
      },
      {
        cardId: 'average_net_revenue',
        label: 'Average Net Revenue / Txn',
        value: Number(kpis.averageNetRevenuePerTransaction),
        formattedValue: formatMoney(kpis.averageNetRevenuePerTransaction),
        drillDownAvailable: true,
        exportAvailable: true,
        formulaDescription: 'Net Sales After Refunds / Transaction Count',
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
      summaryCards.push(
        {
          cardId: 'gross_profit',
          label: 'Gross Profit',
          value: Number(kpis.grossProfit),
          formattedValue: formatMoney(kpis.grossProfit),
          drillDownAvailable: true,
          exportAvailable: true,
          formulaDescription: 'Net Sales After Refunds - COGS',
          isSensitive: true,
        },
        {
          cardId: 'gross_margin_percent',
          label: 'Gross Margin %',
          value: Number(kpis.grossMarginPercent),
          formattedValue: `${Number(kpis.grossMarginPercent).toFixed(2)}%`,
          drillDownAvailable: true,
          exportAvailable: true,
          formulaDescription: '(Gross Profit / Net Sales After Refunds) * 100',
          isSensitive: true,
        },
      );
    }

    const series: ReportSeriesContract[] = [
      {
        seriesId: 'net_sales_trend',
        label: 'Net Sales Over Time',
        chartType: 'line',
        xAxis: 'date',
        yAxis: 'sales',
        data: trendResult.rows.map((r) => ({ x: r.period, y: Number(r.sales), label: formatMoney(r.sales) })),
      },
      {
        seriesId: 'sales_by_branch',
        label: 'Sales by Branch',
        chartType: 'bar',
        xAxis: 'branch',
        yAxis: 'sales',
        data: branchSalesResult.rows.map((r) => ({ x: r.branchName, y: Number(r.totalSales), label: formatMoney(r.totalSales) })),
      },
      {
        seriesId: 'sales_by_category',
        label: 'Sales by Category',
        chartType: 'donut',
        xAxis: 'category',
        yAxis: 'sales',
        data: catSalesResult.rows.map((r) => ({ x: r.categoryName, y: Number(r.totalSales), label: formatMoney(r.totalSales) })),
      },
      {
        seriesId: 'payment_method_distribution',
        label: 'Payment Method Distribution',
        chartType: 'donut',
        xAxis: 'method',
        yAxis: 'amount',
        data: paymentDistResult.rows.map((r) => ({ x: r.method, y: Number(r.totalAmount), label: formatMoney(r.totalAmount) })),
      },
      {
        seriesId: 'top_products_sales',
        label: 'Top Products by Sales',
        chartType: 'bar',
        xAxis: 'product',
        yAxis: 'sales',
        data: topProductsResult.rows.map((r) => ({ x: r.name, y: Number(r.sales), label: formatMoney(r.sales) })),
      },
      {
        seriesId: 'sales_by_hour',
        label: 'Sales by Hour of Day',
        chartType: 'line',
        xAxis: 'hour',
        yAxis: 'sales',
        data: hourlyResult.rows.map((r) => ({ x: `${r.hourOfDay}:00`, y: Number(r.sales), label: formatMoney(r.sales) })),
      },
    ];

    return {
      reportId: 'overview',
      title: 'Executive Overview',
      description: 'High-level business revenue, transaction volume, and profitability performance',
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
      series,
      rows: [],
      pagination: { totalRows: 0, page: 1, pageSize: 50 },
      warnings: [],
    };
  }
}
