import { Router } from 'express';
import { paginationSchema, stockAdjustmentSchema } from '@ximo/shared';
import type { Database } from '../../database/types.js';
import { requireBranchAccess, requireModule, requirePermission } from '../../middleware/auth.js';
import { validateBody, validateQuery } from '../../middleware/validation.js';
import { conflict, notFound } from '../../shared/errors.js';
import { sendData, sendPage } from '../../shared/http.js';

export function inventoryRouter(database: Database): Router {
  const router = Router();
  router.use(requireModule('inventory'));
  router.get(
    '/',
    requirePermission('inventory:read'),
    requireBranchAccess('query'),
    validateQuery(paginationSchema.extend({ branchId: stockAdjustmentSchema.shape.branchId })),
    async (request, response) => {
      const { branchId, page, pageSize, search } = request.query as any;
      const result = await database.query(
        `select bi.id,p.id as "productId",p.name,p.sku,p.unit,
          bi.quantity::float8 as quantity,bi.low_stock_level::float8 as "lowStockLevel",
          bi.average_cost::text as "averageCost",
          bi.inventory_value::text as "inventoryValue",
          (bi.quantity<=bi.low_stock_level) as "isLowStock",
          count(*) over()::int as total
         from branch_inventory bi join products p on p.id=bi.product_id
         where bi.organization_id=$1 and bi.branch_id=$2 and p.track_inventory
           and ($3::text is null or p.name ilike '%'||$3||'%' or p.sku ilike '%'||$3||'%')
         order by p.name limit $4 offset $5`,
        [
          request.authUser!.organization.id,
          branchId,
          search ?? null,
          pageSize,
          (page - 1) * pageSize,
        ],
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
  router.get(
    '/history',
    requirePermission('inventory:read'),
    requireBranchAccess('query'),
    validateQuery(paginationSchema.extend({ branchId: stockAdjustmentSchema.shape.branchId })),
    async (request, response) => {
      const { branchId, page, pageSize } = request.query as any;
      const result = await database.query(
        `select im.id,im.movement_type as "type",im.quantity_delta::float8 as "quantityDelta",
          im.quantity_after::float8 as "quantityAfter",im.reason,im.created_at as "createdAt",
          p.name as "productName",p.sku,p.unit,pr.display_name as "createdBy",
          count(*) over()::int as total
         from inventory_movements im join products p on p.id=im.product_id
         join profiles pr on pr.id=im.created_by
         where im.organization_id=$1 and im.branch_id=$2
         order by im.created_at desc limit $3 offset $4`,
        [request.authUser!.organization.id, branchId, pageSize, (page - 1) * pageSize],
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
  router.post(
    '/adjustments',
    requirePermission('inventory:adjust'),
    requireBranchAccess('body'),
    validateBody(stockAdjustmentSchema),
    async (request, response) => {
      const input = request.body;
      const organizationId = request.authUser!.organization.id;
      const movement = await database.transaction(async (tx) => {
        const settings = await tx.query<{ allow_negative_inventory: boolean }>(
          'select allow_negative_inventory from organization_settings where organization_id=$1',
          [organizationId],
        );
        const updated = await tx.query<{ quantity: number }>(
          `update branch_inventory bi set
             quantity=bi.quantity+$5,
             inventory_value=round(bi.average_cost*(bi.quantity+$5),4),
             updated_at=now()
           from products p
           where bi.organization_id=$1 and bi.branch_id=$2 and bi.product_id=$3
             and variant_id is not distinct from $4
             and p.id=bi.product_id and p.organization_id=bi.organization_id and p.track_inventory
           returning bi.quantity::float8 as quantity`,
          [
            organizationId,
            input.branchId,
            input.productId,
            input.variantId ?? null,
            input.quantityDelta,
          ],
        );
        if (!updated.rows[0]) throw notFound('Branch inventory');
        if (!settings.rows[0]?.allow_negative_inventory && updated.rows[0].quantity < 0) {
          throw conflict('NEGATIVE_INVENTORY', 'This adjustment would create negative inventory');
        }
        const result = await tx.query(
          `insert into inventory_movements (
            organization_id,branch_id,product_id,variant_id,movement_type,quantity_delta,
            quantity_after,reason,reference_type,created_by
           ) values ($1,$2,$3,$4,'adjustment',$5,$6,$7,'manual_adjustment',$8)
           returning id,quantity_delta::float8 as "quantityDelta",
             quantity_after::float8 as "quantityAfter",
             reason,created_at as "createdAt"`,
          [
            organizationId,
            input.branchId,
            input.productId,
            input.variantId ?? null,
            input.quantityDelta,
            updated.rows[0].quantity,
            input.reason,
            request.authUser!.id,
          ],
        );
        await tx.query(
          `insert into audit_logs (
            organization_id,branch_id,actor_id,action,entity_type,entity_id,after_data
           ) values ($1,$2,$3,'inventory.adjusted','inventory_movement',$4,$5::jsonb)`,
          [
            organizationId,
            input.branchId,
            request.authUser!.id,
            result.rows[0]!.id,
            JSON.stringify(input),
          ],
        );
        return result.rows[0];
      });
      sendData(response, movement, 201);
    },
  );
  return router;
}
