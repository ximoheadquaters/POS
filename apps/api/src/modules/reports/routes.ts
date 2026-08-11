import { Router } from 'express';
import { paginationSchema, uuidSchema } from '@ximo/shared';
import { z } from 'zod';
import type { Queryable } from '../../database/types.js';
import { requireAnyModule, requirePermission } from '../../middleware/auth.js';
import { validateQuery } from '../../middleware/validation.js';
import { badRequest, forbidden, notFound } from '../../shared/errors.js';
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
  branchId: uuidSchema,
  status: z.enum(['open', 'closed']).optional(),
});

import { REPORT_CATALOG } from '@ximo/shared';
import { resolveReportScope } from './report-permission-resolver.js';
import { SalesSummaryReportService } from './services/sales-summary-service.js';
import { OverviewReportService } from './services/overview-report-service.js';
import { SalesReportService } from './services/sales-report-service.js';
import { ProductPerformanceReportService } from './services/product-performance-report-service.js';
import { InventoryReportService } from './services/inventory-report-service.js';
import { TransactionDetailService } from './services/transaction-detail-service.js';
import type { Database } from '../../database/types.js';

export function reportsRouter(database: Queryable): Router {
  const router = Router();
  const db = database as Database;
  const salesSummaryService = new SalesSummaryReportService(db);
  const overviewService = new OverviewReportService(db);
  const salesReportService = new SalesReportService(db);
  const productPerformanceService = new ProductPerformanceReportService(db);
  const inventoryReportService = new InventoryReportService(db);
  const transactionDetailService = new TransactionDetailService(db);

  router.use(requireAnyModule('dashboard', 'reports'), requirePermission('reports:read'));

  router.get('/catalog', (request, response) => {
    const user = request.authUser!;
    const effectiveModules = (user.modules || []) as string[];
    const permissions = user.permissions || [];
    const filteredCatalog = REPORT_CATALOG.filter((report) => {
      const hasModules = report.requiredModules.every((m) => effectiveModules.includes(m));
      const hasCaps = report.requiredCapabilities.every((c) => permissions.includes(c));
      return hasModules && hasCaps;
    });
    sendData(response, { catalog: filteredCatalog });
  });

  router.use((request, _response, next) => {
    const branchId = typeof request.query.branchId === 'string' ? request.query.branchId : '';
    if (!branchId) {
      const canViewAllBranches =
        request.authUser!.permissions.includes('reports:view_all_branches') ||
        request.authUser!.permissions.includes('sales:read_all');
      return canViewAllBranches
        ? next()
        : next(badRequest('BRANCH_REQUIRED', 'Select a branch to view this report'));
    }
    if (!request.authUser!.branches.some((branch) => branch.id === branchId)) {
      return next(forbidden('BRANCH_ACCESS_DENIED', 'You do not have access to this branch'));
    }
    next();
  });

  router.get('/overview', async (request, response) => {
    const fromStr = (request.query.from as string) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const toStr = (request.query.to as string) || new Date().toISOString().slice(0, 10);
    const branchIdStr = typeof request.query.branchId === 'string' && request.query.branchId ? request.query.branchId : undefined;
    const filterInput: { from: string; to: string; branchId?: string } = { from: fromStr, to: toStr };
    if (branchIdStr) filterInput.branchId = branchIdStr;
    const scope = resolveReportScope(request.authUser!, filterInput);
    const result = await overviewService.generate(scope, filterInput);
    sendData(response, result);
  });

  router.get('/sales', async (request, response) => {
    const fromStr = (request.query.from as string) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const toStr = (request.query.to as string) || new Date().toISOString().slice(0, 10);
    const branchIdStr = typeof request.query.branchId === 'string' && request.query.branchId ? request.query.branchId : undefined;
    const searchStr = typeof request.query.search === 'string' && request.query.search ? request.query.search : undefined;
    const pageNum = request.query.page ? parseInt(String(request.query.page), 10) : 1;
    const pageSizeNum = request.query.pageSize ? parseInt(String(request.query.pageSize), 10) : 20;

    const filterInput: { from: string; to: string; branchId?: string; search?: string; page?: number; pageSize?: number } = {
      from: fromStr,
      to: toStr,
      page: pageNum,
      pageSize: pageSizeNum,
    };
    if (branchIdStr) filterInput.branchId = branchIdStr;
    if (searchStr) filterInput.search = searchStr;

    const scope = resolveReportScope(request.authUser!, filterInput);
    const result = await salesReportService.generate(scope, filterInput);
    sendData(response, result);
  });

  router.get('/products', async (request, response) => {
    const fromStr = (request.query.from as string) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const toStr = (request.query.to as string) || new Date().toISOString().slice(0, 10);
    const branchIdStr = typeof request.query.branchId === 'string' && request.query.branchId ? request.query.branchId : undefined;
    const categoryIdStr = typeof request.query.categoryId === 'string' && request.query.categoryId ? request.query.categoryId : undefined;
    const pageNum = request.query.page ? parseInt(String(request.query.page), 10) : 1;
    const pageSizeNum = request.query.pageSize ? parseInt(String(request.query.pageSize), 10) : 20;

    const filterInput: { from: string; to: string; branchId?: string; categoryId?: string; page?: number; pageSize?: number } = {
      from: fromStr,
      to: toStr,
      page: pageNum,
      pageSize: pageSizeNum,
    };
    if (branchIdStr) filterInput.branchId = branchIdStr;
    if (categoryIdStr) filterInput.categoryId = categoryIdStr;

    const scope = resolveReportScope(request.authUser!, filterInput);
    const result = await productPerformanceService.generate(scope, filterInput);
    sendData(response, result);
  });

  router.get('/inventory', async (request, response) => {
    const fromStr =
      (request.query.from as string) ||
      new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const toStr = (request.query.to as string) || new Date().toISOString().slice(0, 10);
    const branchIdStr =
      typeof request.query.branchId === 'string' && request.query.branchId
        ? request.query.branchId
        : undefined;
    const pageNum = request.query.page ? parseInt(String(request.query.page), 10) : 1;
    const pageSizeNum = request.query.pageSize
      ? parseInt(String(request.query.pageSize), 10)
      : 100;

    const filterInput: { from: string; to: string; branchId?: string; page?: number; pageSize?: number } =
      {
        from: fromStr,
        to: toStr,
        page: pageNum,
        pageSize: pageSizeNum,
      };
    if (branchIdStr) filterInput.branchId = branchIdStr;

    const scope = resolveReportScope(request.authUser!, filterInput);
    const result = await inventoryReportService.generate(scope, filterInput);
    sendData(response, result);
  });

  router.get('/transactions/:id', async (request, response) => {
    const scope = resolveReportScope(request.authUser!, {
      from: '2000-01-01',
      to: '2099-12-31',
      branchId: String(request.query.branchId),
    });
    const saleId = uuidSchema.parse(request.params.id);
    const result = await transactionDetailService.getTransactionDetail(scope, saleId);
    sendData(response, result);
  });

  router.get('/sales-summary', async (request, response) => {
    const fromStr = (request.query.from as string) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const toStr = (request.query.to as string) || new Date().toISOString().slice(0, 10);
    const branchIdStr = typeof request.query.branchId === 'string' && request.query.branchId ? request.query.branchId : undefined;
    const filterInput: { from: string; to: string; branchId?: string } = {
      from: fromStr,
      to: toStr,
    };
    if (branchIdStr) filterInput.branchId = branchIdStr;

    const scope = resolveReportScope(request.authUser!, filterInput);
    const result = await salesSummaryService.generate(scope, filterInput);
    sendData(response, result);
  });

  router.get('/workspace', validateQuery(workspaceReportFilter), async (request, response) => {
    const { from, to, branchId } = request.query as z.infer<typeof workspaceReportFilter>;
    const organizationId = request.authUser!.organization.id;
    const allBranches =
      request.authUser!.permissions.includes('reports:view_all_branches') ||
      request.authUser!.permissions.includes('sales:read_all');
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
      payablesInvoices,
      purchaseOrdersList,
      salesReceipts,
      shiftLogs,
      auditKpis,
      auditEvents,
      repackingKpis,
      repackingBatches,
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
           coalesce((select sum(si.unit_price * si.quantity)
             from sale_items si join scoped_sales sold on sold.id=si.sale_id),0)::text
             as "grossSales",
           (coalesce((select sum(si.unit_price * si.quantity)
              from sale_items si join scoped_sales sold on sold.id=si.sale_id),0)-
             coalesce(sum(s.discount_total),0)-
             coalesce((select sum(refund_total) from scoped_returns),0))::text as "netSales",
           coalesce((select sum(refund_total) from scoped_returns),0)::text as "customerRefunds",
           coalesce(sum(s.discount_total),0)::text as discounts,
           coalesce(sum(s.tax_total),0)::text as taxes,
           count(s.id)::int as transactions,
           count(distinct s.customer_id) filter (where s.customer_id is not null)::int
             as "uniqueCustomers",
           case when count(s.id)>0 then round((
             coalesce((select sum(si.unit_price * si.quantity)
               from sale_items si join scoped_sales sold on sold.id=si.sale_id),0)-
             coalesce(sum(s.discount_total),0)-
             coalesce((select sum(refund_total) from scoped_returns),0))/count(s.id),2)
             else 0 end::text as "averageTransaction",
           coalesce((select sum(si.quantity) from sale_items si
             join scoped_sales sold on sold.id=si.sale_id),0)::float8 as "itemsSold",
           case when count(s.id)>0 then round(coalesce((select sum(si.quantity)
             from sale_items si join scoped_sales sold on sold.id=si.sale_id),0)/count(s.id),2)
             else 0 end::text as "averageItemsPerTransaction",
           ((select total from sale_cost)-(select total from return_cost))::text as "netCost",
           (coalesce((select sum(si.unit_price * si.quantity)
              from sale_items si join scoped_sales sold on sold.id=si.sale_id),0)-
             coalesce(sum(s.discount_total),0)-
             coalesce((select sum(refund_total) from scoped_returns),0)-
             ((select total from sale_cost)-(select total from return_cost)))::text
             as "grossProfit",
           case when coalesce((select sum(si.unit_price * si.quantity)
               from sale_items si join scoped_sales sold on sold.id=si.sale_id),0)-
             coalesce(sum(s.discount_total),0)-
             coalesce((select sum(refund_total) from scoped_returns),0) > 0
             then round(100*(coalesce((select sum(si.unit_price * si.quantity)
                 from sale_items si join scoped_sales sold on sold.id=si.sale_id),0)-
               coalesce(sum(s.discount_total),0)-
               coalesce((select sum(refund_total) from scoped_returns),0)-
               ((select total from sale_cost)-(select total from return_cost)))/
               (coalesce((select sum(si.unit_price * si.quantity)
                  from sale_items si join scoped_sales sold on sold.id=si.sale_id),0)-
               coalesce(sum(s.discount_total),0)-
               coalesce((select sum(refund_total) from scoped_returns),0)),2)
             else 0 end::text as "grossMarginPercent",
           case when coalesce((select sum(si.unit_price * si.quantity)
               from sale_items si join scoped_sales sold on sold.id=si.sale_id),0)>0 then round(100*
             coalesce((select sum(refund_total) from scoped_returns),0)/
             (select sum(si.unit_price * si.quantity)
               from sale_items si join scoped_sales sold on sold.id=si.sale_id),2)
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
          coalesce(c.name,'Uncategorized') as category,
          coalesce(sum(si.quantity),0)::float8 as quantity,
          coalesce(sum(si.unit_price*si.quantity),0)::text as sales,
          coalesce(sum(si.quantity*si.unit_cost),0)::text as cost,
          (coalesce(sum(si.unit_price*si.quantity-si.discount_total),0)-
            coalesce(sum(si.quantity*si.unit_cost),0))::text
            as profit
         from sale_items si
         join sales s on s.id=si.sale_id
         join products p on p.id=si.product_id
         left join categories c on c.id=p.category_id
         where si.organization_id=$1 and s.completed_at >= $2 and s.completed_at < $3
           and s.status in ('completed','partially_refunded','refunded')
           and ${branchScope('s')}
         group by si.product_name,si.sku,p.unit,c.name order by sales desc limit 100`,
        values,
      ),
      database.query(
        `select coalesce(c.name,'Uncategorized') as name,
          coalesce(sum(si.unit_price*si.quantity),0)::text as sales,
          coalesce(sum(si.quantity),0)::float8 as quantity
         from sale_items si
         join sales s on s.id=si.sale_id
         join products p on p.id=si.product_id
         left join categories c on c.id=p.category_id
         where si.organization_id=$1 and s.completed_at >= $2 and s.completed_at < $3
           and s.status in ('completed','partially_refunded','refunded')
           and ${branchScope('s')}
         group by c.id,c.name order by sales desc limit 50`,
        values,
      ),
      database.query(
        `select b.id,b.name,coalesce(sum(
            coalesce((select sum(si.unit_price*si.quantity) from sale_items si where si.sale_id=s.id),0)
            - s.discount_total
            - coalesce((select sum(r.refund_total) from returns r where r.sale_id=s.id
                and r.created_at >= $2 and r.created_at < $3),0)
          ),0)::text as sales,
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
          coalesce(sum(si.unit_price*si.quantity),0)::text as sales,
          count(distinct s.id)::int as transactions
         from sales s join sale_items si on si.sale_id=s.id
         where s.organization_id=$1 and s.completed_at >= $2
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
          coalesce(sum(greatest(bi.quantity,0)*p.selling_price),0)::text as "retailValue",
          count(*) filter (where bi.quantity>0 and not exists (
            select 1 from sale_items dead_si join sales dead_s on dead_s.id=dead_si.sale_id
            where dead_si.product_id=p.id and dead_s.branch_id=bi.branch_id
              and dead_s.status in ('completed','partially_refunded','refunded')
              and dead_s.completed_at >= now() - interval '90 days'
          ))::int as "deadStockCount",
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
              and ${branchScope('sr')}),0)::text as "supplierRefunds",
          case when coalesce((select sum(poi.ordered_quantity)
              from purchase_order_items poi join purchase_orders accuracy_po
                on accuracy_po.id=poi.purchase_order_id
              where accuracy_po.organization_id=$1 and accuracy_po.created_at >= $2
                and accuracy_po.created_at < $3 and accuracy_po.status not in ('draft','cancelled')
                and ${branchScope('accuracy_po')}),0)>0
            then round(100*coalesce((select sum(poi.received_quantity)
              from purchase_order_items poi join purchase_orders accuracy_po
                on accuracy_po.id=poi.purchase_order_id
              where accuracy_po.organization_id=$1 and accuracy_po.created_at >= $2
                and accuracy_po.created_at < $3 and accuracy_po.status not in ('draft','cancelled')
                and ${branchScope('accuracy_po')}),0)/
              (select sum(poi.ordered_quantity)
                from purchase_order_items poi join purchase_orders accuracy_po
                  on accuracy_po.id=poi.purchase_order_id
                where accuracy_po.organization_id=$1 and accuracy_po.created_at >= $2
                  and accuracy_po.created_at < $3 and accuracy_po.status not in ('draft','cancelled')
                  and ${branchScope('accuracy_po')}),1)
            else 0 end::text as "receivingAccuracy",
          case when count(po.id) filter (where po.status not in ('draft','cancelled'))>0
            then round(100.0*count(po.id) filter (where po.status='received')/
              count(po.id) filter (where po.status not in ('draft','cancelled')),1)
            else 0 end::text as "supplierFulfillmentRate"
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
           select date_trunc('day',s.completed_at)::date as day,
             sum(coalesce((select sum(si.unit_price*si.quantity)
               from sale_items si where si.sale_id=s.id),0)-s.discount_total) as sales,
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
          coalesce(sum(coalesce(rs.expected_cash,
            rs.starting_cash+rs.cash_sales-rs.cash_refunds+cm.cash_in-cm.cash_out)),0)::text
            as "expectedCash",
          coalesce(sum(rs.starting_cash+rs.cash_sales-rs.cash_refunds+cm.cash_in-cm.cash_out),0)::text
            as "drawerBalance",
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
      database.query(
        `select
          si.id,
          si.invoice_number as "invoiceNumber",
          s.name as "supplierName",
          po.order_number as "poNumber",
          to_char(si.invoice_date, 'YYYY-MM-DD') as "invoiceDate",
          to_char(si.due_date, 'YYYY-MM-DD') as "dueDate",
          si.total::text,
          si.paid_amount::text as "paidAmount",
          (si.total - si.paid_amount)::text as "balance",
          si.status,
          b.name as "branchName"
         from supplier_invoices si
         join suppliers s on s.id = si.supplier_id
         left join purchase_orders po on po.id = si.purchase_order_id
         left join branches b on b.id = si.branch_id
         where si.organization_id = $1
           and si.status not in ('credited','void')
           and (si.total - si.paid_amount) > 0
           and ${inventoryBranchScope('si')}
         order by si.due_date asc nulls last, si.created_at desc limit 50`,
        inventoryValues,
      ),
      database.query(
        `select
          po.id,
          po.order_number as "poNumber",
          s.name as "supplierName",
          to_char(po.created_at, 'YYYY-MM-DD') as "orderDate",
          po.status,
          po.subtotal::text as "total",
          b.name as "branchName"
         from purchase_orders po
         join suppliers s on s.id = po.supplier_id
         left join branches b on b.id = po.branch_id
         where po.organization_id = $1 and po.created_at >= $2 and po.created_at < $3
           and ${branchScope('po')}
         order by po.created_at desc limit 50`,
        values,
      ),
      database.query(
        `select
          s.id,
          s.receipt_number as "receiptNumber",
          s.status,
          coalesce(
            (select pay.method from payments pay
              where pay.sale_id = s.id and pay.kind = 'payment'
              order by pay.created_at asc limit 1),
            'cash'
          ) as "paymentMethod",
          to_char(s.completed_at, 'YYYY-MM-DD HH24:MI') as "completedAt",
          s.total::text as "total",
          s.discount_total::text as "discount",
          s.tax_total::text as "tax",
          b.name as "branchName",
          coalesce(p.display_name, 'Staff') as "cashierName"
         from sales s
         left join branches b on b.id = s.branch_id
         left join profiles p on p.id = s.cashier_id
         where s.organization_id = $1 and s.completed_at >= $2 and s.completed_at < $3
           and s.status in ('completed','partially_refunded','refunded')
           and ${branchScope('s')}
         order by s.completed_at desc limit 50`,
        values,
      ),
      database.query(
        `select
          rs.id,
          coalesce(p.display_name, 'Staff') as "cashierName",
          to_char(rs.opened_at, 'YYYY-MM-DD HH24:MI') as "openedAt",
          to_char(rs.closed_at, 'YYYY-MM-DD HH24:MI') as "closedAt",
          rs.status,
          rs.starting_cash::text as "startingCash",
          rs.cash_sales::text as "cashSales",
          rs.expected_cash::text as "expectedCash",
          rs.actual_cash::text as "countedCash",
          rs.variance::text as "variance",
          b.name as "branchName"
         from register_shifts rs
         left join profiles p on p.id = rs.cashier_id
         left join branches b on b.id = rs.branch_id
         where rs.organization_id = $1 and rs.opened_at >= $2 and rs.opened_at < $3
           and ${branchScope('rs')}
         order by rs.opened_at desc limit 50`,
        values,
      ),
      database.query(
        `select
          (select count(*) from sales s where s.organization_id=$1
            and s.status='voided' and s.updated_at >= $2 and s.updated_at < $3
            and ${branchScope('s')})::int as "voidedSales",
          (select count(*) from returns r where r.organization_id=$1
            and r.created_at >= $2 and r.created_at < $3
            and ${branchScope('r')})::int as "refundTransactions",
          coalesce((select sum(r.refund_total) from returns r where r.organization_id=$1
            and r.created_at >= $2 and r.created_at < $3
            and ${branchScope('r')}),0)::text as "refundAmount",
          (select count(*) from inventory_movements im where im.organization_id=$1
            and im.created_at >= $2 and im.created_at < $3
            and im.movement_type::text in ('adjustment','open_container')
            and ${branchScope('im')})::int as "inventoryAdjustments",
          (select count(*) from cash_movements cm where cm.organization_id=$1
            and cm.created_at >= $2 and cm.created_at < $3
            and ${branchScope('cm')})::int as "cashAdjustments"`,
        values,
      ),
      database.query(
        `select * from (
          select s.id,'void'::text as type,
            ('Receipt '||s.receipt_number)::text as title,
            coalesce(nullif(s.note,''),'Voided sale')::text as detail,
            s.total::text as amount,coalesce(p.display_name,'Staff') as "actorName",
            b.name as "branchName",s.updated_at::text as "createdAt"
          from sales s join branches b on b.id=s.branch_id
          left join profiles p on p.id=s.cashier_id
          where s.organization_id=$1 and s.status='voided'
            and s.updated_at >= $2 and s.updated_at < $3 and ${branchScope('s')}
          union all
          select r.id,'refund'::text,('Return '||r.return_number)::text,r.reason,
            r.refund_total::text,coalesce(p.display_name,'Staff'),b.name,r.created_at::text
          from returns r join branches b on b.id=r.branch_id
          left join profiles p on p.id=r.created_by
          where r.organization_id=$1 and r.created_at >= $2 and r.created_at < $3
            and ${branchScope('r')}
          union all
          select im.id,'inventory'::text,
            replace(initcap(im.movement_type::text),'_',' ')::text,
            (p.name||' · '||im.reason)::text,null::text,
            coalesce(actor.display_name,'Staff'),b.name,im.created_at::text
          from inventory_movements im join products p on p.id=im.product_id
          join branches b on b.id=im.branch_id left join profiles actor on actor.id=im.created_by
          where im.organization_id=$1 and im.created_at >= $2 and im.created_at < $3
            and im.movement_type::text in ('adjustment','open_container') and ${branchScope('im')}
          union all
          select cm.id,'cash'::text,replace(initcap(cm.type),'_',' ')::text,cm.reason,
            cm.amount::text,coalesce(actor.display_name,'Staff'),b.name,cm.created_at::text
          from cash_movements cm join branches b on b.id=cm.branch_id
          left join profiles actor on actor.id=cm.created_by
          where cm.organization_id=$1 and cm.created_at >= $2 and cm.created_at < $3
            and ${branchScope('cm')}
        ) audit_events order by "createdAt" desc limit 100`,
        values,
      ),
      database.query(
        `with scoped_batches as (
          select pb.* from production_batches pb
          where pb.organization_id=$1 and pb.created_at >= $2 and pb.created_at < $3
            and ${branchScope('pb')}
        ), batch_inputs as (
          select pbi.production_batch_id,sum(pbi.quantity_consumed) as input_quantity,
            bool_and(input_product.unit=output_product.unit) as comparable
          from production_batch_items pbi
          join scoped_batches sb on sb.id=pbi.production_batch_id
          join products input_product on input_product.id=pbi.ingredient_product_id
          join products output_product on output_product.id=sb.product_id
          group by pbi.production_batch_id
        )
        select count(sb.id)::int as batches,
          coalesce(sum(sb.quantity_produced),0)::float8 as "outputQuantity",
          coalesce(sum(bi.input_quantity),0)::float8 as "inputQuantity",
          coalesce(sum(sb.total_cost),0)::text as "totalCost",
          case when coalesce(sum(sb.quantity_produced),0)>0
            then round(sum(sb.total_cost)/sum(sb.quantity_produced),4)::text else '0' end
            as "averageCostPerOutput",
          case when coalesce(sum(bi.input_quantity) filter (where bi.comparable),0)>0
            then round(100*sum(sb.quantity_produced) filter (where bi.comparable)/
              sum(bi.input_quantity) filter (where bi.comparable),1)::text else null end
            as "yieldPercent"
        from scoped_batches sb left join batch_inputs bi on bi.production_batch_id=sb.id`,
        values,
      ),
      database.query(
        `with batch_inputs as (
          select pbi.production_batch_id,sum(pbi.quantity_consumed) as input_quantity,
            bool_and(input_product.unit=output_product.unit) as comparable
          from production_batch_items pbi
          join production_batches pb on pb.id=pbi.production_batch_id
          join products input_product on input_product.id=pbi.ingredient_product_id
          join products output_product on output_product.id=pb.product_id
          where pb.organization_id=$1 and pb.created_at >= $2 and pb.created_at < $3
            and ${branchScope('pb')}
          group by pbi.production_batch_id
        )
        select pb.id,pb.batch_number as "batchNumber",p.name as "productName",
          pb.quantity_produced::float8 as "quantityProduced",
          coalesce(bi.input_quantity,0)::float8 as "inputQuantity",pb.total_cost::text as "totalCost",
          pb.unit_cost::text as "unitCost",
          case when bi.comparable and bi.input_quantity>0
            then round(100*pb.quantity_produced/bi.input_quantity,1)::text else null end
            as "yieldPercent",pb.created_at::text as "createdAt"
        from production_batches pb join products p on p.id=pb.product_id
        left join batch_inputs bi on bi.production_batch_id=pb.id
        where pb.organization_id=$1 and pb.created_at >= $2 and pb.created_at < $3
          and ${branchScope('pb')}
        order by pb.created_at desc limit 100`,
        values,
      ),
    ]);

    const permissions = request.authUser!.permissions || [];
    const canViewCost = permissions.includes('reports:view_cost');
    const canViewProfit = permissions.includes('reports:view_profit');
    const canViewAudit = permissions.includes('audit:read');
    const kpis = { ...(salesKpis.rows[0] ?? {}) } as Record<string, unknown>;
    const sanitizedTopProducts = topProducts.rows.map((row) => {
      const product = { ...row } as Record<string, unknown>;
      if (!canViewCost) {
        product.cost = null;
        product.unitCost = null;
      }
      if (!canViewProfit) {
        product.profit = null;
        product.margin = null;
      }
      return product;
    });
    const inventory = {
      ...inventoryKpis.rows[0],
      lowStock: lowStock.rows,
      byCategory: inventoryByCategory.rows,
      movements: inventoryMovements.rows,
    } as Record<string, unknown>;
    const inventoryCostValue = Number(inventory.inventoryValue ?? 0);
    inventory.stockTurnover =
      canViewCost && inventoryCostValue > 0
        ? (Number(kpis.netCost ?? 0) / inventoryCostValue).toFixed(2)
        : null;
    if (!canViewCost) {
      kpis.netCost = null;
      inventory.inventoryValue = null;
      inventory.averageCost = null;
    }
    if (!canViewProfit) {
      kpis.grossProfit = null;
      kpis.grossMarginPercent = null;
    }

    const generatedAt = new Date().toISOString();
    const branchName =
      request.authUser!.branches.find((candidate) => candidate.id === branchId)?.name ??
      'All Accessible Branches';
    const repackingSummary = { ...(repackingKpis.rows[0] ?? {}) } as Record<string, unknown>;
    const yieldPercent =
      repackingSummary.yieldPercent === null || repackingSummary.yieldPercent === undefined
        ? null
        : String(repackingSummary.yieldPercent);
    repackingSummary.lossPercent =
      yieldPercent === null ? null : Math.max(0, 100 - Number(yieldPercent)).toFixed(1);

    sendData(response, {
      range: { from, to, branchId: branchId ?? null },
      metadata: {
        generatedAt,
        timezone: request.authUser!.organization.timezone || 'Asia/Manila',
        currency: request.authUser!.organization.currency || 'PHP',
        branchName,
        status: 'ready',
        version: '1.0',
      },
      kpis,
      sales: {
        paymentMethods: paymentMethods.rows,
        topProducts: sanitizedTopProducts,
        topCategories: topCategories.rows,
        branches: salesByBranch.rows,
        trend: salesTrend.rows.reverse(),
        salesReceipts: salesReceipts.rows,
      },
      inventory,
      purchasing: {
        ...purchasingKpis.rows[0],
        orderStatuses: purchaseOrderStatuses.rows,
        topSuppliers: topSuppliers.rows,
        payablesInvoices: payablesInvoices.rows,
        purchaseOrdersList: purchaseOrdersList.rows,
      },
      profit: {
        grossSales: kpis.grossSales ?? '0',
        refunds: kpis.customerRefunds ?? '0',
        netSales: kpis.netSales ?? '0',
        netCost: canViewCost ? (kpis.netCost ?? '0') : null,
        grossProfit: canViewProfit ? (kpis.grossProfit ?? '0') : null,
        grossMarginPercent: canViewProfit ? (kpis.grossMarginPercent ?? '0') : null,
        trend: canViewProfit || canViewCost ? profitTrend.rows.reverse() : [],
      },
      cash: {
        ...cashKpis.rows[0],
        shiftLogs: shiftLogs.rows,
      },
      audit: canViewAudit
        ? {
            ...(auditKpis.rows[0] ?? {}),
            events: auditEvents.rows,
          }
        : undefined,
      repacking: {
        ...repackingSummary,
        batchRows: repackingBatches.rows,
      },
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
          p.display_name as "createdBy",si.invoice_number as "invoiceNumber"
         from cash_movements cm
         join profiles p on p.id=cm.created_by
         left join supplier_payments sp on sp.id=cm.supplier_payment_id
         left join supplier_invoices si on si.id=sp.supplier_invoice_id
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
