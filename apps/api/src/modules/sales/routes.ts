import { Router } from 'express';
import { z } from 'zod';
import { checkoutSchema, holdSaleSchema, paginationSchema, uuidSchema } from '@ximo/shared';
import type { Database } from '../../database/types.js';
import { requireBranchAccess, requireModule, requirePermission } from '../../middleware/auth.js';
import { validateBody, validateQuery } from '../../middleware/validation.js';
import { badRequest, notFound } from '../../shared/errors.js';
import { sendData, sendPage } from '../../shared/http.js';
import { CheckoutService } from '../../sales/checkout-service.js';
import { HoldSaleService } from '../../sales/hold-sale-service.js';
import { HeldSaleService } from '../../sales/held-sale-service.js';

const optionalUuid = z.preprocess(
  (val: unknown) => (val === '' || val === 'undefined' || val === 'null' || !val ? undefined : val),
  uuidSchema.optional().nullable(),
);

export function salesRouter(database: Database): Router {
  const router = Router();
  const checkout = new CheckoutService(database);
  const heldSales = new HoldSaleService(database);
  const heldSaleLifecycle = new HeldSaleService(database);
  router.use(requireModule('pos'));

  // POST /sales/hold -> Park / Hold an active cart
  router.post(
    '/hold',
    requirePermission('sales:create'),
    requireBranchAccess('body'),
    validateBody(holdSaleSchema),
    async (request, response) => {
      const input = request.body;
      const idempotencyKey =
        request.header('idempotency-key')?.trim() ?? `hold-${crypto.randomUUID()}`;
      const result = await heldSales.hold(
        {
          organizationId: request.authUser!.organization.id,
          userId: request.authUser!.id,
        },
        input,
        idempotencyKey,
      );

      sendData(response, result, 201);
    },
  );

  // GET /sales/held -> List all active held sales for a branch
  router.get(
    '/held',
    requirePermission('sales:read_branch', 'sales:read_all'),
    validateQuery(z.object({ branchId: uuidSchema })),
    requireBranchAccess('query'),
    async (request, response) => {
      const branchId = String(request.query.branchId);
      const organizationId = request.authUser!.organization.id;

      const result = await database.query(
        `select s.id, s.receipt_number as "receiptNumber", s.status, s.total::text,
           s.note, s.created_at as "createdAt", s.customer_id as "customerId",
           p.display_name as "cashierName", c.name as "customerName",
           (select count(*)::int from sale_items si where si.sale_id = s.id) as "itemCount"
         from sales s
         join profiles p on p.id = s.cashier_id
         left join customers c on c.id = s.customer_id
         where s.organization_id = $1 and s.branch_id = $2 and s.status = 'held'
         order by s.created_at desc`,
        [organizationId, branchId],
      );

      sendData(response, result.rows);
    },
  );

  // GET /sales/voided-holds -> Read-only lifecycle history for parked orders.
  router.get(
    '/voided-holds',
    requirePermission('sales:read_branch', 'sales:read_all'),
    validateQuery(paginationSchema.extend({ branchId: uuidSchema })),
    requireBranchAccess('query'),
    async (request, response) => {
      const query = request.query as any;
      const result = await database.query(
        `select s.id,s.receipt_number as "receiptNumber",s.total::text,s.note,
           s.created_at as "createdAt",cashier.display_name as "cashierName",
           customer.name as "customerName",
           (select count(*)::int from sale_items si where si.sale_id=s.id) as "itemCount",
           lifecycle.action,lifecycle.created_at as "closedAt",
           lifecycle_actor.display_name as "closedBy",count(*) over()::int as total_count
         from sales s
         join profiles cashier
           on cashier.id=s.cashier_id and cashier.organization_id=s.organization_id
         left join customers customer
           on customer.id=s.customer_id and customer.organization_id=s.organization_id
         left join lateral (
           select al.action,al.actor_id,al.created_at
           from audit_logs al
           where al.organization_id=s.organization_id and al.branch_id=s.branch_id
             and al.entity_type='sale' and al.entity_id=s.id
             and al.action in ('sale.resumed','sale.discarded')
           order by al.created_at desc
           limit 1
         ) lifecycle on true
         left join profiles lifecycle_actor
           on lifecycle_actor.id=lifecycle.actor_id
          and lifecycle_actor.organization_id=s.organization_id
         where s.organization_id=$1 and s.branch_id=$2 and s.status='voided'
           and s.receipt_number like 'HOLD-%'
         order by lifecycle.created_at desc nulls last,s.created_at desc
         limit $3 offset $4`,
        [
          request.authUser!.organization.id,
          query.branchId,
          query.pageSize,
          (query.page - 1) * query.pageSize,
        ],
      );
      const total = result.rows[0]?.total_count ?? 0;
      sendPage(
        response,
        result.rows.map(({ total_count: _total, ...row }) => row),
        query.page,
        query.pageSize,
        total,
      );
    },
  );

  // POST /sales/held/:id/resume -> Restore a held sale and close its parked record
  router.post(
    '/held/:id/resume',
    requirePermission('sales:create'),
    validateQuery(z.object({ branchId: uuidSchema })),
    requireBranchAccess('query'),
    async (request, response) => {
      const id = uuidSchema.parse(request.params.id);
      const organizationId = request.authUser!.organization.id;
      const userId = request.authUser!.id;
      const result = await heldSaleLifecycle.resume(
        organizationId,
        userId,
        String(request.query.branchId),
        id,
      );

      sendData(response, result);
    },
  );

  // DELETE /sales/held/:id -> Discard a held sale
  router.delete(
    '/held/:id',
    requirePermission('sales:create'),
    validateQuery(z.object({ branchId: uuidSchema })),
    requireBranchAccess('query'),
    async (request, response) => {
      const id = uuidSchema.parse(request.params.id);
      const organizationId = request.authUser!.organization.id;
      const userId = request.authUser!.id;
      await heldSaleLifecycle.discard(organizationId, userId, String(request.query.branchId), id);

      sendData(response, { success: true });
    },
  );

  router.post(
    '/checkout',
    requirePermission('sales:create'),
    requireBranchAccess('body'),
    validateBody(checkoutSchema),
    async (request, response) => {
      const key = request.header('idempotency-key');
      if (!key) throw badRequest('MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required');
      const result = await checkout.complete(
        { userId: request.authUser!.id, organizationId: request.authUser!.organization.id },
        request.body,
        key,
      );
      sendData(response, result, result.replayed ? 200 : 201);
    },
  );

  router.get(
    '/',
    requirePermission('sales:read_branch', 'sales:read_all'),
    validateQuery(
      paginationSchema.extend({
        branchId: uuidSchema,
        cashierId: optionalUuid,
        paymentMethod: checkoutSchema.shape.payments.element.shape.method.optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      }),
    ),
    requireBranchAccess('query'),
    async (request, response) => {
      const query = request.query as any;
      const result = await database.query(
        `select s.id,s.receipt_number as "receiptNumber",s.status,s.subtotal::text,
          s.discount_total::text as "discountTotal",s.tax_total::text as "taxTotal",
          s.total::text,s.completed_at as "completedAt",b.name as "branchName",
          p.display_name as "cashierName",c.name as "customerName",
          coalesce(
            array_agg(distinct pay.method) filter (where pay.method is not null),
            array[]::payment_method[]
          )::text[] as "paymentMethods",count(*) over()::int as total_count
         from sales s join branches b on b.id=s.branch_id join profiles p on p.id=s.cashier_id
         left join customers c on c.id=s.customer_id left join payments pay on pay.sale_id=s.id
         where s.organization_id=$1 and s.branch_id=$2
           and s.status in ('completed','partially_refunded','refunded')
           and ($3::uuid is null or s.cashier_id=$3)
           and ($4::payment_method is null or exists (
             select 1 from payments px where px.sale_id=s.id and px.method=$4
           ))
           and ($5::timestamptz is null or s.completed_at >= $5)
           and ($6::timestamptz is null or s.completed_at < $6)
         group by s.id,b.name,p.display_name,c.name
         order by s.completed_at desc limit $7 offset $8`,
        [
          request.authUser!.organization.id,
          query.branchId ?? null,
          query.cashierId ?? null,
          query.paymentMethod ?? null,
          query.from ?? null,
          query.to ?? null,
          query.pageSize,
          (query.page - 1) * query.pageSize,
        ],
      );
      const total = result.rows[0]?.total_count ?? 0;
      sendPage(
        response,
        result.rows.map(({ total_count: _total, ...row }) => row),
        query.page,
        query.pageSize,
        total,
      );
    },
  );
  router.get(
    '/:id',
    requirePermission('sales:read_branch', 'sales:read_all'),
    async (request, response) => {
      const id = uuidSchema.parse(request.params.id);
      const allBranches = request.authUser!.permissions.includes('sales:read_all');
      const result = await database.query<any>(
        `select s.id,s.branch_id as "branchId",s.receipt_number as "receiptNumber",s.status,
          s.subtotal::text,s.discount_total::text as "discountTotal",s.tax_total::text as "taxTotal",
          s.total::text,s.change_due::text as "changeDue",s.completed_at as "completedAt",
          b.name as "branchName",b.address as "branchAddress",p.display_name as "cashierName",
          c.name as "customerName"
         from sales s join branches b on b.id=s.branch_id join profiles p on p.id=s.cashier_id
         left join customers c on c.id=s.customer_id
         where s.id=$1 and s.organization_id=$2 and ($3 or s.branch_id=any($4::uuid[]))`,
        [
          id,
          request.authUser!.organization.id,
          allBranches,
          request.authUser!.branches.map((branch) => branch.id),
        ],
      );
      if (!result.rows[0]) throw notFound('Sale');
      const [items, payments] = await Promise.all([
        database.query(
          `select si.id,si.product_name as "productName",si.sku,coalesce(v.unit,p.unit) as unit,
            si.quantity::float8 as quantity,si.unit_price::text as "unitPrice",
            si.discount_total::text as "discountTotal",si.tax_total::text as "taxTotal",
            si.line_total::text as "lineTotal",
            si.returned_quantity::float8 as "returnedQuantity"
           from sale_items si join products p
             on p.id=si.product_id and p.organization_id=si.organization_id
           left join product_variants v
             on v.id=si.variant_id and v.organization_id=si.organization_id
           where si.sale_id=$1 and si.organization_id=$2 order by si.created_at`,
          [id, request.authUser!.organization.id],
        ),
        database.query(
          `select method,kind,amount::text,tendered::text,reference,created_at as "createdAt"
           from payments where sale_id=$1 and organization_id=$2 order by created_at`,
          [id, request.authUser!.organization.id],
        ),
      ]);
      sendData(response, { ...result.rows[0], items: items.rows, payments: payments.rows });
    },
  );
  return router;
}
