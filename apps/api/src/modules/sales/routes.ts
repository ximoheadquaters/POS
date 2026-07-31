import { Router } from 'express';
import { z } from 'zod';
import { checkoutSchema, holdSaleSchema, paginationSchema, uuidSchema } from '@ximo/shared';
import type { Database } from '../../database/types.js';
import { requireBranchAccess, requireModule, requirePermission } from '../../middleware/auth.js';
import { validateBody, validateQuery } from '../../middleware/validation.js';
import { badRequest, notFound } from '../../shared/errors.js';
import { sendData, sendPage } from '../../shared/http.js';
import { CheckoutService } from '../../sales/checkout-service.js';

const optionalUuid = z.preprocess(
  (val: unknown) => (val === '' || val === 'undefined' || val === 'null' || !val ? undefined : val),
  uuidSchema.optional().nullable(),
);

export function salesRouter(database: Database): Router {
  const router = Router();
  const checkout = new CheckoutService(database);
  router.use(requireModule('pos'));

  // POST /sales/hold -> Park / Hold an active cart
  router.post(
    '/hold',
    requirePermission('sales:create'),
    requireBranchAccess('body'),
    validateBody(holdSaleSchema),
    async (request, response) => {
      const input = request.body;
      const organizationId = request.authUser!.organization.id;
      const userId = request.authUser!.id;

      const result = await database.transaction(async (tx) => {
        // Fetch product & variant details for items
        const itemDetails: Array<{
          productId: string;
          variantId: string | null;
          productName: string;
          sku: string;
          quantity: number;
          unitPrice: number;
          lineTotal: number;
        }> = [];

        let subtotal = 0;

        for (const item of input.items) {
          const prodRes = await tx.query<{ name: string; sku: string; price: string }>(
            `select p.name, coalesce(v.sku, p.sku) as sku, coalesce(v.price, p.price)::text as price
             from products p
             left join product_variants v on v.id = $3 and v.organization_id = $1
             where p.id = $2 and p.organization_id = $1`,
            [organizationId, item.productId, item.variantId ?? null],
          );
          if (!prodRes.rows[0]) throw notFound('Product');
          const unitPrice = parseFloat(prodRes.rows[0].price) || 0;
          const lineTotal = unitPrice * item.quantity;
          subtotal += lineTotal;

          itemDetails.push({
            productId: item.productId,
            variantId: item.variantId ?? null,
            productName: prodRes.rows[0].name,
            sku: prodRes.rows[0].sku || '',
            quantity: item.quantity,
            unitPrice,
            lineTotal,
          });
        }

        // Generate receipt number sequence
        const receiptRes = await tx.query<{ receipt_number: string }>(
          `select lpad(nextval('receipt_number_seq')::text, 6, '0') as receipt_number`,
        );
        const receiptNumber = `HOLD-${receiptRes.rows[0]!.receipt_number}`;

        // Insert into sales table with status = 'held'
        const saleRes = await tx.query<{ id: string }>(
          `insert into sales (
             organization_id, branch_id, shift_id, cashier_id, customer_id,
             receipt_number, status, subtotal, discount_total, tax_total, total, change_due, note, created_at
           ) values ($1, $2, $3, $4, $5, $6, 'held', $7, 0, 0, $7, 0, $8, now())
           returning id`,
          [
            organizationId,
            input.branchId,
            input.shiftId ?? null,
            userId,
            input.customerId ?? null,
            receiptNumber,
            subtotal.toFixed(2),
            input.note ?? null,
          ],
        );
        const saleId = saleRes.rows[0]!.id;

        // Insert items into sale_items
        for (const item of itemDetails) {
          await tx.query(
            `insert into sale_items (
               organization_id, sale_id, product_id, variant_id, product_name, sku,
               quantity, unit_price, line_total, discount_total, tax_total
             ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, 0)`,
            [
              organizationId,
              saleId,
              item.productId,
              item.variantId,
              item.productName,
              item.sku,
              item.quantity,
              item.unitPrice.toFixed(2),
              item.lineTotal.toFixed(2),
            ],
          );
        }

        // Write Audit Log record
        await tx.query(
          `insert into audit_logs (
             organization_id, actor_id, branch_id, action, entity_type, entity_id, after_data
           ) values ($1, $2, $3, 'sale.held', 'sale', $4, $5::jsonb)`,
          [
            organizationId,
            userId,
            input.branchId,
            saleId,
            JSON.stringify({ receiptNumber, total: subtotal.toFixed(2), itemCount: itemDetails.length }),
          ],
        );

        return { id: saleId, receiptNumber, total: subtotal.toFixed(2), itemCount: itemDetails.length };
      });

      sendData(response, result, 201);
    },
  );

  // GET /sales/held -> List all active held sales for a branch
  router.get(
    '/held',
    requirePermission('sales:read_branch', 'sales:read_all'),
    async (request, response) => {
      const rawBranchId = request.query.branchId;
      const branchId =
        rawBranchId && rawBranchId !== 'undefined' && rawBranchId !== 'null' && typeof rawBranchId === 'string'
          ? uuidSchema.safeParse(rawBranchId).data ?? null
          : null;
      const organizationId = request.authUser!.organization.id;

      const result = await database.query(
        `select s.id, s.receipt_number as "receiptNumber", s.status, s.total::text,
           s.note, s.created_at as "createdAt", s.customer_id as "customerId",
           p.display_name as "cashierName", c.name as "customerName",
           (select count(*)::int from sale_items si where si.sale_id = s.id) as "itemCount"
         from sales s
         join profiles p on p.id = s.cashier_id
         left join customers c on c.id = s.customer_id
         where s.organization_id = $1 and ($2::uuid is null or s.branch_id = $2) and s.status = 'held'
         order by s.created_at desc`,
        [organizationId, branchId],
      );

      sendData(response, result.rows);
    },
  );

  // POST /sales/held/:id/resume -> Restore a held sale to cart and remove held record
  router.post(
    '/held/:id/resume',
    requirePermission('sales:create'),
    async (request, response) => {
      const id = uuidSchema.parse(request.params.id);
      const organizationId = request.authUser!.organization.id;
      const userId = request.authUser!.id;

      const result = await database.transaction(async (tx) => {
        const saleRes = await tx.query<{
          id: string;
          branch_id: string;
          receipt_number: string;
          customer_id: string | null;
          note: string | null;
        }>(
          `select id, branch_id, receipt_number, customer_id, note
           from sales where id = $1 and organization_id = $2 and status = 'held'`,
          [id, organizationId],
        );
        if (!saleRes.rows[0]) throw notFound('Held sale');
        const sale = saleRes.rows[0];

        const itemsRes = await tx.query<{
          productId: string;
          variantId: string | null;
          productName: string;
          unitPrice: string;
          quantity: number;
          unit: string;
          sku: string;
          image: string | null;
        }>(
          `select si.product_id as "productId", si.variant_id as "variantId",
             si.product_name as "productName", si.unit_price::text as "unitPrice",
             si.quantity::float8 as quantity, coalesce(v.unit, p.unit) as unit,
             si.sku, p.primary_image_url as image
           from sale_items si
           join products p on p.id = si.product_id and p.organization_id = si.organization_id
           left join product_variants v on v.id = si.variant_id and v.organization_id = si.organization_id
           where si.sale_id = $1 and si.organization_id = $2`,
          [id, organizationId],
        );

        // Remove held sale & items so it is consumed
        await tx.query(`delete from sale_items where sale_id = $1 and organization_id = $2`, [id, organizationId]);
        await tx.query(`delete from sales where id = $1 and organization_id = $2`, [id, organizationId]);

        // Record Audit Log
        await tx.query(
          `insert into audit_logs (
             organization_id, actor_id, branch_id, action, entity_type, entity_id, after_data
           ) values ($1, $2, $3, 'sale.resumed', 'sale', $4, $5::jsonb)`,
          [
            organizationId,
            userId,
            sale.branch_id,
            id,
            JSON.stringify({ receiptNumber: sale.receipt_number, itemCount: itemsRes.rows.length }),
          ],
        );

        return {
          id: sale.id,
          receiptNumber: sale.receipt_number,
          customerId: sale.customer_id,
          note: sale.note,
          items: itemsRes.rows,
        };
      });

      sendData(response, result);
    },
  );

  // DELETE /sales/held/:id -> Discard a held sale
  router.delete(
    '/held/:id',
    requirePermission('sales:create'),
    async (request, response) => {
      const id = uuidSchema.parse(request.params.id);
      const organizationId = request.authUser!.organization.id;

      await database.transaction(async (tx) => {
        await tx.query(`delete from sale_items where sale_id = $1 and organization_id = $2`, [id, organizationId]);
        await tx.query(`delete from sales where id = $1 and organization_id = $2 and status = 'held'`, [id, organizationId]);
      });

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
        branchId: optionalUuid,
        cashierId: optionalUuid,
        paymentMethod: checkoutSchema.shape.payments.element.shape.method.optional(),
        from: z.string().optional(),
        to: z.string().optional(),
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
