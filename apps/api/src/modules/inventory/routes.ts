import { Router } from 'express';
import { z } from 'zod';
import {
  openPortioningStockSchema,
  paginationSchema,
  productionBatchSchema,
  stockAdjustmentSchema,
} from '@ximo/shared';
import type { Database } from '../../database/types.js';
import { requireBranchAccess, requireModule, requirePermission } from '../../middleware/auth.js';
import { validateBody, validateQuery } from '../../middleware/validation.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';
import { sendData, sendPage } from '../../shared/http.js';
import { ProductionService } from './production-service.js';

export function inventoryRouter(database: Database): Router {
  const router = Router();
  router.use(requireModule('inventory'));
  router.get(
    '/',
    requirePermission('inventory:read'),
    requireBranchAccess('query'),
    validateQuery(
      paginationSchema.extend({
        branchId: stockAdjustmentSchema.shape.branchId,
        inventoryRole: z.enum(['sellable', 'ingredient', 'both']).optional(),
        sort: z.enum(['name', 'quantity_asc', 'quantity_desc']).optional(),
      }),
    ),
    async (request, response) => {
      const { branchId, page, pageSize, search, inventoryRole, sort } = request.query as unknown as {
        branchId: string;
        page: number;
        pageSize: number;
        search?: string;
        inventoryRole?: 'sellable' | 'ingredient' | 'both';
        sort?: 'name' | 'quantity_asc' | 'quantity_desc';
      };
      // Whitelist only — never interpolate raw query input into ORDER BY.
      const orderBy =
        sort === 'quantity_asc'
          ? 'bi.quantity asc nulls last, lower(p.name) asc'
          : sort === 'quantity_desc'
            ? 'bi.quantity desc nulls last, lower(p.name) asc'
            : 'lower(p.name) asc';
      const result = await database.query(
        `select bi.id,p.id as "productId",p.name,p.sku,p.unit,
          p.inventory_role as "inventoryRole",
          bi.quantity::float8 as quantity,bi.low_stock_level::float8 as "lowStockLevel",
          bi.average_cost::text as "averageCost",
          bi.inventory_value::text as "inventoryValue",
          bi.sealed_quantity::float8 as "sealedQuantity",
          bi.opened_quantity::float8 as "openedQuantity",
          (bi.quantity<=bi.low_stock_level) as "isLowStock",
          case when container.is_portioning_container then container.id end
            as "portioningVariantId",
          coalesce(container.is_portioning_container,false) as "portioningEnabled",
          container.name as "containerName",container.unit as "containerUnit",
          container.units_per_base::float8 as "containerUnitsPerBase",
          count(*) over()::int as total
         from branch_inventory bi join products p on p.id=bi.product_id
         left join lateral (
           select v.id,v.name,v.unit,v.units_per_base,v.is_portioning_container
           from product_variants v
           join product_units vu
             on vu.organization_id=v.organization_id and vu.code=v.unit
           where v.organization_id=bi.organization_id and v.product_id=bi.product_id
             and v.is_active and v.is_portioning_container
             and vu.kind='discrete' and v.units_per_base>1
           limit 1
         ) container on true
         where bi.organization_id=$1 and bi.branch_id=$2 and p.track_inventory
           and ($3::text is null or p.name ilike '%'||$3||'%' or p.sku ilike '%'||$3||'%')
           and ($6::text is null or coalesce(p.inventory_role, 'sellable') = $6)
         order by ${orderBy}
         limit $4 offset $5`,
        [
          request.authUser!.organization.id,
          branchId,
          search ?? null,
          pageSize,
          (page - 1) * pageSize,
          inventoryRole ?? null,
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
    '/summary',
    requirePermission('inventory:read'),
    requireBranchAccess('query'),
    validateQuery(z.object({ branchId: stockAdjustmentSchema.shape.branchId })),
    async (request, response) => {
      const { branchId } = request.query as { branchId: string };
      const result = await database.query<{
        all: number;
        sellable: number;
        ingredient: number;
        both: number;
      }>(
        `select count(*)::int as all,
          count(*) filter (where coalesce(p.inventory_role,'sellable')='sellable')::int as sellable,
          count(*) filter (where p.inventory_role='ingredient')::int as ingredient,
          count(*) filter (where p.inventory_role='both')::int as both
         from branch_inventory bi
         join products p on p.id=bi.product_id and p.organization_id=bi.organization_id
         where bi.organization_id=$1 and bi.branch_id=$2 and p.track_inventory`,
        [request.authUser!.organization.id, branchId],
      );
      sendData(response, result.rows[0] ?? { all: 0, sellable: 0, ingredient: 0, both: 0 });
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
  router.get(
    '/production-products',
    requireModule('production'),
    requirePermission('inventory:read'),
    requireBranchAccess('query'),
    validateQuery(z.object({ branchId: stockAdjustmentSchema.shape.branchId })),
    async (request, response) => {
      const { branchId } = request.query as { branchId: string };
      const result = await database.query<{
        productId: string;
        productName: string;
        sku: string;
        unit: string;
        unitKind: 'discrete' | 'decimal';
        quantity: number;
        ingredientProductId: string;
        ingredientName: string;
        quantityRequired: number;
        recipeUnit: string;
        baseUnit: string;
        availableQuantity: number;
        sealedQuantity: number;
        openedQuantity: number;
        containerName: string | null;
        containerUnit: string | null;
        unitsPerBase: number | null;
        portioningEnabled: boolean;
      }>(
        `select parent.id as "productId",parent.name as "productName",parent.sku,
          parent.unit,coalesce(parent_unit.kind, 'discrete') as "unitKind",coalesce(output_inventory.quantity, 0)::float8 as quantity,
          ingredient.id as "ingredientProductId",ingredient.name as "ingredientName",
          pr.quantity_required::float8 as "quantityRequired",pr.unit as "recipeUnit",
          ingredient.unit as "baseUnit",coalesce(ingredient_inventory.quantity, 0)::float8 as "availableQuantity",
          coalesce(ingredient_inventory.sealed_quantity, 0)::float8 as "sealedQuantity",
          coalesce(ingredient_inventory.opened_quantity, 0)::float8 as "openedQuantity",
          container.name as "containerName",container.unit as "containerUnit",
          container.units_per_base::float8 as "unitsPerBase",
          (container.id is not null) as "portioningEnabled"
         from products parent
         left join product_units parent_unit on (parent_unit.organization_id=parent.organization_id or parent_unit.organization_id is null)
           and parent_unit.code=parent.unit
         left join branch_inventory output_inventory on output_inventory.organization_id=parent.organization_id
           and output_inventory.branch_id=$2 and output_inventory.product_id=parent.id
           and output_inventory.variant_id is null
         join product_recipes pr on pr.organization_id=parent.organization_id
           and pr.parent_product_id=parent.id
         join products ingredient on ingredient.organization_id=pr.organization_id
           and ingredient.id=pr.ingredient_product_id
         left join branch_inventory ingredient_inventory on ingredient_inventory.organization_id=pr.organization_id
           and ingredient_inventory.branch_id=$2
           and ingredient_inventory.product_id=pr.ingredient_product_id
           and ingredient_inventory.variant_id is not distinct from pr.ingredient_variant_id
         left join product_variants container on container.organization_id=ingredient.organization_id
           and container.product_id=ingredient.id and container.is_portioning_container
           and container.is_active
         where parent.organization_id=$1 and parent.status='active' and parent.track_inventory
           and parent.inventory_role in ('sellable','both')
         order by parent.name,ingredient.name`,
        [request.authUser!.organization.id, branchId],
      );
      const products = new Map<
        string,
        {
          id: string;
          name: string;
          sku: string;
          unit: string;
          unitKind: 'discrete' | 'decimal';
          quantity: number;
          ingredients: Array<Record<string, unknown>>;
        }
      >();
      for (const row of result.rows) {
        const product = products.get(row.productId) ?? {
          id: row.productId,
          name: row.productName,
          sku: row.sku,
          unit: row.unit,
          unitKind: row.unitKind,
          quantity: row.quantity,
          ingredients: [],
        };
        product.ingredients.push({
          productId: row.ingredientProductId,
          name: row.ingredientName,
          quantityRequired: row.quantityRequired,
          recipeUnit: row.recipeUnit,
          baseUnit: row.baseUnit,
          availableQuantity: row.availableQuantity,
          sealedQuantity: row.sealedQuantity,
          openedQuantity: row.openedQuantity,
          containerName: row.containerName,
          containerUnit: row.containerUnit,
          unitsPerBase: row.unitsPerBase,
          portioningEnabled: row.portioningEnabled,
        });
        products.set(row.productId, product);
      }
      sendData(response, [...products.values()]);
    },
  );
  router.post(
    '/production/preview',
    requireModule('production'),
    requirePermission('inventory:read'),
    requireBranchAccess('body'),
    validateBody(
      z.object({
        branchId: z.string().uuid(),
        productId: z.string().uuid(),
        quantity: z.number().positive(),
      }),
    ),
    async (request, response) => {
      const result = await new ProductionService(database).preview(
        {
          userId: request.authUser!.id,
          organizationId: request.authUser!.organization.id,
        },
        request.body as { branchId: string; productId: string; quantity: number },
      );
      sendData(response, result);
    },
  );
  router.post(
    '/production',
    requireModule('production'),
    requirePermission('inventory:adjust'),
    requireBranchAccess('body'),
    validateBody(productionBatchSchema),
    async (request, response) => {
      const result = await new ProductionService(database).create(
        {
          userId: request.authUser!.id,
          organizationId: request.authUser!.organization.id,
        },
        request.body,
      );
      sendData(response, result, 201);
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
        const config = await tx.query<{
          trackInventory: boolean;
          name: string;
          portioningVariantId: string | null;
          unitsPerBase: number | null;
        }>(
          `select p.track_inventory as "trackInventory",p.name,pv.id as "portioningVariantId",
            pv.units_per_base::float8 as "unitsPerBase"
           from products p
           left join product_variants pv
             on pv.organization_id=p.organization_id and pv.product_id=p.id
             and pv.is_portioning_container
           where p.organization_id=$1 and p.id=$2`,
          [organizationId, input.productId],
        );
        const product = config.rows[0];
        if (!product?.trackInventory) throw notFound('Inventory-tracked product');
        if (product.portioningVariantId && input.pool === 'shared') {
          throw badRequest(
            'SELECT_STOCK_POOL',
            'Choose sealed containers or opened portion stock for this adjustment',
          );
        }
        if (!product.portioningVariantId && input.pool !== 'shared') {
          throw badRequest(
            'INVALID_STOCK_POOL',
            'This product does not have separate sealed and opened stock',
          );
        }
        if (input.pool === 'sealed' && !Number.isInteger(input.quantityDelta)) {
          throw badRequest('WHOLE_CONTAINER_QUANTITY', 'Sealed containers use whole quantities');
        }
        const baseQuantityDelta =
          input.pool === 'sealed'
            ? input.quantityDelta * Number(product.unitsPerBase)
            : input.quantityDelta;
        const sealedDelta = input.pool === 'sealed' ? input.quantityDelta : 0;
        const openedDelta = input.pool === 'opened' ? input.quantityDelta : 0;

        await tx.query(
          `insert into branch_inventory (organization_id, branch_id, product_id, quantity, sealed_quantity, opened_quantity, average_cost, inventory_value)
           select $1, $2, $3, 0, 0, 0, 0, 0
           where not exists (
             select 1 from branch_inventory where organization_id=$1 and branch_id=$2 and product_id=$3 and variant_id is null
           )`,
          [organizationId, input.branchId, input.productId],
        );

        const updated = await tx.query<{
          quantity: number;
          sealedQuantity: number;
          openedQuantity: number;
        }>(
          `update branch_inventory bi set
             quantity=bi.quantity+$4,
             inventory_value=round(bi.average_cost*(bi.quantity+$4),4),
             sealed_quantity=bi.sealed_quantity+$5,
             opened_quantity=bi.opened_quantity+$6,
             updated_at=now()
           from products p
           where bi.organization_id=$1 and bi.branch_id=$2 and bi.product_id=$3
             and bi.variant_id is null
             and p.id=bi.product_id and p.organization_id=bi.organization_id and p.track_inventory
           returning bi.quantity::float8 as quantity,
             bi.sealed_quantity::float8 as "sealedQuantity",
             bi.opened_quantity::float8 as "openedQuantity"`,
          [
            organizationId,
            input.branchId,
            input.productId,
            baseQuantityDelta,
            sealedDelta,
            openedDelta,
          ],
        );
        if (!updated.rows[0]) throw notFound('Branch inventory');
        if (
          !settings.rows[0]?.allow_negative_inventory &&
          (updated.rows[0].quantity < 0 ||
            updated.rows[0].sealedQuantity < 0 ||
            updated.rows[0].openedQuantity < 0)
        ) {
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
            input.pool === 'sealed' ? product.portioningVariantId : null,
            baseQuantityDelta,
            updated.rows[0].quantity,
            input.reason,
            request.authUser!.id,
          ],
        );
        if (input.pool !== 'shared') {
          await tx.query(
            `insert into inventory_pool_movements (
              organization_id,branch_id,product_id,container_variant_id,movement_type,
              sealed_quantity_delta,opened_quantity_delta,sealed_quantity_after,
              opened_quantity_after,reason,reference_type,reference_id,created_by
             ) values ($1,$2,$3,$4,'adjustment',$5,$6,$7,$8,$9,
               'inventory_movement',$10,$11)`,
            [
              organizationId,
              input.branchId,
              input.productId,
              product.portioningVariantId,
              sealedDelta,
              openedDelta,
              updated.rows[0].sealedQuantity,
              updated.rows[0].openedQuantity,
              input.reason,
              result.rows[0]!.id,
              request.authUser!.id,
            ],
          );
        }
        await tx.query(
          `insert into audit_logs (
            organization_id,branch_id,actor_id,action,entity_type,entity_id,after_data
           ) values ($1,$2,$3,'inventory.adjusted','inventory_movement',$4,$5::jsonb)`,
          [
            organizationId,
            input.branchId,
            request.authUser!.id,
            result.rows[0]!.id,
            JSON.stringify({ ...input, productName: product.name }),
          ],
        );
        return result.rows[0];
      });
      sendData(response, movement, 201);
    },
  );
  router.post(
    '/open-portions',
    requirePermission('inventory:adjust'),
    requireBranchAccess('body'),
    validateBody(openPortioningStockSchema),
    async (request, response) => {
      const input = request.body;
      if (!Number.isInteger(input.containerQuantity)) {
        throw badRequest('WHOLE_CONTAINER_QUANTITY', 'Open a whole number of containers');
      }
      const organizationId = request.authUser!.organization.id;
      const opened = await database.transaction(async (tx) => {
        const updated = await tx.query<{
          quantity: number;
          sealedQuantity: number;
          openedQuantity: number;
          portioningVariantId: string;
          unitsPerBase: number;
          containerName: string;
        }>(
          `update branch_inventory bi set
             sealed_quantity=bi.sealed_quantity-$4,
             opened_quantity=bi.opened_quantity+($4*pv.units_per_base),
             updated_at=now()
           from product_variants pv
           where bi.organization_id=$1 and bi.branch_id=$2 and bi.product_id=$3
             and bi.variant_id is null and pv.organization_id=bi.organization_id
             and pv.product_id=bi.product_id and pv.is_portioning_container and pv.is_active
             and bi.sealed_quantity >= $4
           returning bi.quantity::float8 as quantity,
             bi.sealed_quantity::float8 as "sealedQuantity",
             bi.opened_quantity::float8 as "openedQuantity",
             pv.id as "portioningVariantId",pv.units_per_base::float8 as "unitsPerBase",
             pv.name as "containerName"`,
          [organizationId, input.branchId, input.productId, input.containerQuantity],
        );
        const state = updated.rows[0];
        if (!state) {
          throw conflict(
            'INSUFFICIENT_SEALED_STOCK',
            'There are not enough sealed containers available to open',
          );
        }
        await tx.query(
          `insert into inventory_pool_movements (
            organization_id,branch_id,product_id,container_variant_id,movement_type,
            sealed_quantity_delta,opened_quantity_delta,sealed_quantity_after,
            opened_quantity_after,reason,reference_type,created_by
           ) values ($1,$2,$3,$4,'open_container',$5,$6,$7,$8,$9,
             'manual_opening',$10)`,
          [
            organizationId,
            input.branchId,
            input.productId,
            state.portioningVariantId,
            -input.containerQuantity,
            input.containerQuantity * state.unitsPerBase,
            state.sealedQuantity,
            state.openedQuantity,
            input.reason,
            request.authUser!.id,
          ],
        );
        await tx.query(
          `insert into audit_logs (
            organization_id,branch_id,actor_id,action,entity_type,entity_id,after_data
           ) values ($1,$2,$3,'inventory.container_opened','product',$4,$5::jsonb)`,
          [
            organizationId,
            input.branchId,
            request.authUser!.id,
            input.productId,
            JSON.stringify({
              containerQuantity: input.containerQuantity,
              openedQuantity: input.containerQuantity * state.unitsPerBase,
              reason: input.reason,
            }),
          ],
        );
        return state;
      });
      sendData(response, opened, 201);
    },
  );
  return router;
}
