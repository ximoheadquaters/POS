import { Router } from 'express';
import { checkoutSchema, paginationSchema, uuidSchema } from '@ximo/shared';
import type { Database } from '../../database/types.js';
import { requireBranchAccess, requireModule, requirePermission } from '../../middleware/auth.js';
import { validateBody, validateQuery } from '../../middleware/validation.js';
import { badRequest, notFound } from '../../shared/errors.js';
import { sendData, sendPage } from '../../shared/http.js';
import { CheckoutService } from '../../sales/checkout-service.js';

export function salesRouter(database: Database): Router {
  const router = Router();
  const checkout = new CheckoutService(database);
  router.use(requireModule('pos'));
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
        branchId: uuidSchema.optional(),
        cashierId: uuidSchema.optional(),
        paymentMethod: checkoutSchema.shape.payments.element.shape.method.optional(),
        from: checkoutSchema.shape.note.transform(String).optional(),
        to: checkoutSchema.shape.note.transform(String).optional(),
      }),
    ),
    async (request, response) => {
      const query = request.query as any;
      const allBranches = request.authUser!.permissions.includes('sales:read_all');
      if (
        !allBranches &&
        query.branchId &&
        !request.authUser!.branches.some((b) => b.id === query.branchId)
      ) {
        throw notFound('Branch');
      }
      const allowedBranchIds = request.authUser!.branches.map((branch) => branch.id);
      const result = await database.query(
        `select s.id,s.receipt_number as "receiptNumber",s.status,s.subtotal::text,
          s.discount_total::text as "discountTotal",s.tax_total::text as "taxTotal",
          s.total::text,s.completed_at as "completedAt",b.name as "branchName",
          p.display_name as "cashierName",c.name as "customerName",
          array_agg(distinct pay.method)::text[] as "paymentMethods",count(*) over()::int as total_count
         from sales s join branches b on b.id=s.branch_id join profiles p on p.id=s.cashier_id
         left join customers c on c.id=s.customer_id left join payments pay on pay.sale_id=s.id
         where s.organization_id=$1 and ($2::uuid is null or s.branch_id=$2)
           and ($3::uuid is null or s.cashier_id=$3)
           and ($4::payment_method is null or exists (
             select 1 from payments px where px.sale_id=s.id and px.method=$4
           ))
           and ($5::timestamptz is null or s.completed_at >= $5)
           and ($6::timestamptz is null or s.completed_at < $6)
           and ($7::boolean or s.branch_id=any($8::uuid[]))
         group by s.id,b.name,p.display_name,c.name
         order by s.completed_at desc limit $9 offset $10`,
        [
          request.authUser!.organization.id,
          query.branchId ?? null,
          query.cashierId ?? null,
          query.paymentMethod ?? null,
          query.from ?? null,
          query.to ?? null,
          allBranches,
          allowedBranchIds,
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
          `select id,product_name as "productName",sku,quantity,unit_price::text as "unitPrice",
            discount_total::text as "discountTotal",tax_total::text as "taxTotal",
            line_total::text as "lineTotal",returned_quantity as "returnedQuantity"
           from sale_items where sale_id=$1 and organization_id=$2 order by created_at`,
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
