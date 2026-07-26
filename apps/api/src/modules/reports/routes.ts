import { Router } from 'express';
import { z } from 'zod';
import type { Queryable } from '../../database/types.js';
import { requireAnyModule, requirePermission } from '../../middleware/auth.js';
import { validateQuery } from '../../middleware/validation.js';
import { sendData } from '../../shared/http.js';

const dateFilter = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
});

export function reportsRouter(database: Queryable): Router {
  const router = Router();
  router.use(requireAnyModule('dashboard', 'reports'), requirePermission('reports:read'));
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
        `select si.product_name as name,sum(si.quantity-si.returned_quantity)::int as quantity,
          sum(si.line_total)::text as total
         from sale_items si join sales s on s.id=si.sale_id
         where si.organization_id=$1 and s.completed_at >= $2 and s.completed_at < $3
         group by si.product_name order by quantity desc limit 10`,
        [organizationId, from, to],
      ),
      database.query(
        `select b.name,coalesce(sum(s.total),0)::text as total,count(s.id)::int as transactions
         from branches b left join sales s on s.branch_id=b.id and s.completed_at >= $2 and s.completed_at < $3
         where b.organization_id=$1 group by b.id order by total desc`,
        [organizationId, from, to],
      ),
      database.query(
        `select p.id,p.name,p.sku,b.name as "branchName",bi.quantity,
          bi.low_stock_level as "lowStockLevel"
         from branch_inventory bi join products p on p.id=bi.product_id join branches b on b.id=bi.branch_id
         where bi.organization_id=$1 and bi.quantity<=bi.low_stock_level order by bi.quantity limit 50`,
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
  return router;
}
