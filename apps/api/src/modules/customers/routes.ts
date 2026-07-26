import { Router } from 'express';
import { customerSchema, paginationSchema, uuidSchema } from '@ximo/shared';
import type { Queryable } from '../../database/types.js';
import { requireModule, requirePermission } from '../../middleware/auth.js';
import { validateBody, validateQuery } from '../../middleware/validation.js';
import { notFound } from '../../shared/errors.js';
import { sendData, sendPage } from '../../shared/http.js';

export function customersRouter(database: Queryable): Router {
  const router = Router();
  router.use(requireModule('customers'));
  router.get(
    '/',
    requirePermission('customers:read'),
    validateQuery(paginationSchema),
    async (request, response) => {
      const query = request.query as any;
      const result = await database.query(
        `select id,name,email,phone,address,notes,is_active as "isActive",
          count(*) over()::int as total
         from customers where organization_id=$1 and is_active
          and ($2::text is null or name ilike '%'||$2||'%' or phone ilike '%'||$2||'%')
         order by name limit $3 offset $4`,
        [
          request.authUser!.organization.id,
          query.search ?? null,
          query.pageSize,
          (query.page - 1) * query.pageSize,
        ],
      );
      const total = result.rows[0]?.total ?? 0;
      sendPage(
        response,
        result.rows.map(({ total: _total, ...row }) => row),
        query.page,
        query.pageSize,
        total,
      );
    },
  );
  router.post(
    '/',
    requirePermission('customers:manage'),
    validateBody(customerSchema),
    async (request, response) => {
      const input = request.body;
      const result = await database.query(
        `insert into customers (organization_id,name,email,phone,address,notes)
         values ($1,$2,$3,$4,$5,$6) returning id,name,email,phone,address,notes`,
        [
          request.authUser!.organization.id,
          input.name,
          input.email ?? null,
          input.phone ?? null,
          input.address ?? null,
          input.notes ?? null,
        ],
      );
      sendData(response, result.rows[0], 201);
    },
  );
  router.patch(
    '/:id',
    requirePermission('customers:manage'),
    validateBody(customerSchema.partial()),
    async (request, response) => {
      const id = uuidSchema.parse(request.params.id);
      const current = await database.query<any>(
        'select * from customers where id=$1 and organization_id=$2 and is_active',
        [id, request.authUser!.organization.id],
      );
      if (!current.rows[0]) throw notFound('Customer');
      const input = { ...current.rows[0], ...request.body };
      const result = await database.query(
        `update customers set name=$3,email=$4,phone=$5,address=$6,notes=$7,updated_at=now()
         where id=$1 and organization_id=$2 returning id,name,email,phone,address,notes`,
        [
          id,
          request.authUser!.organization.id,
          input.name,
          input.email ?? null,
          input.phone ?? null,
          input.address ?? null,
          input.notes ?? null,
        ],
      );
      sendData(response, result.rows[0]);
    },
  );
  router.get('/:id/history', requirePermission('customers:read'), async (request, response) => {
    const id = uuidSchema.parse(request.params.id);
    const organizationId = request.authUser!.organization.id;
    const [sales, returns] = await Promise.all([
      database.query(
        `select id,receipt_number as "receiptNumber",total::text,status,completed_at as "completedAt"
         from sales where customer_id=$1 and organization_id=$2 order by completed_at desc limit 100`,
        [id, organizationId],
      ),
      database.query(
        `select r.id,r.return_number as "returnNumber",r.refund_total::text as "refundTotal",r.created_at as "createdAt"
         from returns r join sales s on s.id=r.sale_id
         where s.customer_id=$1 and r.organization_id=$2 order by r.created_at desc limit 100`,
        [id, organizationId],
      ),
    ]);
    sendData(response, { sales: sales.rows, returns: returns.rows });
  });
  return router;
}
