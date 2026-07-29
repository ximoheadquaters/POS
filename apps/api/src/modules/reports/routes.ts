import { Router } from 'express';
import { paginationSchema, uuidSchema } from '@ximo/shared';
import { z } from 'zod';
import type { Queryable } from '../../database/types.js';
import { requireAnyModule, requirePermission } from '../../middleware/auth.js';
import { validateQuery } from '../../middleware/validation.js';
import { notFound } from '../../shared/errors.js';
import { sendData } from '../../shared/http.js';

const dateFilter = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
});

const workspaceReportFilter = dateFilter.extend({
  branchId: uuidSchema.optional(),
});

const shiftReportFilter = paginationSchema.extend({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  branchId: uuidSchema.optional(),
  status: z.enum(['open', 'closed']).optional(),
});

export function reportsRouter(database: Queryable): Router {
  const router = Router();
  router.use(requireAnyModule('dashboard', 'reports'), requirePermission('reports:read'));
  router.get('/workspace', validateQuery(workspaceReportFilter), async (request, response) => {
    const { from, to, branchId } = request.query as z.infer<typeof workspaceReportFilter>;
    const organizationId = request.authUser!.organization.id;
    const allBranches = request.authUser!.permissions.includes('sales:read_all');
    const allowedBranchIds = request.authUser!.branches.map((branch) => branch.id);
    if (
      branchId &&
      !allBranches &&
      !request.authUser!.branches.some((branch) => branch.id === branchId)
    ) {
      throw notFound('Branch');
    }
    const values = [
      organizationId,
      from,
      to,
      branchId ?? null,
      allBranches,
      allowedBranchIds,
    ] as const;
    const branchScope = (alias: string) =>
      `($4::uuid is null or ${alias}.branch_id=$4)
       and ($5::boolean or ${alias}.branch_id=any($6::uuid[]))`;
    const inventoryValues = [
      organizationId,
      branchId ?? null,
      allBranches,
      allowedBranchIds,
    ] as const;
    const inventoryBranchScope = (alias: string) =>
      `($2::uuid is null or ${alias}.branch_id=$2)
       and ($3::boolean or ${alias}.branch_id=any($4::uuid[]))`;

    const [
      salesKpis,
      paymentMethods,
      topProducts,
      topCategories,
      salesByBranch,
      salesTrend,
      inventoryKpis,
      lowStock,
      inventoryByCategory,
      inventoryMovements,
      purchasingKpis,
      purchaseOrderStatuses,
      topSuppliers,
      profitTrend,
      cashKpis,
    ] = await Promise.all([
      database.query(
        `with scoped_sales as (
           select * from sales s
           where s.organization_id=$1 and s.completed_at >= $2 and s.completed_at < $3
             and s.status in ('completed','partially_refunded','refunded')
             and ${branchScope('s')}
         ),
         sale_cost as (
           select coalesce(sum(si.quantity*si.unit_cost),0) as total
           from sale_items si join scoped_sales s on s.id=si.sale_id
         ),
         scoped_returns as (
           select r.* from returns r
           where r.organization_id=$1 and r.created_at >= $2 and r.created_at < $3
             and ${branchScope('r')}
         ),
         return_cost as (
           select coalesce(sum(ri.quantity*si.unit_cost),0) as total
           from return_items ri
           join scoped_returns r on r.id=ri.return_id
           join sale_items si on si.id=ri.sale_item_id
         )
         select
           coalesce(sum(s.total),0)::text as "grossSales",
           (coalesce(sum(s.total),0)-
             coalesce((select sum(refund_total) from scoped_returns),0))::text as "netSales",
           coalesce((select sum(refund_total) from scoped_returns),0)::text as "customerRefunds",
           coalesce(sum(s.discount_total),0)::text as discounts,
           coalesce(sum(s.tax_total),0)::text as taxes,
           count(s.id)::int as transactions,
           count(distinct s.customer_id) filter (where s.customer_id is not null)::int
             as "uniqueCustomers",
           coalesce(avg(s.total),0)::numeric(14,2)::text as "averageTransaction",
           coalesce((select sum(si.quantity) from sale_items si
             join scoped_sales sold on sold.id=si.sale_id),0)::float8 as "itemsSold",
           ((select total from sale_cost)-(select total from return_cost))::text as "netCost",
           (coalesce(sum(s.total),0)-
             coalesce((select sum(refund_total) from scoped_returns),0)-
             ((select total from sale_cost)-(select total from return_cost)))::text
             as "grossProfit",
           case when coalesce(sum(s.total),0)-
             coalesce((select sum(refund_total) from scoped_returns),0) > 0
             then round(100*(coalesce(sum(s.total),0)-
               coalesce((select sum(refund_total) from scoped_returns),0)-
               ((select total from sale_cost)-(select total from return_cost)))/
               (coalesce(sum(s.total),0)-
               coalesce((select sum(refund_total) from scoped_returns),0)),2)
             else 0 end::text as "grossMarginPercent",
           case when coalesce(sum(s.total),0)>0 then round(100*
             coalesce((select sum(refund_total) from scoped_returns),0)/sum(s.total),2)
             else 0 end::text as "refundRatePercent"
         from scoped_sales s`,
        values,
      ),
      database.query(
        `select pay.method,
          coalesce(sum(case when pay.kind='payment' then pay.amount else -pay.amount end),0)::text
            as total,
          count(*) filter (where pay.kind='payment')::int as transactions
         from payments pay join sales s on s.id=pay.sale_id
         where pay.organization_id=$1 and pay.created_at >= $2 and pay.created_at < $3
           and ${branchScope('s')}
         group by pay.method order by total desc`,
        values,
      ),
      database.query(
        `select si.product_name as name,si.sku,p.unit,
          coalesce(sum(si.quantity),0)::float8 as quantity,
          coalesce(sum(si.line_total),0)::text as sales,
          coalesce(sum(si.quantity*si.unit_cost),0)::text as cost,
          (coalesce(sum(si.line_total),0)-coalesce(sum(si.quantity*si.unit_cost),0))::text
            as profit
         from sale_items si
         join sales s on s.id=si.sale_id
         join products p on p.id=si.product_id
         where si.organization_id=$1 and s.completed_at >= $2 and s.completed_at < $3
           and s.status in ('completed','partially_refunded','refunded')
           and ${branchScope('s')}
         group by si.product_name,si.sku,p.unit order by sales desc limit 10`,
        values,
      ),
      database.query(
        `select coalesce(c.name,'Uncategorized') as name,
          coalesce(sum(si.line_total),0)::text as sales,
          coalesce(sum(si.quantity),0)::float8 as quantity
         from sale_items si
         join sales s on s.id=si.sale_id
         join products p on p.id=si.product_id
         left join categories c on c.id=p.category_id
         where si.organization_id=$1 and s.completed_at >= $2 and s.completed_at < $3
           and s.status in ('completed','partially_refunded','refunded')
           and ${branchScope('s')}
         group by c.id,c.name order by sales desc limit 10`,
        values,
      ),
      database.query(
        `select b.id,b.name,coalesce(sum(s.total),0)::text as sales,
          count(s.id)::int as transactions
         from branches b
         left join sales s on s.branch_id=b.id and s.completed_at >= $2
           and s.completed_at < $3
           and s.status in ('completed','partially_refunded','refunded')
         where b.organization_id=$1
           and ($4::uuid is null or b.id=$4)
           and ($5::boolean or b.id=any($6::uuid[]))
         group by b.id order by sales desc`,
        values,
      ),
      database.query(
        `select to_char(date_trunc('day',s.completed_at),'YYYY-MM-DD') as date,
          coalesce(sum(s.total),0)::text as sales,count(*)::int as transactions
         from sales s where s.organization_id=$1 and s.completed_at >= $2
           and s.completed_at < $3 and s.status in ('completed','partially_refunded','refunded')
           and ${branchScope('s')}
         group by date_trunc('day',s.completed_at)
         order by date_trunc('day',s.completed_at) desc limit 31`,
        values,
      ),
      database.query(
        `select count(*)::int as "stockRecords",
          count(*) filter (where bi.quantity<=0)::int as "outOfStockCount",
          count(*) filter (where bi.quantity>0 and bi.quantity<=bi.low_stock_level)::int
            as "lowStockCount",
          count(distinct p.id) filter (where p.status='active')::int as "activeProducts",
          coalesce(sum(bi.quantity),0)::float8 as "unitsOnHand",
          coalesce(sum(bi.inventory_value),0)::text as "inventoryValue",
          coalesce(sum(case when bi.quantity>0 then bi.inventory_value else 0 end),0)::text
            as "stockValue"
         from branch_inventory bi join products p on p.id=bi.product_id
         where bi.organization_id=$1 and p.track_inventory and ${inventoryBranchScope('bi')}`,
        inventoryValues,
      ),
      database.query(
        `select p.id,p.name,p.sku,p.unit,b.name as "branchName",
          bi.quantity::float8 as quantity,bi.low_stock_level::float8 as "lowStockLevel",
          bi.inventory_value::text as "inventoryValue"
         from branch_inventory bi join products p on p.id=bi.product_id
         join branches b on b.id=bi.branch_id
         where bi.organization_id=$1 and p.track_inventory
           and bi.quantity<=bi.low_stock_level and ${inventoryBranchScope('bi')}
         order by case when bi.quantity<=0 then 0 else 1 end,bi.quantity limit 50`,
        inventoryValues,
      ),
      database.query(
        `select coalesce(c.name,'Uncategorized') as name,
          coalesce(sum(bi.inventory_value),0)::text as value,
          coalesce(sum(bi.quantity),0)::float8 as quantity,
          count(*)::int as products
         from branch_inventory bi join products p on p.id=bi.product_id
         left join categories c on c.id=p.category_id
         where bi.organization_id=$1 and p.track_inventory and ${inventoryBranchScope('bi')}
         group by c.id,c.name order by value desc limit 10`,
        inventoryValues,
      ),
      database.query(
        `select im.movement_type as type,count(*)::int as movements,
          coalesce(sum(abs(im.quantity_delta)),0)::float8 as quantity
         from inventory_movements im where im.organization_id=$1
           and im.created_at >= $2 and im.created_at < $3 and ${branchScope('im')}
         group by im.movement_type order by movements desc`,
        values,
      ),
      database.query(
        `select
          count(po.id)::int as "purchaseOrders",
          count(po.id) filter (where po.status in ('ordered','partially_received'))::int
            as "openOrders",
          coalesce(sum(po.subtotal) filter
            (where po.status not in ('draft','cancelled')),0)::text as "orderedValue",
          coalesce((select sum(sri.purchase_quantity*sri.unit_cost)
            from stock_receipt_items sri join stock_receipts sr on sr.id=sri.stock_receipt_id
            where sr.organization_id=$1 and sr.received_at >= $2 and sr.received_at < $3
              and ${branchScope('sr')}),0)::text as "receivedValue",
          coalesce((select sum(pr.total) from purchase_returns pr
            where pr.organization_id=$1 and pr.created_at >= $2 and pr.created_at < $3
              and ${branchScope('pr')}),0)::text as "supplierReturns",
          coalesce((select sum(si.total-si.paid_amount) from supplier_invoices si
            where si.organization_id=$1 and si.status not in ('credited','void')
              and ${branchScope('si')}),0)::text as "outstandingPayables",
          coalesce((select sum(sp.amount) from supplier_payments sp
            where sp.organization_id=$1 and sp.paid_at >= $2 and sp.paid_at < $3
              and ${branchScope('sp')}),0)::text as "supplierPayments",
          coalesce((select sum(sr.amount) from supplier_refunds sr
            where sr.organization_id=$1 and sr.received_at >= $2 and sr.received_at < $3
              and ${branchScope('sr')}),0)::text as "supplierRefunds"
         from purchase_orders po where po.organization_id=$1
           and po.created_at >= $2 and po.created_at < $3 and ${branchScope('po')}`,
        values,
      ),
      database.query(
        `select po.status,count(*)::int as orders,coalesce(sum(po.subtotal),0)::text as value
         from purchase_orders po where po.organization_id=$1
           and po.created_at >= $2 and po.created_at < $3 and ${branchScope('po')}
         group by po.status order by orders desc`,
        values,
      ),
      database.query(
        `select s.id,s.name,count(po.id)::int as orders,
          coalesce(sum(po.subtotal) filter
            (where po.status not in ('draft','cancelled')),0)::text as value
         from suppliers s join purchase_orders po on po.supplier_id=s.id
         where s.organization_id=$1 and po.created_at >= $2 and po.created_at < $3
           and ${branchScope('po')}
         group by s.id order by value desc limit 10`,
        values,
      ),
      database.query(
        `with daily_sales as (
           select date_trunc('day',s.completed_at)::date as day,sum(s.total) as sales,
             sum(s.cost_total) as cost
           from sales s where s.organization_id=$1 and s.completed_at >= $2
             and s.completed_at < $3 and s.status in
               ('completed','partially_refunded','refunded') and ${branchScope('s')}
           group by date_trunc('day',s.completed_at)::date
         ), daily_returns as (
           select date_trunc('day',r.created_at)::date as day,sum(r.refund_total) as refunds
           from returns r
           where r.organization_id=$1 and r.created_at >= $2 and r.created_at < $3
             and ${branchScope('r')}
           group by date_trunc('day',r.created_at)::date
         ), daily_return_cost as (
           select date_trunc('day',r.created_at)::date as day,
             sum(ri.quantity*si.unit_cost) as returned_cost
           from returns r join return_items ri on ri.return_id=r.id
           join sale_items si on si.id=ri.sale_item_id
           where r.organization_id=$1 and r.created_at >= $2 and r.created_at < $3
             and ${branchScope('r')}
           group by date_trunc('day',r.created_at)::date
         )
         select to_char(coalesce(ds.day,dr.day),'YYYY-MM-DD') as date,
           (coalesce(ds.sales,0)-coalesce(dr.refunds,0))::text as "netSales",
           (coalesce(ds.cost,0)-coalesce(drc.returned_cost,0))::text as "netCost",
           (coalesce(ds.sales,0)-coalesce(dr.refunds,0)-
             coalesce(ds.cost,0)+coalesce(drc.returned_cost,0))::text as profit
         from daily_sales ds full join daily_returns dr on dr.day=ds.day
         left join daily_return_cost drc on drc.day=coalesce(ds.day,dr.day)
         order by coalesce(ds.day,dr.day) desc limit 31`,
        values,
      ),
      database.query(
        `select count(*)::int as shifts,
          count(*) filter (where rs.status='open')::int as "openShifts",
          coalesce(sum(rs.cash_sales),0)::text as "cashSales",
          coalesce(sum(rs.cash_refunds),0)::text as "cashRefunds",
          coalesce(sum(case when rs.status='closed' then rs.actual_cash else 0 end),0)::text
            as "countedCash",
          coalesce(sum(case when rs.status='closed' then rs.variance else 0 end),0)::text
            as variance,
          coalesce(sum(cm.cash_in),0)::text as "cashIn",
          coalesce(sum(cm.cash_out),0)::text as "cashOut"
         from register_shifts rs left join lateral (
           select coalesce(sum(amount) filter (where type='cash_in'),0) as cash_in,
             coalesce(sum(amount) filter (where type='cash_out'),0) as cash_out
           from cash_movements where shift_id=rs.id
         ) cm on true
         where rs.organization_id=$1 and rs.opened_at >= $2 and rs.opened_at < $3
           and ${branchScope('rs')}`,
        values,
      ),
    ]);

    sendData(response, {
      range: { from, to, branchId: branchId ?? null },
      kpis: salesKpis.rows[0],
      sales: {
        paymentMethods: paymentMethods.rows,
        topProducts: topProducts.rows,
        topCategories: topCategories.rows,
        branches: salesByBranch.rows,
        trend: salesTrend.rows.reverse(),
      },
      inventory: {
        ...inventoryKpis.rows[0],
        lowStock: lowStock.rows,
        byCategory: inventoryByCategory.rows,
        movements: inventoryMovements.rows,
      },
      purchasing: {
        ...purchasingKpis.rows[0],
        orderStatuses: purchaseOrderStatuses.rows,
        topSuppliers: topSuppliers.rows,
      },
      profit: {
        grossSales: salesKpis.rows[0]?.grossSales ?? '0',
        refunds: salesKpis.rows[0]?.customerRefunds ?? '0',
        netSales: salesKpis.rows[0]?.netSales ?? '0',
        netCost: salesKpis.rows[0]?.netCost ?? '0',
        grossProfit: salesKpis.rows[0]?.grossProfit ?? '0',
        grossMarginPercent: salesKpis.rows[0]?.grossMarginPercent ?? '0',
        trend: profitTrend.rows.reverse(),
      },
      cash: cashKpis.rows[0],
    });
  });
  router.get('/summary', validateQuery(dateFilter), async (request, response) => {
    const { from, to } = request.query as any;
    const organizationId = request.authUser!.organization.id;
    const [summary, payments, products, branches, lowStock] = await Promise.all([
      database.query(
        `select coalesce(sum(total),0)::text as "salesTotal",count(*)::int as transactions,
          coalesce(avg(total),0)::numeric(14,2)::text as "averageTransaction",
          coalesce(sum(total-cost_total),0)::text as "grossProfit"
         from sales where organization_id=$1 and status in ('completed','partially_refunded')
           and completed_at >= $2 and completed_at < $3`,
        [organizationId, from, to],
      ),
      database.query(
        `select pay.method,coalesce(sum(case when pay.kind='payment' then pay.amount else -pay.amount end),0)::text as total
         from payments pay join sales s on s.id=pay.sale_id
         where pay.organization_id=$1 and s.completed_at >= $2 and s.completed_at < $3
         group by pay.method order by pay.method`,
        [organizationId, from, to],
      ),
      database.query(
        `select si.product_name as name,p.unit,
          sum((si.quantity-si.returned_quantity)*coalesce(v.units_per_base,1))::float8 as quantity,
          sum(si.line_total)::text as total
         from sale_items si join sales s on s.id=si.sale_id
         join products p on p.id=si.product_id and p.organization_id=si.organization_id
         left join product_variants v
           on v.id=si.variant_id and v.organization_id=si.organization_id
         where si.organization_id=$1 and s.completed_at >= $2 and s.completed_at < $3
         group by si.product_name,p.id,p.unit order by quantity desc limit 10`,
        [organizationId, from, to],
      ),
      database.query(
        `select b.name,coalesce(sum(s.total),0)::text as total,count(s.id)::int as transactions
         from branches b left join sales s on s.branch_id=b.id and s.completed_at >= $2 and s.completed_at < $3
         where b.organization_id=$1 group by b.id order by total desc`,
        [organizationId, from, to],
      ),
      database.query(
        `select p.id,p.name,p.sku,p.unit,b.name as "branchName",
          bi.quantity::float8 as quantity,bi.low_stock_level::float8 as "lowStockLevel"
         from branch_inventory bi join products p on p.id=bi.product_id join branches b on b.id=bi.branch_id
         where bi.organization_id=$1 and p.track_inventory
           and bi.quantity<=bi.low_stock_level order by bi.quantity limit 50`,
        [organizationId],
      ),
    ]);
    sendData(response, {
      ...summary.rows[0],
      salesByPaymentMethod: payments.rows,
      bestSellingProducts: products.rows,
      salesByBranch: branches.rows,
      lowStock: lowStock.rows,
    });
  });
  router.get('/shifts', validateQuery(shiftReportFilter), async (request, response) => {
    const { from, to, branchId, status, page, pageSize } = request.query as unknown as z.infer<
      typeof shiftReportFilter
    >;
    const organizationId = request.authUser!.organization.id;
    const allBranches = request.authUser!.permissions.includes('sales:read_all');
    const allowedBranchIds = request.authUser!.branches.map((branch) => branch.id);
    if (
      branchId &&
      !allBranches &&
      !request.authUser!.branches.some((branch) => branch.id === branchId)
    ) {
      throw notFound('Branch');
    }
    const values = [
      organizationId,
      from,
      to,
      branchId ?? null,
      status ?? null,
      allBranches,
      allowedBranchIds,
    ] as const;
    const [summary, shifts] = await Promise.all([
      database.query(
        `select count(*)::int as "shiftCount",
          count(*) filter (where rs.status='open')::int as "openShiftCount",
          coalesce(sum(rs.cash_sales),0)::text as "cashSales",
          coalesce(sum(rs.cash_refunds),0)::text as "cashRefunds",
          coalesce(sum(case when rs.status='closed' then rs.expected_cash else 0 end),0)::text
            as "expectedCash",
          coalesce(sum(case when rs.status='closed' then rs.actual_cash else 0 end),0)::text
            as "actualCash",
          coalesce(sum(case when rs.status='closed' then rs.variance else 0 end),0)::text
            as variance,
          coalesce(sum(cm.cash_in),0)::text as "cashIn",
          coalesce(sum(cm.cash_out),0)::text as "cashOut"
         from register_shifts rs
         left join lateral (
           select
             coalesce(sum(amount) filter (where type='cash_in'),0) as cash_in,
             coalesce(sum(amount) filter (where type='cash_out'),0) as cash_out
           from cash_movements where shift_id=rs.id
         ) cm on true
         where rs.organization_id=$1 and rs.opened_at >= $2 and rs.opened_at < $3
           and ($4::uuid is null or rs.branch_id=$4)
           and ($5::shift_status is null or rs.status=$5)
           and ($6::boolean or rs.branch_id=any($7::uuid[]))`,
        values,
      ),
      database.query(
        `select rs.id,rs.status,rs.opened_at as "openedAt",rs.closed_at as "closedAt",
          rs.starting_cash::text as "startingCash",rs.cash_sales::text as "cashSales",
          rs.cash_refunds::text as "cashRefunds",rs.expected_cash::text as "expectedCash",
          rs.actual_cash::text as "actualCash",rs.variance::text,rs.notes,
          b.id as "branchId",b.name as "branchName",r.name as "registerName",
          p.display_name as "cashierName",
          coalesce((select sum(cm.amount) from cash_movements cm
            where cm.shift_id=rs.id and cm.type='cash_in'),0)::text as "cashIn",
          coalesce((select sum(cm.amount) from cash_movements cm
            where cm.shift_id=rs.id and cm.type='cash_out'),0)::text as "cashOut",
          (select count(*)::int from sales s where s.shift_id=rs.id) as transactions,
          coalesce((select sum(s.total) from sales s where s.shift_id=rs.id),0)::text as "salesTotal",
          count(*) over()::int as total
         from register_shifts rs
         join branches b on b.id=rs.branch_id
         join registers r on r.id=rs.register_id
         join profiles p on p.id=rs.cashier_id
         where rs.organization_id=$1 and rs.opened_at >= $2 and rs.opened_at < $3
           and ($4::uuid is null or rs.branch_id=$4)
           and ($5::shift_status is null or rs.status=$5)
           and ($6::boolean or rs.branch_id=any($7::uuid[]))
         order by rs.opened_at desc limit $8 offset $9`,
        [...values, pageSize, (page - 1) * pageSize],
      ),
    ]);
    const total = shifts.rows[0]?.total ?? 0;
    sendData(response, {
      summary: summary.rows[0],
      shifts: shifts.rows.map(({ total: _total, ...row }) => row),
      page,
      pageSize,
      total,
    });
  });
  router.get('/shifts/:id', async (request, response) => {
    const id = uuidSchema.parse(request.params.id);
    const organizationId = request.authUser!.organization.id;
    const allBranches = request.authUser!.permissions.includes('sales:read_all');
    const result = await database.query<any>(
      `select rs.id,rs.status,rs.opened_at as "openedAt",rs.closed_at as "closedAt",
        rs.starting_cash::text as "startingCash",rs.cash_sales::text as "cashSales",
        rs.cash_refunds::text as "cashRefunds",rs.expected_cash::text as "expectedCash",
        rs.actual_cash::text as "actualCash",rs.variance::text,rs.notes,
        b.name as "branchName",r.name as "registerName",p.display_name as "cashierName",
        coalesce((select sum(cm.amount) from cash_movements cm
          where cm.shift_id=rs.id and cm.type='cash_in'),0)::text as "cashIn",
        coalesce((select sum(cm.amount) from cash_movements cm
          where cm.shift_id=rs.id and cm.type='cash_out'),0)::text as "cashOut",
        (select count(*)::int from sales s where s.shift_id=rs.id) as transactions,
        coalesce((select sum(s.total) from sales s where s.shift_id=rs.id),0)::text as "salesTotal"
       from register_shifts rs
       join branches b on b.id=rs.branch_id
       join registers r on r.id=rs.register_id
       join profiles p on p.id=rs.cashier_id
       where rs.id=$1 and rs.organization_id=$2
         and ($3::boolean or rs.branch_id=any($4::uuid[]))`,
      [id, organizationId, allBranches, request.authUser!.branches.map((branch) => branch.id)],
    );
    if (!result.rows[0]) throw notFound('Shift');
    const [movements, payments, sales, refunds] = await Promise.all([
      database.query(
        `select cm.id,cm.type,cm.amount::text,cm.reason,cm.created_at as "createdAt",
          p.display_name as "createdBy"
         from cash_movements cm join profiles p on p.id=cm.created_by
         where cm.shift_id=$1 and cm.organization_id=$2 order by cm.created_at`,
        [id, organizationId],
      ),
      database.query(
        `select pay.method,
          coalesce(sum(case when pay.kind='payment' then pay.amount else 0 end),0)::text
            as payments,
          coalesce(sum(case when pay.kind='refund' then pay.amount else 0 end),0)::text
            as refunds
         from payments pay join sales s on s.id=pay.sale_id
         where s.shift_id=$1 and pay.organization_id=$2 group by pay.method order by pay.method`,
        [id, organizationId],
      ),
      database.query(
        `select s.id,s.receipt_number as "receiptNumber",s.total::text,s.status,
          s.completed_at as "completedAt"
         from sales s where s.shift_id=$1 and s.organization_id=$2
         order by s.completed_at desc limit 100`,
        [id, organizationId],
      ),
      database.query(
        `select r.id,r.return_number as "returnNumber",r.refund_method as method,
          r.refund_total::text as total,r.created_at as "createdAt"
         from returns r where r.shift_id=$1 and r.organization_id=$2
         order by r.created_at desc limit 100`,
        [id, organizationId],
      ),
    ]);
    sendData(response, {
      ...result.rows[0],
      movements: movements.rows,
      payments: payments.rows,
      sales: sales.rows,
      refunds: refunds.rows,
    });
  });
  return router;
}
