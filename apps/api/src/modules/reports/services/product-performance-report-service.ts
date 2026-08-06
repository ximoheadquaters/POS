import type { Database } from '../../../database/types.js';
import type { CanonicalReportResponse, SummaryCardContract, ReportSeriesContract, ReportDetailRowContract } from '@ximo/shared';
import { formatMoney } from '@ximo/shared';
import type { ReportScopeContext } from '../report-permission-resolver.js';
import { sanitizeReportSensitiveFields } from '../report-permission-resolver.js';

export class ProductPerformanceReportService {
  constructor(private readonly database: Database) {}

  async generate(
    scope: ReportScopeContext,
    filter: { from: string; to: string; branchId?: string; categoryId?: string; page?: number; pageSize?: number },
  ): Promise<CanonicalReportResponse> {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(10, filter.pageSize ?? 20));
    const offset = (page - 1) * pageSize;

    const filterValues = [
      scope.organizationId,
      scope.fromIso,
      scope.toIso,
      scope.branchId ?? null,
      scope.hasAllBranchesAccess,
      scope.allowedBranchIds,
      filter.categoryId ?? null,
    ] as const;
    const pageValues = [...filterValues, pageSize, offset] as const;

    const branchScopeSQL = (alias: string) =>
      `($4::uuid is null or ${alias}.branch_id=$4)
       and ($5::boolean or ${alias}.branch_id=any($6::uuid[]))`;

    const categoryScopeSQL = (alias: string) =>
      `($7::uuid is null or ${alias}.category_id=$7)`;

    const [summaryResult, listResult, countResult, topRevResult, topQtyResult, branchInfo] = await Promise.all([
      this.database.query<{
        productsSold: number;
        sellingUnitsSold: number;
        equivalentBaseUnitsSold: number;
        productRevenue: string;
        productDiscounts: string;
        productRefunds: string;
        netProductSales: string;
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
         scoped_items as (
           select si.*
           from sale_items si
           join scoped_sales s on s.id = si.sale_id
           join products p on p.id = si.product_id
           where ${categoryScopeSQL('p')}
         ),
         scoped_returns as (
           select r.* from returns r
           where r.organization_id=$1 and r.created_at >= $2 and r.created_at < $3
             and ${branchScopeSQL('r')}
         ),
         return_cost as (
           select coalesce(sum(ri.quantity * si.unit_cost), 0) as total,
                  coalesce(sum(ri.refund_amount), 0) as refund_total
           from return_items ri
           join scoped_returns r on r.id = ri.return_id
           join scoped_items si on si.id = ri.sale_item_id
         )
         select
           count(distinct si.product_id)::int as "productsSold",
           coalesce(sum(si.quantity), 0)::float8 as "sellingUnitsSold",
           coalesce(sum(si.quantity * coalesce(si.units_per_base, 1)), 0)::float8 as "equivalentBaseUnitsSold",
           coalesce(sum(si.line_total), 0)::text as "productRevenue",
           coalesce(sum(si.discount_total), 0)::text as "productDiscounts",
           coalesce((select refund_total from return_cost), 0)::text as "productRefunds",
           (coalesce(sum(si.line_total), 0) - coalesce((select refund_total from return_cost), 0))::text as "netProductSales",
           (coalesce(sum(si.quantity * si.unit_cost), 0) - coalesce((select total from return_cost), 0))::text as "cogs",
           (coalesce(sum(si.line_total), 0) - coalesce((select refund_total from return_cost), 0) - (coalesce(sum(si.quantity * si.unit_cost), 0) - coalesce((select total from return_cost), 0)))::text as "grossProfit",
           case when (coalesce(sum(si.line_total), 0) - coalesce((select refund_total from return_cost), 0)) > 0
             then round(100 * (coalesce(sum(si.line_total), 0) - coalesce((select refund_total from return_cost), 0) - (coalesce(sum(si.quantity * si.unit_cost), 0) - coalesce((select total from return_cost), 0))) / (coalesce(sum(si.line_total), 0) - coalesce((select refund_total from return_cost), 0)), 2)::text
             else '0.00' end as "grossMarginPercent"
         from scoped_items si`,
        filterValues,
      ),

      this.database.query<{
        id: string;
        name: string;
        sku: string;
        categoryName: string;
        sellingUnit: string;
        baseUnit: string;
        sellingUnitsSold: number;
        unitsPerBase: number;
        baseUnitsSold: number;
        revenue: string;
        discounts: string;
        netSales: string;
        avgSellingPrice: string;
        cost: string;
        profit: string;
        margin: string;
      }>(
        `select
           p.id,
           si.product_name as name,
           si.sku,
           coalesce(c.name, 'Uncategorized') as "categoryName",
           coalesce(v.unit, p.unit) as "sellingUnit",
           p.unit as "baseUnit",
           coalesce(sum(si.quantity), 0)::float8 as "sellingUnitsSold",
           coalesce(si.units_per_base, v.units_per_base, 1)::float8 as "unitsPerBase",
           coalesce(sum(si.quantity * coalesce(si.units_per_base, v.units_per_base, 1)), 0)::float8 as "baseUnitsSold",
           coalesce(sum(si.line_total), 0)::text as revenue,
           coalesce(sum(si.discount_total), 0)::text as discounts,
           coalesce(sum(si.line_total), 0)::text as "netSales",
           case when sum(si.quantity) > 0
             then round(sum(si.line_total) / sum(si.quantity), 2)::text
             else '0.00' end as "avgSellingPrice",
           coalesce(sum(si.quantity * si.unit_cost), 0)::text as cost,
           (coalesce(sum(si.line_total), 0) - coalesce(sum(si.quantity * si.unit_cost), 0))::text as profit,
           case when sum(si.line_total) > 0
             then round(100 * (sum(si.line_total) - sum(si.quantity * si.unit_cost)) / sum(si.line_total), 2)::text
             else '0.00' end as margin
         from sale_items si
         join sales s on s.id = si.sale_id
         join products p on p.id = si.product_id
         left join product_variants v on v.id = si.variant_id
         left join categories c on c.id = p.category_id
         where si.organization_id = $1 and s.completed_at >= $2 and s.completed_at < $3
           and s.status in ('completed','partially_refunded','refunded')
           and ${branchScopeSQL('s')}
           and ${categoryScopeSQL('p')}
         group by p.id, si.product_name, si.sku, c.name, coalesce(v.unit, p.unit), p.unit, si.units_per_base, v.units_per_base
         order by sum(si.line_total) desc
         limit $8 offset $9`,
        pageValues,
      ),

      this.database.query<{ totalRows: number }>(
        `select count(distinct p.id)::int as "totalRows"
         from sale_items si
         join sales s on s.id = si.sale_id
         join products p on p.id = si.product_id
         where si.organization_id = $1 and s.completed_at >= $2 and s.completed_at < $3
           and s.status in ('completed','partially_refunded','refunded')
           and ${branchScopeSQL('s')}
           and ${categoryScopeSQL('p')}`,
        filterValues,
      ),

      this.database.query<{ name: string; revenue: string }>(
        `select si.product_name as name, coalesce(sum(si.line_total), 0)::text as revenue
         from sale_items si join sales s on s.id = si.sale_id join products p on p.id = si.product_id
         where si.organization_id = $1 and s.completed_at >= $2 and s.completed_at < $3
           and s.status in ('completed','partially_refunded','refunded')
           and ${branchScopeSQL('s')} and ${categoryScopeSQL('p')}
         group by si.product_name order by sum(si.line_total) desc limit 10`,
        filterValues,
      ),

      this.database.query<{ name: string; quantity: number; unit: string }>(
        `select si.product_name as name, coalesce(sum(si.quantity), 0)::float8 as quantity, coalesce(v.unit, p.unit) as unit
         from sale_items si join sales s on s.id = si.sale_id join products p on p.id = si.product_id left join product_variants v on v.id = si.variant_id
         where si.organization_id = $1 and s.completed_at >= $2 and s.completed_at < $3
           and s.status in ('completed','partially_refunded','refunded')
           and ${branchScopeSQL('s')} and ${categoryScopeSQL('p')}
         group by si.product_name, coalesce(v.unit, p.unit) order by sum(si.quantity) desc limit 10`,
        filterValues,
      ),

      filter.branchId
        ? this.database.query<{ name: string }>('select name from branches where id=$1 and organization_id=$2', [filter.branchId, scope.organizationId])
        : Promise.resolve({ rows: [] }),
    ]);

    const kpis = summaryResult.rows[0] ?? {
      productsSold: 0,
      sellingUnitsSold: 0,
      equivalentBaseUnitsSold: 0,
      productRevenue: '0.00',
      productDiscounts: '0.00',
      productRefunds: '0.00',
      netProductSales: '0.00',
      cogs: '0.00',
      grossProfit: '0.00',
      grossMarginPercent: '0.00',
    };

    const summaryCards: SummaryCardContract[] = [
      {
        cardId: 'products_sold',
        label: 'Distinct Products Sold',
        value: kpis.productsSold,
        formattedValue: String(kpis.productsSold),
        drillDownAvailable: true,
        exportAvailable: true,
        formulaDescription: 'COUNT(distinct products sold)',
      },
      {
        cardId: 'selling_units_sold',
        label: 'Selling Units Sold',
        value: kpis.sellingUnitsSold,
        formattedValue: String(kpis.sellingUnitsSold),
        drillDownAvailable: true,
        exportAvailable: true,
        formulaDescription: 'SUM(selling unit quantity)',
      },
      {
        cardId: 'equivalent_base_units_sold',
        label: 'Equivalent Base Units Sold',
        value: kpis.equivalentBaseUnitsSold,
        formattedValue: String(kpis.equivalentBaseUnitsSold),
        drillDownAvailable: true,
        exportAvailable: true,
        formulaDescription: 'SUM(selling_unit_qty * units_per_base)',
      },
      {
        cardId: 'product_revenue',
        label: 'Product Revenue',
        value: Number(kpis.productRevenue),
        formattedValue: formatMoney(kpis.productRevenue),
        drillDownAvailable: true,
        exportAvailable: true,
        formulaDescription: 'SUM(sale_items.line_total)',
      },
      {
        cardId: 'net_product_sales',
        label: 'Net Product Sales',
        value: Number(kpis.netProductSales),
        formattedValue: formatMoney(kpis.netProductSales),
        drillDownAvailable: true,
        exportAvailable: true,
        formulaDescription: 'Product Revenue - Product Refunds',
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
        formulaDescription: 'Net Product Sales - COGS',
        isSensitive: true,
      });
    }

    const rows: ReportDetailRowContract[] = listResult.rows.map((row) => {
      const sanitized = sanitizeReportSensitiveFields(
        {
          id: row.id,
          title: row.name,
          sku: row.sku,
          category: row.categoryName,
          quantity: row.sellingUnitsSold,
          unit: row.sellingUnit,
          baseQuantity: row.baseUnitsSold,
          baseUnit: row.baseUnit,
          value: formatMoney(row.revenue),
          subValue: `${row.sellingUnitsSold} ${row.sellingUnit} (${row.baseUnitsSold} ${row.baseUnit}) • Avg Price: ${formatMoney(row.avgSellingPrice)}`,
          netCost: formatMoney(row.cost),
          grossProfit: formatMoney(row.profit),
          statusTag: `${row.sellingUnitsSold} ${row.sellingUnit}`,
          statusTone: 'blue' as const,
        },
        scope.canViewCost,
        scope.canViewProfit,
      );
      return sanitized;
    });

    return {
      reportId: 'products',
      title: 'Product Performance Report',
      description: 'Volume, alternate selling unit breakdowns, and product revenue ranking',
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
          seriesId: 'top_products_revenue',
          label: 'Top Products by Revenue',
          chartType: 'bar',
          xAxis: 'product',
          yAxis: 'revenue',
          data: topRevResult.rows.map((r) => ({ x: r.name, y: Number(r.revenue), label: formatMoney(r.revenue) })),
        },
        {
          seriesId: 'top_products_quantity',
          label: 'Top Products by Quantity Sold',
          chartType: 'bar',
          xAxis: 'product',
          yAxis: 'quantity',
          data: topQtyResult.rows.map((r) => ({ x: r.name, y: r.quantity, label: `${r.quantity} ${r.unit}` })),
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
