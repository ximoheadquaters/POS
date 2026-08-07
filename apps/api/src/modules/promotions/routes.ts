import { Router } from 'express';
import { z } from 'zod';
import {
  createPromotionSchema,
  paginationSchema,
  updatePromotionSchema,
  uuidSchema,
} from '@ximo/shared';
import type { Database } from '../../database/types.js';
import { requireBranchAccess, requireModule } from '../../middleware/auth.js';
import { validateBody, validateQuery } from '../../middleware/validation.js';
import { notFound } from '../../shared/errors.js';
import { sendData, sendPage } from '../../shared/http.js';

export function promotionsRouter(database: Database): Router {
  const router = Router();

  // Enforce SaaS module enablement flag!
  router.use(requireModule('promotions'));

  // GET /promotions -> List promotions
  router.get(
    '/',
    validateQuery(
      paginationSchema.extend({
        type: uuidSchema.optional(),
      }),
    ),
    async (request, response) => {
      const { page, pageSize, search } = request.query as any;
      const organizationId = request.authUser!.organization.id;

      const result = await database.query(
        `select p.id, p.name, p.code, p.description, p.type,
          p.combo_price::text as "comboPrice",
          p.discount_percentage::text as "discountPercentage",
          p.discount_amount::text as "discountAmount",
          p.min_order_quantity as "minOrderQuantity",
          p.start_date as "startDate", p.end_date as "endDate",
          p.is_active as "isActive", p.created_at as "createdAt",
          (select count(*)::int from promotion_items pi where pi.promotion_id = p.id) as "itemCount",
          count(*) over()::int as total
         from promotions p
         where p.organization_id = $1
           and ($2::text is null or p.name ilike '%'||$2||'%' or p.code ilike '%'||$2||'%')
         order by p.created_at desc limit $3 offset $4`,
        [organizationId, search ?? null, pageSize, (page - 1) * pageSize],
      );

      const total = result.rows[0]?.total ?? 0;
      sendPage(
        response,
        result.rows.map(({ total: _total, ...row }) => row),
        page,
        pageSize,
        total,
      );
    },
  );

  // Must be registered before /:id — active combo bundles for the POS catalog.
  router.get(
    '/pos-catalog',
    validateQuery(
      z.object({
        branchId: uuidSchema,
        search: z.string().trim().min(1).max(120).optional(),
      }),
    ),
    requireBranchAccess('query'),
    async (request, response) => {
      const organizationId = request.authUser!.organization.id;
      const { branchId, search } = request.query as { branchId: string; search?: string };

      const result = await database.query(
        `select p.id, p.name, p.code, p.type,
          p.combo_price::text as "comboPrice",
          p.description,
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'productId', prod.id,
              'requiredQuantity', pi.required_quantity,
              'role', pi.role,
              'id', prod.id,
              'name', prod.name,
              'sku', prod.sku,
              'unit', prod.unit,
              'unitKind', pu.kind,
              'defaultStep', pu.default_step::float8,
              'trackInventory', prod.track_inventory,
              'sellingPrice', prod.selling_price::text,
              'taxRate', prod.tax_rate::text,
              'isTaxInclusive', prod.is_tax_inclusive,
              'status', prod.status,
              'categoryName', c.name,
              'availableQuantity', case
                when not prod.track_inventory then null
                else coalesce((
                  select bi.quantity::float8 from branch_inventory bi
                  where bi.organization_id = prod.organization_id
                    and bi.branch_id = $2
                    and bi.product_id = prod.id
                    and bi.variant_id is null
                ), 0)
              end
            ) order by prod.name)
            from promotion_items pi
            join products prod
              on prod.id = pi.product_id and prod.organization_id = pi.organization_id
            join product_units pu
              on pu.organization_id = prod.organization_id and pu.code = prod.unit
            left join categories c on c.id = prod.category_id
            where pi.promotion_id = p.id and pi.organization_id = p.organization_id
              and prod.status = 'active'
          ), '[]'::jsonb) as components
         from promotions p
         where p.organization_id = $1
           and p.is_active
           and p.type = 'combo_bundle'
           and p.combo_price is not null
           and (p.start_date is null or p.start_date <= now())
           and (p.end_date is null or p.end_date >= now())
           and ($3::text is null
             or p.name ilike '%' || $3 || '%'
             or coalesce(p.code, '') ilike '%' || $3 || '%')
         order by p.name`,
        [organizationId, branchId, search ?? null],
      );

      sendData(
        response,
        result.rows.filter(
          (row: { components?: unknown[] }) =>
            Array.isArray(row.components) && row.components.length > 0,
        ),
      );
    },
  );

  // GET /promotions/:id -> Get single promotion details with components
  router.get('/:id', async (request, response) => {
    const id = uuidSchema.parse(request.params.id);
    const organizationId = request.authUser!.organization.id;

    const promoResult = await database.query(
      `select p.id, p.name, p.code, p.description, p.type,
        p.combo_price::text as "comboPrice",
        p.discount_percentage::text as "discountPercentage",
        p.discount_amount::text as "discountAmount",
        p.min_order_quantity as "minOrderQuantity",
        p.start_date as "startDate", p.end_date as "endDate",
        p.is_active as "isActive", p.created_at as "createdAt"
       from promotions p
       where p.id = $1 and p.organization_id = $2`,
      [id, organizationId],
    );

    if (!promoResult.rows[0]) throw notFound('Promotion');

    const itemsResult = await database.query(
      `select pi.id, pi.product_id as "productId", pi.role, pi.required_quantity as "requiredQuantity",
        prod.name as "productName", prod.sku
       from promotion_items pi
       join products prod on prod.id = pi.product_id
       where pi.promotion_id = $1 and pi.organization_id = $2`,
      [id, organizationId],
    );

    sendData(response, {
      ...promoResult.rows[0],
      items: itemsResult.rows,
    });
  });

  // POST /promotions -> Create advanced promotion / combo deal
  router.post('/', validateBody(createPromotionSchema), async (request, response) => {
    const input = request.body;
    const organizationId = request.authUser!.organization.id;

    const created = await database.transaction(async (tx) => {
      const pRes = await tx.query<{ id: string }>(
        `insert into promotions (
           organization_id, name, code, description, type,
           combo_price, discount_percentage, discount_amount,
           min_order_quantity, start_date, end_date, is_active
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         returning id`,
        [
          organizationId,
          input.name,
          input.code ?? null,
          input.description ?? null,
          input.type,
          input.comboPrice ?? null,
          input.discountPercentage ?? null,
          input.discountAmount ?? null,
          input.minOrderQuantity ?? 1,
          input.startDate ?? null,
          input.endDate ?? null,
          input.isActive ?? true,
        ],
      );

      const promoId = pRes.rows[0]!.id;

      if (input.items && input.items.length > 0) {
        for (const item of input.items) {
          await tx.query(
            `insert into promotion_items (organization_id, promotion_id, product_id, role, required_quantity)
             values ($1, $2, $3, $4, $5)`,
            [
              organizationId,
              promoId,
              item.productId,
              item.role || 'combo_component',
              item.requiredQuantity || 1,
            ],
          );
        }
      }

      return { id: promoId, name: input.name, type: input.type };
    });

    sendData(response, created, 201);
  });

  // PUT /promotions/:id -> Update promotion / combo deal
  router.put('/:id', validateBody(updatePromotionSchema), async (request, response) => {
    const id = uuidSchema.parse(request.params.id);
    const input = request.body;
    const organizationId = request.authUser!.organization.id;

    const updated = await database.transaction(async (tx) => {
      const existing = await tx.query<{ id: string }>(
        `select id from promotions where id = $1 and organization_id = $2`,
        [id, organizationId],
      );
      if (!existing.rows[0]) throw notFound('Promotion');

      await tx.query(
        `update promotions set
           name = $3, code = $4, description = $5, type = $6,
           combo_price = $7, discount_percentage = $8, discount_amount = $9,
           min_order_quantity = $10, start_date = $11, end_date = $12,
           is_active = coalesce($13, is_active), updated_at = now()
         where id = $1 and organization_id = $2`,
        [
          id,
          organizationId,
          input.name,
          input.code ?? null,
          input.description ?? null,
          input.type,
          input.comboPrice ?? null,
          input.discountPercentage ?? null,
          input.discountAmount ?? null,
          input.minOrderQuantity ?? 1,
          input.startDate ?? null,
          input.endDate ?? null,
          input.isActive ?? null,
        ],
      );

      await tx.query(
        `delete from promotion_items where promotion_id = $1 and organization_id = $2`,
        [id, organizationId],
      );

      if (input.items && input.items.length > 0) {
        for (const item of input.items) {
          await tx.query(
            `insert into promotion_items (organization_id, promotion_id, product_id, role, required_quantity)
             values ($1, $2, $3, $4, $5)`,
            [
              organizationId,
              id,
              item.productId,
              item.role || 'combo_component',
              item.requiredQuantity || 1,
            ],
          );
        }
      }

      return { id, name: input.name, type: input.type };
    });

    sendData(response, updated);
  });

  // POST /promotions/:id/toggle -> Enable or disable promotion
  router.post('/:id/toggle', async (request, response) => {
    const id = uuidSchema.parse(request.params.id);
    const organizationId = request.authUser!.organization.id;

    const result = await database.query(
      `update promotions set is_active = not is_active, updated_at = now()
       where id = $1 and organization_id = $2
       returning id, is_active as "isActive"`,
      [id, organizationId],
    );

    if (!result.rows[0]) throw notFound('Promotion');
    sendData(response, result.rows[0]);
  });

  return router;
}
