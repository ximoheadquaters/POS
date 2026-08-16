import { Router } from 'express';
import { z } from 'zod';
import {
  brandSchema,
  categorySchema,
  createProductSchema,
  paginationSchema,
  productLookupSchema,
  productUnitSchema,
  productVariantSchema,
  saveRecipeSchema,
  updateProductSchema,
  uuidSchema,
  validateUnitConversion,
} from '@ximo/shared';
import type { Database, Queryable } from '../../database/types.js';
import { requireBranchAccess, requireModule, requirePermission } from '../../middleware/auth.js';
import { validateBody, validateQuery } from '../../middleware/validation.js';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors.js';
import { sendData, sendPage } from '../../shared/http.js';

const CORE_PRODUCT_UNITS: Record<
  string,
  { name: string; kind: 'discrete' | 'decimal'; defaultStep: number }
> = {
  piece: { name: 'Piece', kind: 'discrete', defaultStep: 1 },
  serving: { name: 'Serving', kind: 'discrete', defaultStep: 1 },
  box: { name: 'Box', kind: 'discrete', defaultStep: 1 },
  pack: { name: 'Pack', kind: 'discrete', defaultStep: 1 },
  sack: { name: 'Sack', kind: 'discrete', defaultStep: 1 },
  bottle: { name: 'Bottle', kind: 'discrete', defaultStep: 1 },
  can: { name: 'Can', kind: 'discrete', defaultStep: 1 },
  ml: { name: 'Milliliter', kind: 'decimal', defaultStep: 100 },
  l: { name: 'Liter', kind: 'decimal', defaultStep: 0.1 },
  g: { name: 'Gram', kind: 'decimal', defaultStep: 100 },
  kg: { name: 'Kilogram', kind: 'decimal', defaultStep: 0.1 },
};

async function validateProductMasters(
  database: Queryable,
  organizationId: string,
  branchId: string,
  input: { categoryId?: string | null; brandId?: string | null; unit: string },
) {
  const result = await database.query<{
    unitValid: boolean;
    categoryValid: boolean;
    brandValid: boolean;
  }>(
    `select
      exists(select 1 from product_units where organization_id=$1 and code=$2 and is_active)
        as "unitValid",
      ($3::uuid is null or exists(
        select 1 from categories where organization_id=$1 and branch_id=$5 and id=$3 and is_active
      )) as "categoryValid",
      ($4::uuid is null or exists(
        select 1 from brands where organization_id=$1 and branch_id=$5 and id=$4 and is_active
      )) as "brandValid"`,
    [organizationId, input.unit, input.categoryId ?? null, input.brandId ?? null, branchId],
  );
  const state = result.rows[0];
  if (!state?.unitValid) {
    // Organizations provisioned by an older platform release can be missing a
    // built-in unit used by the current Add Product presets. Repair only the
    // known system unit; custom or unknown unit codes must still be rejected.
    const coreUnit = CORE_PRODUCT_UNITS[input.unit];
    if (!coreUnit) throw badRequest('INVALID_PRODUCT_UNIT', 'Select an active product unit');
    await database.query(
      `insert into product_units (
         organization_id,code,name,kind,default_step,is_system,is_active
       ) values ($1,$2,$3,$4,$5,true,true)
       on conflict (organization_id,code) do update set
         name=excluded.name,kind=excluded.kind,default_step=excluded.default_step,
         is_system=true,is_active=true,updated_at=now()`,
      [organizationId, input.unit, coreUnit.name, coreUnit.kind, coreUnit.defaultStep],
    );
  }
  if (!state?.categoryValid) throw badRequest('INVALID_CATEGORY', 'Select an active category');
  if (!state?.brandValid) throw badRequest('INVALID_BRAND', 'Select an active brand');
}

function recipeUnitFamily(unit: string): 'mass' | 'volume' | 'piece' | null {
  const normalized = normalizeRecipeUnit(unit);
  if (['g', 'gram', 'grams', 'kg', 'kilogram', 'kilograms'].includes(normalized)) return 'mass';
  if (['ml', 'milliliter', 'milliliters', 'l', 'liter', 'liters'].includes(normalized)) {
    return 'volume';
  }
  if (['piece', 'serving', 'pack', 'box', 'sack', 'bottle', 'can'].includes(normalized)) {
    return 'piece';
  }
  return null;
}

function normalizeRecipeUnit(unit: string): string {
  const normalized = unit.trim().toLowerCase();
  const aliases: Record<string, string> = {
    pieces: 'piece',
    pc: 'piece',
    pcs: 'piece',
    servings: 'serving',
    packs: 'pack',
    boxes: 'box',
    sacks: 'sack',
    bottles: 'bottle',
    cans: 'can',
  };
  return aliases[normalized] ?? normalized;
}

export function productsRouter(database: Database): Router {
  const router = Router();
  router.use(requireModule('products'));
  router.get(
    '/lookup',
    requirePermission('products:read'),
    validateQuery(
      productLookupSchema.extend({
        branchId: uuidSchema,
        usage: z.enum(['pos', 'bom']).optional(),
      }),
    ),
    async (request, response) => {
      const { code, branchId, usage } = request.query as unknown as {
        code: string;
        branchId: string;
        usage?: 'pos' | 'bom';
      };
      if (!request.authUser!.branches.some((assignedBranch) => assignedBranch.id === branchId)) {
        throw forbidden('BRANCH_ACCESS_DENIED', 'You do not have access to this branch');
      }
      const result = await database.query(
        `select p.id,p.name,p.sku,p.unit,p.inventory_role as "inventoryRole",pu.kind as "unitKind",
          pu.default_step::float8 as "defaultStep",p.category_id as "categoryId",
          p.brand_id as "brandId",p.track_inventory as "trackInventory",
          p.selling_price::text as "sellingPrice",
          p.tax_rate::text as "taxRate",p.is_tax_inclusive as "isTaxInclusive",p.status,
          case when not p.track_inventory or $3::uuid is null then null else coalesce((
            select bi.quantity::float8 from branch_inventory bi
            where bi.organization_id=p.organization_id and bi.branch_id=$3
              and bi.product_id=p.id and bi.variant_id is null
          ),0) end as "availableQuantity",
          coalesce((
            select jsonb_agg(pb.barcode)
            from product_barcodes pb
            where pb.product_id=p.id and pb.variant_id is null
          ),'[]') as barcodes,
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'variantId',v.id,'name',v.name,'sku',v.sku,'unit',v.unit,
              'unitKind',vu.kind,'defaultStep',vu.default_step::float8,
              'unitsPerBase',v.units_per_base::float8,
              'isPortioningContainer',v.is_portioning_container,
              'cost',coalesce(v.cost,p.cost*v.units_per_base)::text,
              'sellingPrice',coalesce(v.selling_price,p.selling_price)::text,
              'barcodes',coalesce((
                select jsonb_agg(vb.barcode) from product_barcodes vb where vb.variant_id=v.id
              ),'[]'::jsonb)
            ) order by v.units_per_base,v.name)
            from product_variants v
            join product_units vu
              on vu.organization_id=v.organization_id and vu.code=v.unit
            where v.product_id=p.id and v.organization_id=p.organization_id and v.is_active
          ),'[]') as "sellingUnits"
         from products p
         join product_units pu on pu.organization_id=p.organization_id and pu.code=p.unit
         where p.organization_id=$1 and p.branch_id=$3 and p.status='active'
           and ($4::text is null
             or ($4='pos' and p.inventory_role in ('sellable','both'))
             or ($4='bom' and p.track_inventory))
           and ($4::text is distinct from 'pos'
            or not p.track_inventory
             or exists (
               select 1 from branch_inventory branch_stock
               where branch_stock.organization_id=p.organization_id
                 and branch_stock.branch_id=$3
                 and branch_stock.product_id=p.id
                 and branch_stock.variant_id is null
                 and branch_stock.quantity>0
             ))
           and (
           p.sku=$2 or exists (
             select 1 from product_variants sv
             where sv.product_id=p.id and sv.organization_id=$1 and sv.sku=$2 and sv.is_active
           ) or exists (
             select 1 from product_barcodes pb
             where pb.product_id=p.id and pb.organization_id=$1 and pb.barcode=$2
           )
         )
         order by case when p.sku=$2 then 0 else 1 end
         limit 1`,
        [request.authUser!.organization.id, code, branchId ?? null, usage ?? null],
      );
      sendData(response, result.rows[0] ?? null);
    },
  );
  router.get(
    '/',
    requirePermission('products:read'),
    validateQuery(
      paginationSchema.extend({
        branchId: uuidSchema,
        includeIncoming: z
          .enum(['true', 'false'])
          .optional()
          .transform((value) => value === 'true'),
        includeInactive: z
          .enum(['true', 'false'])
          .optional()
          .transform((value) => value === 'true'),
        status: z
          .string()
          .optional()
          .transform((val, ctx) => {
            if (!val) return undefined;
            const parts = val.split(',').map((s) => s.trim()).filter(Boolean);
            const valid = ['active', 'inactive', 'pending_receipt'];
            for (const p of parts) {
              if (!valid.includes(p)) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message: `Invalid status filter value: ${p}`,
                });
                return z.NEVER;
              }
            }
            return parts;
          }),
        usage: z.enum(['pos', 'bom']).optional(),
        inventoryRole: z
          .string()
          .optional()
          .transform((val, ctx) => {
            if (!val) return undefined;
            const parts = val.split(',').map((s) => s.trim()).filter(Boolean);
            const valid = ['sellable', 'ingredient', 'both'];
            for (const p of parts) {
              if (!valid.includes(p)) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid inventoryRole filter value: ${p}` });
                return z.NEVER;
              }
            }
            return parts;
          }),
        preparationBehavior: z
          .string()
          .optional()
          .transform((val, ctx) => {
            if (!val) return undefined;
            const parts = val.split(',').map((s) => s.trim()).filter(Boolean);
            const valid = ['standard', 'cook_to_order', 'preproduced'];
            for (const p of parts) {
              if (!valid.includes(p)) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid preparationBehavior filter value: ${p}` });
                return z.NEVER;
              }
            }
            return parts;
          }),
        hasRecipe: z
          .enum(['true', 'false'])
          .optional()
          .transform((v) => (v ? v === 'true' : undefined)),
      }),
    ),
    async (request, response) => {
      const {
        page,
        pageSize,
        search,
        branchId,
        includeIncoming,
        includeInactive,
        usage,
        inventoryRole,
        preparationBehavior,
        hasRecipe,
      } = request.query as unknown as {
        page: number;
        pageSize: number;
        search?: string;
        branchId: string;
        includeIncoming: boolean;
        includeInactive: boolean;
        usage?: 'pos' | 'bom';
        inventoryRole?: string[];
        preparationBehavior?: string[];
        hasRecipe?: boolean;
      };
      if (!request.authUser!.branches.some((assignedBranch) => assignedBranch.id === branchId)) {
        throw forbidden('BRANCH_ACCESS_DENIED', 'You do not have access to this branch');
      }
      const offset = (page - 1) * pageSize;
      const organizationId = request.authUser!.organization.id;
      const result = await database.query(
        `select p.id,p.name,p.sku,p.unit,p.inventory_role as "inventoryRole",
          coalesce(p.preparation_behavior, 'standard') as "preparationBehavior",
          exists(select 1 from product_recipes pr where pr.parent_product_id=p.id and pr.organization_id=p.organization_id) as "hasRecipe",
          coalesce(pu.kind, 'discrete') as "unitKind",
          coalesce(pu.default_step, 1)::float8 as "defaultStep",p.category_id as "categoryId",
          p.brand_id as "brandId",p.track_inventory as "trackInventory",
          p.cost::text,p.selling_price::text as "sellingPrice",
          effective.cost::text as "averageCost",
          case when p.selling_price=0 then null
            else round((p.selling_price-effective.cost)/p.selling_price*100,2)::text
          end as "grossMarginPercent",
          round(effective.cost/(1-os.target_margin_percent/100),2)::text
            as "suggestedSellingPrice",
          os.target_margin_percent::text as "targetMarginPercent",
          os.low_margin_threshold_percent::text as "lowMarginThresholdPercent",
          case when p.selling_price=0 then true
            else ((p.selling_price-effective.cost)/p.selling_price*100)
              < os.low_margin_threshold_percent
          end as "isLowMargin",
          p.tax_rate::text as "taxRate",p.is_tax_inclusive as "isTaxInclusive",
          p.status,p.image_path as "imagePath",c.name as "categoryName",br.name as "brandName",
          case when not p.track_inventory or $5::uuid is null then null else coalesce((
            select bi.quantity::float8 from branch_inventory bi
            where bi.organization_id=p.organization_id and bi.branch_id=$5
              and bi.product_id=p.id and bi.variant_id is null
          ),0) end as "availableQuantity",
          coalesce((select jsonb_agg(pb.barcode) from product_barcodes pb
            where pb.product_id=p.id and pb.variant_id is null),'[]') as barcodes,
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'variantId',v.id,'name',v.name,'sku',v.sku,'unit',v.unit,
              'unitKind',vu.kind,'defaultStep',vu.default_step::float8,
              'unitsPerBase',v.units_per_base::float8,
              'isPortioningContainer',v.is_portioning_container,
              'cost',coalesce(v.cost,p.cost*v.units_per_base)::text,
              'sellingPrice',coalesce(v.selling_price,p.selling_price)::text,
              'barcodes',coalesce((
                select jsonb_agg(vb.barcode) from product_barcodes vb where vb.variant_id=v.id
              ),'[]'::jsonb)
            ) order by v.units_per_base,v.name)
            from product_variants v
            join product_units vu
              on vu.organization_id=v.organization_id and vu.code=v.unit
            where v.product_id=p.id and v.organization_id=p.organization_id and v.is_active
          ),'[]') as "sellingUnits",
          count(*) over()::int as total
         from products p
         left join product_units pu on pu.organization_id=p.organization_id and pu.code=p.unit
         join organization_settings os on os.organization_id=p.organization_id
         left join branch_inventory costing_inventory
           on costing_inventory.organization_id=p.organization_id
           and costing_inventory.branch_id=$5
           and costing_inventory.product_id=p.id
           and costing_inventory.variant_id is null
         cross join lateral (
           select case when p.track_inventory and $5::uuid is not null
             then coalesce(costing_inventory.average_cost,p.cost)
             else p.cost
           end::numeric as cost
         ) effective
         left join categories c on c.id=p.category_id
         left join brands br on br.id=p.brand_id
          where p.organization_id=$1 and p.branch_id=$5 and (
            p.status='active'
            or ($6::boolean and p.status='pending_receipt')
            or ($7::boolean and p.status='inactive')
          ) and ($8::text is null
            or ($8='pos' and p.inventory_role in ('sellable','both'))
            or ($8='bom' and p.track_inventory))
          and ($8::text is distinct from 'pos'
            or not p.track_inventory
            or exists (
              select 1 from branch_inventory branch_stock
              where branch_stock.organization_id=p.organization_id
                and branch_stock.branch_id=$5
                and branch_stock.product_id=p.id
                and branch_stock.variant_id is null
                and branch_stock.quantity>0
            ))
          and ($2::text is null or
           p.name ilike '%'||$2||'%' or p.sku ilike '%'||$2||'%' or exists (
             select 1 from product_barcodes pb where pb.product_id=p.id and pb.barcode=$2
           ))
          and ($9::text[] is null or coalesce(p.inventory_role, 'sellable') = any($9::text[]))
          and ($10::text[] is null or coalesce(p.preparation_behavior, 'standard') = any($10::text[]))
          and ($11::boolean is null or (
            ($11 = true and exists(select 1 from product_recipes pr where pr.parent_product_id=p.id and pr.organization_id=p.organization_id))
            or
            ($11 = false and not exists(select 1 from product_recipes pr where pr.parent_product_id=p.id and pr.organization_id=p.organization_id))
          ))
         order by p.name limit $3 offset $4`,
        [
          organizationId,
          search ?? null,
          pageSize,
          offset,
          branchId ?? null,
          includeIncoming ?? false,
          includeInactive ?? false,
          usage ?? null,
          inventoryRole ?? null,
          preparationBehavior ?? null,
          hasRecipe ?? null,
        ],
      );
      const total = (result.rows[0] as { total?: number } | undefined)?.total ?? 0;
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
    requirePermission('products:read'),
    validateQuery(z.object({ branchId: uuidSchema })),
    requireBranchAccess('query'),
    async (request, response) => {
    const { branchId } = request.query as { branchId: string };
    const result = await database.query<{
      all: number;
      sellable: number;
      ingredient: number;
      both: number;
      enabled: number;
      disabled: number;
    }>(
      `select count(*)::int as all,
        count(*) filter (where coalesce(inventory_role, 'sellable')='sellable')::int as sellable,
        count(*) filter (where inventory_role='ingredient')::int as ingredient,
        count(*) filter (where inventory_role='both')::int as both,
        count(*) filter (where status='active')::int as enabled,
        count(*) filter (where status='inactive')::int as disabled
       from products where organization_id=$1 and branch_id=$2`,
      [request.authUser!.organization.id, branchId],
    );
    sendData(
      response,
      result.rows[0] ?? {
        all: 0,
        sellable: 0,
        ingredient: 0,
        both: 0,
        enabled: 0,
        disabled: 0,
      },
    );
    },
  );
  router.post(
    '/',
    requirePermission('products:manage'),
    requireBranchAccess('body'),
    validateBody(createProductSchema),
    async (request, response) => {
      const { branchId, openingQuantity, openingContainerQuantity, sellingUnits, ...input } =
        request.body;
      const organizationId = request.authUser!.organization.id;

      if (input.inventoryRole === 'ingredient' || input.inventoryRole === 'both') {
        if (!request.authUser!.modules.includes('ingredients')) {
          throw forbidden(
            'MODULE_DISABLED',
            'The Ingredients module is required for ingredient products.',
          );
        }
      }
      if (input.preparationBehavior === 'cook_to_order') {
        if (!request.authUser!.modules.includes('recipes')) {
          throw forbidden(
            'MODULE_DISABLED',
            'The Recipes module is required for cook-to-order products.',
          );
        }
        if (!request.authUser!.modules.includes('prepared_food')) {
          throw forbidden(
            'MODULE_DISABLED',
            'The Prepared Food module is required for cook-to-order products.',
          );
        }
      }
      if (input.preparationBehavior === 'preproduced') {
        if (!request.authUser!.modules.includes('recipes')) {
          throw forbidden(
            'MODULE_DISABLED',
            'The Recipes module is required for preproduced products.',
          );
        }
        if (!request.authUser!.modules.includes('production')) {
          throw forbidden(
            'MODULE_DISABLED',
            'The Production module is required for preproduced products.',
          );
        }
      }

      const product = await database.transaction(async (tx) => {
        await validateProductMasters(tx, organizationId, branchId, input);
        const created = await tx.query<{
          id: string;
          name: string;
          sku: string;
          unit: string;
          inventoryRole: string;
          preparationBehavior: string;
          trackInventory: boolean;
          sellingPrice: string;
          taxRate: string;
          isTaxInclusive: boolean;
          status: string;
        }>(
          `insert into products (
            organization_id,branch_id,category_id,brand_id,name,sku,unit,inventory_role,preparation_behavior,
            track_inventory,description,cost,selling_price,tax_rate,is_tax_inclusive,status,image_path
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           returning id,name,sku,unit,inventory_role as "inventoryRole",
             preparation_behavior as "preparationBehavior",track_inventory as "trackInventory",
             selling_price::text as "sellingPrice",tax_rate::text as "taxRate",
             is_tax_inclusive as "isTaxInclusive",status`,
          [
            organizationId,
            branchId,
            input.categoryId ?? null,
            input.brandId ?? null,
            input.name,
            input.sku,
            input.unit,
            input.inventoryRole,
            input.preparationBehavior ?? 'standard',
            input.trackInventory,
            input.description ?? null,
            input.cost,
            input.sellingPrice,
            input.taxRate,
            input.isTaxInclusive,
            input.status,
            input.imagePath ?? null,
          ],
        );
        if (input.barcode) {
          await tx.query(
            `insert into product_barcodes (organization_id,branch_id,product_id,barcode) values ($1,$2,$3,$4)`,
            [organizationId, branchId, created.rows[0]!.id, input.barcode],
          );
        }
        let portioningContainer: { id: string; unitsPerBase: number } | null = null;
        for (const sellingUnit of sellingUnits) {
          await validateProductMasters(tx, organizationId, branchId, { unit: sellingUnit.unit });
          const variant = await tx.query<{ id: string }>(
            `insert into product_variants (
              organization_id,branch_id,product_id,name,sku,unit,units_per_base,cost,selling_price,
              is_active,is_portioning_container
             ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10) returning id`,
            [
              organizationId,
              branchId,
              created.rows[0]!.id,
              sellingUnit.name,
              sellingUnit.sku,
              sellingUnit.unit,
              sellingUnit.unitsPerBase,
              sellingUnit.cost ?? null,
              sellingUnit.sellingPrice,
              sellingUnit.isPortioningContainer,
            ],
          );
          if (sellingUnit.isPortioningContainer) {
            portioningContainer = {
              id: variant.rows[0]!.id,
              unitsPerBase: sellingUnit.unitsPerBase,
            };
          }
          if (sellingUnit.barcode) {
            await tx.query(
              `insert into product_barcodes (
                organization_id,branch_id,product_id,variant_id,barcode
               ) values ($1,$2,$3,$4,$5)`,
              [organizationId, branchId, created.rows[0]!.id, variant.rows[0]!.id, sellingUnit.barcode],
            );
          }
        }
        const sealedOpeningQuantity = portioningContainer ? openingContainerQuantity : 0;
        const openedOpeningQuantity = portioningContainer ? openingQuantity : 0;
        const totalOpeningQuantity = portioningContainer
          ? openedOpeningQuantity + sealedOpeningQuantity * portioningContainer.unitsPerBase
          : openingQuantity;
        await tx.query(
          `insert into branch_inventory (
            organization_id,branch_id,product_id,variant_id,quantity,inventory_value,average_cost,
            sealed_quantity,opened_quantity
           )
           values ($1,$3,$2,null,$4,round($4::numeric*$5::numeric,4),
             round($5::numeric,4),
             $6,$7)`,
          [
            organizationId,
            created.rows[0]!.id,
            branchId,
            input.trackInventory ? totalOpeningQuantity : 0,
            input.cost,
            input.trackInventory ? sealedOpeningQuantity : 0,
            input.trackInventory ? openedOpeningQuantity : 0,
          ],
        );
        if (input.trackInventory && totalOpeningQuantity > 0) {
          const movement = await tx.query<{ id: string }>(
            `insert into inventory_movements (
              organization_id,branch_id,product_id,variant_id,movement_type,quantity_delta,
              quantity_after,reason,reference_type,created_by
             ) values ($1,$2,$3,null,'adjustment',$4,$4,'Opening stock','product_setup',$5)
             returning id`,
            [
              organizationId,
              branchId,
              created.rows[0]!.id,
              totalOpeningQuantity,
              request.authUser!.id,
            ],
          );
          await tx.query(
            `insert into audit_logs (
              organization_id,branch_id,actor_id,action,entity_type,entity_id,after_data
             ) values ($1,$2,$3,'inventory.opening_stock','inventory_movement',$4,$5::jsonb)`,
            [
              organizationId,
              branchId,
              request.authUser!.id,
              movement.rows[0]!.id,
              JSON.stringify({
                productId: created.rows[0]!.id,
                quantity: totalOpeningQuantity,
                sealedQuantity: sealedOpeningQuantity,
                openedQuantity: openedOpeningQuantity,
              }),
            ],
          );
        }
        await tx.query(
          `insert into audit_logs (organization_id,actor_id,action,entity_type,entity_id,after_data)
           values ($1,$2,'product.created','product',$3,$4::jsonb)`,
          [organizationId, request.authUser!.id, created.rows[0]!.id, JSON.stringify(input)],
        );
        return {
          ...created.rows[0]!,
          barcodes: input.barcode ? [input.barcode] : [],
          sellingUnits,
          portioningEnabled: Boolean(portioningContainer),
        };
      });
      sendData(response, product, 201);
    },
  );
  router.get('/:id', requirePermission('products:read'), async (request, response) => {
    const id = uuidSchema.parse(request.params.id);
    const result = await database.query(
      `select p.id,p.category_id as "categoryId",p.brand_id as "brandId",
        p.name,p.sku,p.unit,p.inventory_role as "inventoryRole",
        p.track_inventory as "trackInventory",p.description,
        p.cost::text,p.selling_price::text as "sellingPrice",
        p.tax_rate::text as "taxRate",p.is_tax_inclusive as "isTaxInclusive",
        p.status,p.image_path as "imagePath",
        exists(
          select 1 from product_variants pv
          where pv.organization_id=p.organization_id and pv.product_id=p.id
            and pv.is_portioning_container
        ) as "portioningEnabled",
        (
          select pv.id from product_variants pv
          where pv.organization_id=p.organization_id and pv.product_id=p.id
            and pv.is_portioning_container limit 1
        ) as "portioningVariantId",
        (select pb.barcode from product_barcodes pb
          where pb.organization_id=p.organization_id and pb.product_id=p.id
            and pb.variant_id is null order by pb.created_at limit 1) as barcode
       from products p where p.id=$1 and p.organization_id=$2
         and p.branch_id=any($3::uuid[])`,
      [id, request.authUser!.organization.id, request.authUser!.branches.map((branch) => branch.id)],
    );
    if (!result.rows[0]) throw notFound('Product');
    sendData(response, result.rows[0]);
  });
  router.post(
    '/:id/status',
    requirePermission('products:manage'),
    validateBody(z.object({ status: z.enum(['active', 'inactive']) })),
    async (request, response) => {
      const id = uuidSchema.parse(request.params.id);
      const status = request.body.status as 'active' | 'inactive';
      const organizationId = request.authUser!.organization.id;
      const result = await database.query(
        `update products set status=$3
         where id=$1 and organization_id=$2 and branch_id=any($4::uuid[])
         returning id,name,sku,unit,status,inventory_role as "inventoryRole"`,
        [id, organizationId, status, request.authUser!.branches.map((branch) => branch.id)],
      );
      if (!result.rows[0]) throw notFound('Product');
      sendData(response, result.rows[0]);
    },
  );
  router.patch(
    '/:id',
    requirePermission('products:manage'),
    validateBody(updateProductSchema),
    async (request, response) => {
      const id = uuidSchema.parse(request.params.id);
      const organizationId = request.authUser!.organization.id;
      const existing = await database.query<any>(
        `select *,selling_price::text as "sellingPrice",tax_rate::text as "taxRate",
          inventory_role as "inventoryRole",track_inventory as "trackInventory",
          is_tax_inclusive as "isTaxInclusive",
          category_id as "categoryId",brand_id as "brandId",image_path as "imagePath"
         from products where id=$1 and organization_id=$2 and branch_id=any($3::uuid[])`,
        [id, organizationId, request.authUser!.branches.map((branch) => branch.id)],
      );
      if (!existing.rows[0]) throw notFound('Product');
      const input = { ...existing.rows[0], ...request.body };
      // Barcode omission means "leave unchanged"; null means "remove it".
      const barcodeWasProvided = Object.prototype.hasOwnProperty.call(request.body, 'barcode');
      const statusOnlyUpdate =
        Object.keys(request.body).length > 0 &&
        Object.keys(request.body).every((key) => key === 'status');
      const updated = await database.transaction(async (tx) => {
        if (statusOnlyUpdate) {
          const row = await tx.query(
            `update products set status=$3
             where id=$1 and organization_id=$2
             returning id,name,sku,unit,inventory_role as "inventoryRole",
               track_inventory as "trackInventory",
               cost::text,selling_price::text as "sellingPrice",status`,
            [id, organizationId, request.body.status],
          );
          await tx.query(
            `insert into audit_logs (
              organization_id,actor_id,action,entity_type,entity_id,before_data,after_data
             ) values ($1,$2,'product.updated','product',$3,$4::jsonb,$5::jsonb)`,
            [
              organizationId,
              request.authUser!.id,
              id,
              JSON.stringify({ status: existing.rows[0].status }),
              JSON.stringify({ status: request.body.status }),
            ],
          );
          return row.rows[0];
        }
        await validateProductMasters(tx, organizationId, existing.rows[0].branch_id, input);
        const row = await tx.query(
          `update products set category_id=$3,brand_id=$4,name=$5,sku=$6,unit=$7,
            inventory_role=$8,track_inventory=$9,description=$10,cost=$11,selling_price=$12,
            tax_rate=$13,is_tax_inclusive=$14,status=$15,image_path=$16
           where id=$1 and organization_id=$2
           returning id,name,sku,unit,inventory_role as "inventoryRole",
             track_inventory as "trackInventory",
             cost::text,selling_price::text as "sellingPrice"`,
          [
            id,
            organizationId,
            input.categoryId ?? null,
            input.brandId ?? null,
            input.name,
            input.sku,
            input.unit,
            input.inventoryRole,
            input.trackInventory,
            input.description ?? null,
            input.cost,
            input.sellingPrice,
            input.taxRate,
            input.isTaxInclusive,
            input.status,
            input.imagePath ?? null,
          ],
        );
        if (barcodeWasProvided) {
          await tx.query(
            `delete from product_barcodes
             where organization_id=$1 and product_id=$2 and variant_id is null`,
            [organizationId, id],
          );
          if (input.barcode) {
            await tx.query(
          `insert into product_barcodes (organization_id,branch_id,product_id,barcode)
               values ($1,$2,$3,$4)`,
              [organizationId, existing.rows[0].branch_id, id, input.barcode],
            );
          }
        }
        await tx.query(
          `insert into audit_logs (
            organization_id,actor_id,action,entity_type,entity_id,before_data,after_data
           ) values ($1,$2,'product.updated','product',$3,$4::jsonb,$5::jsonb)`,
          [
            organizationId,
            request.authUser!.id,
            id,
            JSON.stringify(existing.rows[0]),
            JSON.stringify(input),
          ],
        );
        return row.rows[0];
      });
      sendData(response, updated);
    },
  );
  router.get('/:id/variants', requirePermission('products:read'), async (request, response) => {
    const result = await database.query(
      `select v.id,v.name,v.sku,v.unit,pu.kind as "unitKind",
        pu.default_step::float8 as "defaultStep",v.units_per_base::float8 as "unitsPerBase",
        v.cost::text,v.selling_price::text as "sellingPrice",v.is_active as "isActive",
        v.is_portioning_container as "isPortioningContainer",
        coalesce((select jsonb_agg(pb.barcode) from product_barcodes pb where pb.variant_id=v.id),'[]') as barcodes
       from product_variants v
       join product_units pu on pu.organization_id=v.organization_id and pu.code=v.unit
       join products parent on parent.id=v.product_id and parent.organization_id=v.organization_id
       where v.product_id=$1 and v.organization_id=$2
         and parent.branch_id=any($3::uuid[]) order by v.name`,
      [
        uuidSchema.parse(request.params.id),
        request.authUser!.organization.id,
        request.authUser!.branches.map((branch) => branch.id),
      ],
    );
    sendData(response, result.rows);
  });

  // GET /products/:id/recipe -> Fetch product recipe items
  router.get('/:id/recipe', requirePermission('products:read'), async (request, response) => {
    const parentProductId = uuidSchema.parse(request.params.id);
    const organizationId = request.authUser!.organization.id;

    const result = await database.query(
      `select pr.id, pr.parent_product_id as "parentProductId",
         pr.ingredient_product_id as "ingredientProductId",
         pr.ingredient_variant_id as "ingredientVariantId",
         pr.quantity_required::float8 as "quantityRequired",
         pr.unit,
         p.unit as "baseUnit",
         p.name as "ingredientName", p.sku as "ingredientSku", p.cost::text as "ingredientCost"
       from product_recipes pr
       join products p on p.id = pr.ingredient_product_id and p.organization_id = pr.organization_id
       join products parent on parent.id=pr.parent_product_id
       where pr.parent_product_id = $1 and pr.organization_id = $2
         and parent.branch_id=any($3::uuid[])
       order by p.name`,
      [parentProductId, organizationId, request.authUser!.branches.map((branch) => branch.id)],
    );

    sendData(response, result.rows);
  });

  // PUT /products/:id/recipe -> Save/Update product recipe items
  router.put(
    '/:id/recipe',
    requirePermission('products:manage'),
    validateBody(saveRecipeSchema),
    async (request, response) => {
      if (!request.authUser!.modules.includes('recipes')) {
        throw forbidden(
          'MODULE_DISABLED',
          'The Recipes module is required to save recipe templates.',
        );
      }
      const parentProductId = uuidSchema.parse(request.params.id);
      const organizationId = request.authUser!.organization.id;
      const input = request.body;

      await database.transaction(async (tx) => {
        const parent = await tx.query<{ branchId: string }>(
          `select branch_id as "branchId" from products
           where id=$1 and organization_id=$2 and branch_id=any($3::uuid[])`,
          [
            parentProductId,
            organizationId,
            request.authUser!.branches.map((branch) => branch.id),
          ],
        );
        if (!parent.rows[0]) throw notFound('Product');
        const parentBranchId = parent.rows[0].branchId;
        // Delete existing recipe items
        await tx.query(
          `delete from product_recipes where parent_product_id = $1 and organization_id = $2`,
          [parentProductId, organizationId],
        );

        // Insert new recipe items
        for (const item of input.items) {
          const ingredient = await tx.query<{
            unit: string;
            inventoryRole: string;
            trackInventory: boolean;
          }>(
            `select unit,inventory_role as "inventoryRole",track_inventory as "trackInventory"
             from products where id=$1 and organization_id=$2 and branch_id=$3`,
            [item.ingredientProductId, organizationId, parentBranchId],
          );
          const ingredientProduct = ingredient.rows[0];
          if (!ingredientProduct)
            throw badRequest('INVALID_INGREDIENT', 'Ingredient was not found');
          if (!ingredientProduct.trackInventory) {
            throw badRequest(
              'PRODUCT_NOT_AN_INGREDIENT',
              'Only inventory-tracked products can be used in a BOM',
            );
          }
          const baseFamily = recipeUnitFamily(ingredientProduct.unit);
          const recipeFamily = recipeUnitFamily(item.unit);
          const discreteUnitsMatch =
            baseFamily !== 'piece' ||
            normalizeRecipeUnit(ingredientProduct.unit) === normalizeRecipeUnit(item.unit);
          if (!baseFamily || baseFamily !== recipeFamily || !discreteUnitsMatch) {
            throw badRequest(
              'INCOMPATIBLE_RECIPE_UNIT',
              `Use a compatible measured unit for this ingredient. ${ingredientProduct.unit} inventory cannot be consumed as ${item.unit}.`,
            );
          }
          await tx.query(
            `insert into product_recipes (
               organization_id, parent_product_id, ingredient_product_id, ingredient_variant_id,
               quantity_required, unit
             ) values ($1, $2, $3, $4, $5, $6)`,
            [
              organizationId,
              parentProductId,
              item.ingredientProductId,
              item.ingredientVariantId ?? null,
              item.quantityRequired,
              item.unit,
            ],
          );
        }

        // Automatically calculate and update product cost based on dynamic BOM ingredients
        const costRes = await tx.query<{ total_cost: string }>(
          `select round(coalesce(sum(
             p.cost * (
               case
                 when lower(p.unit) in ('kg','kilogram','kilograms') and lower(pr.unit) in ('g','gram','grams') then pr.quantity_required / 1000.0
                 when lower(p.unit) in ('l','liter','liters') and lower(pr.unit) in ('ml','milliliter','milliliters') then pr.quantity_required / 1000.0
                 when lower(p.unit) in ('g','gram','grams') and lower(pr.unit) in ('kg','kilogram','kilograms') then pr.quantity_required * 1000.0
                 when lower(p.unit) in ('ml','milliliter','milliliters') and lower(pr.unit) in ('l','liter','liters') then pr.quantity_required * 1000.0
                 else pr.quantity_required
               end
             )
           ), 0), 2)::text as total_cost
           from product_recipes pr
           join products p on p.id = pr.ingredient_product_id and p.organization_id = pr.organization_id
           where pr.parent_product_id = $1 and pr.organization_id = $2`,
          [parentProductId, organizationId],
        );
        const computedBomCost = costRes.rows[0]?.total_cost || '0.00';
        const appliedProductCost = input.costOverride ?? computedBomCost;
        if (input.items.length > 0) {
          await tx.query(
            `update products set cost = $3, updated_at = now()
             where id = $1 and organization_id = $2`,
            [parentProductId, organizationId, appliedProductCost],
          );
        }

        await tx.query(
          `insert into audit_logs (
             organization_id, actor_id, action, entity_type, entity_id, after_data
           ) values ($1, $2, 'product.recipe_updated', 'product', $3, $4::jsonb)`,
          [
            organizationId,
            request.authUser!.id,
            parentProductId,
            JSON.stringify({
              itemCount: input.items.length,
              computedBomCost,
              appliedProductCost,
              costOverridden: input.costOverride !== undefined,
            }),
          ],
        );
      });

      sendData(response, { success: true, count: input.items.length });
    },
  );
  router.post(
    '/:id/variants',
    requirePermission('products:manage'),
    validateBody(productVariantSchema),
    async (request, response) => {
      const organizationId = request.authUser!.organization.id;
      const productId = uuidSchema.parse(request.params.id);
      const input = request.body;
      const created = await database.transaction(async (tx) => {
        const parentRes = await tx.query<{ unit: string; branchId: string }>(
          `select unit,branch_id as "branchId" from products
           where id=$1 and organization_id=$2 and branch_id=any($3::uuid[])`,
          [productId, organizationId, request.authUser!.branches.map((branch) => branch.id)],
        );
        const parentUnit = parentRes.rows[0]?.unit;
        if (!parentUnit) throw notFound('Product');

        const conversionCheck = validateUnitConversion(parentUnit, input.unit, input.unitsPerBase);
        if (!conversionCheck.valid) {
          throw badRequest('INVALID_UNIT_CONVERSION', conversionCheck.reason || 'Invalid unit conversion');
        }

        await validateProductMasters(tx, organizationId, parentRes.rows[0]!.branchId, { unit: input.unit });
        if (input.isPortioningContainer && input.unitsPerBase <= 1) {
          throw badRequest(
            'INVALID_PORTIONING_CONTAINER',
            'A whole container must contain more than one base inventory unit',
          );
        }
        if (input.isPortioningContainer) {
          const designated = await tx.query(
            `select 1 from product_variants
             where organization_id=$1 and product_id=$2 and is_portioning_container limit 1`,
            [organizationId, productId],
          );
          if (designated.rowCount) {
            throw conflict(
              'PORTIONING_CONTAINER_EXISTS',
              'This product already has a designated whole container',
            );
          }
        }
        const result = await tx.query<{ id: string }>(
          `insert into product_variants (
            organization_id,branch_id,product_id,name,sku,unit,units_per_base,cost,selling_price,
            is_active,is_portioning_container
           ) select $1,p.branch_id,p.id,$3,$4,$5,$6,$7,$8,$9,$10 from products p
             where p.id=$2 and p.organization_id=$1 and p.branch_id=any($11::uuid[]) returning id`,
          [
            organizationId,
            productId,
            input.name,
            input.sku,
            input.unit,
            input.unitsPerBase,
            input.cost ?? null,
            input.sellingPrice ?? null,
            input.isActive,
            input.isPortioningContainer,
            request.authUser!.branches.map((branch) => branch.id),
          ],
        );
        if (!result.rows[0]) throw notFound('Product');
        if (input.isPortioningContainer) {
          await tx.query(
            `update branch_inventory set
               sealed_quantity=floor(quantity/$3::numeric),
               opened_quantity=quantity-(floor(quantity/$3::numeric)*$3::numeric),
               updated_at=now()
             where organization_id=$1 and product_id=$2 and variant_id is null`,
            [organizationId, productId, input.unitsPerBase],
          );
        }
        if (input.barcode) {
          await tx.query(
            `insert into product_barcodes (organization_id,branch_id,product_id,variant_id,barcode)
             values ($1,$2,$3,$4,$5)`,
            [organizationId, parentRes.rows[0]!.branchId, productId, result.rows[0].id, input.barcode],
          );
        }
        await tx.query(
          `insert into audit_logs (
            organization_id,actor_id,action,entity_type,entity_id,after_data
           ) values ($1,$2,'product_variant.created','product_variant',$3,$4::jsonb)`,
          [
            organizationId,
            request.authUser!.id,
            result.rows[0].id,
            JSON.stringify({ productId, ...input }),
          ],
        );
        return { ...result.rows[0], ...input, barcodes: input.barcode ? [input.barcode] : [] };
      });
      sendData(response, created, 201);
    },
  );
  router.patch(
    '/:productId/variants/:variantId',
    requirePermission('products:manage'),
    validateBody(productVariantSchema.partial()),
    async (request, response) => {
      const organizationId = request.authUser!.organization.id;
      const productId = uuidSchema.parse(request.params.productId);
      const variantId = uuidSchema.parse(request.params.variantId);
      const updated = await database.transaction(async (tx) => {
        const existing = await tx.query<any>(
          `select v.*,v.units_per_base::float8 as "unitsPerBase",
            v.selling_price::text as "sellingPrice",v.is_active as "isActive",
            v.is_portioning_container as "isPortioningContainer",
            (select barcode from product_barcodes where variant_id=v.id limit 1) as barcode
           from product_variants v
           where v.id=$1 and v.product_id=$2 and v.organization_id=$3 for update`,
          [variantId, productId, organizationId],
        );
        if (!existing.rows[0]) throw notFound('Product variant');
        const input = { ...existing.rows[0], ...request.body };

        const parentRes = await tx.query<{ unit: string; branchId: string }>(
          `select unit,branch_id as "branchId" from products
           where id=$1 and organization_id=$2 and branch_id=any($3::uuid[])`,
          [productId, organizationId, request.authUser!.branches.map((branch) => branch.id)],
        );
        const parentUnit = parentRes.rows[0]?.unit;
        if (parentUnit) {
          const conversionCheck = validateUnitConversion(parentUnit, input.unit, input.unitsPerBase);
          if (!conversionCheck.valid) {
            throw badRequest('INVALID_UNIT_CONVERSION', conversionCheck.reason || 'Invalid unit conversion');
          }
        }
        await validateProductMasters(tx, organizationId, parentRes.rows[0]!.branchId, { unit: input.unit });
        const wasPortioningContainer = Boolean(existing.rows[0].isPortioningContainer);
        const willBePortioningContainer = Boolean(input.isPortioningContainer);
        const conversionChanged =
          wasPortioningContainer &&
          Number(input.unitsPerBase) !== Number(existing.rows[0].unitsPerBase);
        if (input.isPortioningContainer && input.unitsPerBase <= 1) {
          throw badRequest(
            'INVALID_PORTIONING_CONTAINER',
            'A whole container must contain more than one base inventory unit',
          );
        }
        if (willBePortioningContainer) {
          const otherContainer = await tx.query(
            `select 1 from product_variants
             where organization_id=$1 and product_id=$2 and id<>$3
               and is_portioning_container limit 1`,
            [organizationId, productId, variantId],
          );
          if (otherContainer.rowCount) {
            throw conflict(
              'PORTIONING_CONTAINER_EXISTS',
              'This product already has a designated whole container',
            );
          }
        }
        if (conversionChanged) {
          const pooled = await tx.query(
            `select 1 from branch_inventory
             where organization_id=$1 and product_id=$2
               and (quantity<>0 or sealed_quantity<>0 or opened_quantity<>0) limit 1`,
            [organizationId, productId],
          );
          if (pooled.rowCount) {
            throw conflict(
              'PORTIONING_POOL_IN_USE',
              'Clear sealed and opened stock before changing the container conversion',
            );
          }
        }
        const row = await tx.query(
          `update product_variants set name=$4,sku=$5,unit=$6,units_per_base=$7,
            cost=$8,selling_price=$9,is_active=$10,is_portioning_container=$11,updated_at=now()
           where id=$1 and product_id=$2 and organization_id=$3
           returning id,name,sku,unit,units_per_base::float8 as "unitsPerBase",
             cost::text,selling_price::text as "sellingPrice",is_active as "isActive",
             is_portioning_container as "isPortioningContainer"`,
          [
            variantId,
            productId,
            organizationId,
            input.name,
            input.sku,
            input.unit,
            input.unitsPerBase,
            input.cost ?? null,
            input.sellingPrice ?? null,
            input.isActive,
            input.isPortioningContainer,
          ],
        );
        if (!wasPortioningContainer && willBePortioningContainer) {
          await tx.query(
            `update branch_inventory set
               sealed_quantity=floor(quantity/$3::numeric),
               opened_quantity=quantity-(floor(quantity/$3::numeric)*$3::numeric),
               updated_at=now()
             where organization_id=$1 and product_id=$2 and variant_id is null`,
            [organizationId, productId, input.unitsPerBase],
          );
        } else if (wasPortioningContainer && !willBePortioningContainer) {
          await tx.query(
            `update branch_inventory set sealed_quantity=0,opened_quantity=0,updated_at=now()
             where organization_id=$1 and product_id=$2 and variant_id is null`,
            [organizationId, productId],
          );
        }
        if (request.body.barcode !== undefined) {
          await tx.query(
            'delete from product_barcodes where organization_id=$1 and variant_id=$2',
            [organizationId, variantId],
          );
          if (request.body.barcode) {
            await tx.query(
              `insert into product_barcodes (organization_id,branch_id,product_id,variant_id,barcode)
               values ($1,$2,$3,$4,$5)`,
              [organizationId, parentRes.rows[0]!.branchId, productId, variantId, request.body.barcode],
            );
          }
        }
        await tx.query(
          `insert into audit_logs (
            organization_id,actor_id,action,entity_type,entity_id,before_data,after_data
           ) values ($1,$2,'product_variant.updated','product_variant',$3,$4::jsonb,$5::jsonb)`,
          [
            organizationId,
            request.authUser!.id,
            variantId,
            JSON.stringify(existing.rows[0]),
            JSON.stringify(input),
          ],
        );
        return {
          ...row.rows[0],
          barcodes: input.barcode ? [input.barcode] : [],
        };
      });
      sendData(response, updated);
    },
  );
  return router;
}

export function categoriesRouter(database: Database): Router {
  const router = Router();
  router.use(requireModule('products'));
  router.get(
    '/',
    requirePermission('products:read'),
    validateQuery(z.object({ branchId: uuidSchema })),
    requireBranchAccess('query'),
    async (request, response) => {
    const { branchId } = request.query as { branchId: string };
    const result = await database.query(
      `select id,name,description,is_active as "isActive" from categories
       where organization_id=$1 and branch_id=$2 order by name`,
      [request.authUser!.organization.id, branchId],
    );
    sendData(response, result.rows);
    },
  );
  router.post(
    '/',
    requirePermission('products:manage'),
    validateBody(categorySchema),
    requireBranchAccess('body'),
    async (request, response) => {
      const input = request.body;
      const result = await database.query(
        `insert into categories (organization_id,branch_id,name,description,is_active)
         values ($1,$2,$3,$4,$5) returning id,name,description,is_active as "isActive"`,
        [request.authUser!.organization.id, input.branchId, input.name, input.description ?? null, input.isActive],
      );
      sendData(response, result.rows[0], 201);
    },
  );
  router.patch(
    '/:id',
    requirePermission('products:manage'),
    validateBody(categorySchema.partial()),
    async (request, response) => {
      const id = uuidSchema.parse(request.params.id);
      const organizationId = request.authUser!.organization.id;
      const existing = await database.query<any>(
        'select * from categories where id=$1 and organization_id=$2 and branch_id=any($3::uuid[])',
        [id, organizationId, request.authUser!.branches.map((branch) => branch.id)],
      );
      if (!existing.rows[0]) throw notFound('Category');
      const input = { ...existing.rows[0], ...request.body };
      const result = await database.query(
        `update categories set name=$3,description=$4,is_active=$5,updated_at=now()
         where id=$1 and organization_id=$2
         returning id,name,description,is_active as "isActive"`,
        [
          id,
          organizationId,
          input.name,
          input.description ?? null,
          input.isActive ?? input.is_active,
        ],
      );
      sendData(response, result.rows[0]);
    },
  );
  return router;
}

export function brandsRouter(database: Database): Router {
  const router = Router();
  router.use(requireModule('products'));
  router.get(
    '/',
    requirePermission('products:read'),
    validateQuery(z.object({ branchId: uuidSchema })),
    requireBranchAccess('query'),
    async (request, response) => {
    const { branchId } = request.query as { branchId: string };
    const result = await database.query(
      `select id,name,description,is_active as "isActive" from brands
       where organization_id=$1 and branch_id=$2 order by name`,
      [request.authUser!.organization.id, branchId],
    );
    sendData(response, result.rows);
    },
  );
  router.post(
    '/',
    requirePermission('products:manage'),
    validateBody(brandSchema),
    requireBranchAccess('body'),
    async (request, response) => {
      const input = request.body;
      const result = await database.query(
        `insert into brands (organization_id,branch_id,name,description,is_active)
         values ($1,$2,$3,$4,$5)
         returning id,name,description,is_active as "isActive"`,
        [request.authUser!.organization.id, input.branchId, input.name, input.description ?? null, input.isActive],
      );
      sendData(response, result.rows[0], 201);
    },
  );
  router.patch(
    '/:id',
    requirePermission('products:manage'),
    validateBody(brandSchema.partial()),
    async (request, response) => {
      const id = uuidSchema.parse(request.params.id);
      const organizationId = request.authUser!.organization.id;
      const existing = await database.query<any>(
        'select * from brands where id=$1 and organization_id=$2 and branch_id=any($3::uuid[])',
        [id, organizationId, request.authUser!.branches.map((branch) => branch.id)],
      );
      if (!existing.rows[0]) throw notFound('Brand');
      const input = { ...existing.rows[0], ...request.body };
      const result = await database.query(
        `update brands set name=$3,description=$4,is_active=$5,updated_at=now()
         where id=$1 and organization_id=$2
         returning id,name,description,is_active as "isActive"`,
        [
          id,
          organizationId,
          input.name,
          input.description ?? null,
          input.isActive ?? input.is_active,
        ],
      );
      sendData(response, result.rows[0]);
    },
  );
  return router;
}

export function productUnitsRouter(database: Database): Router {
  const router = Router();
  router.use(requireModule('products'));
  router.get('/', requirePermission('products:read'), async (request, response) => {
    const result = await database.query(
      `select id,code,name,kind,default_step::float8 as "defaultStep",
        is_system as "isSystem",is_active as "isActive"
       from product_units where organization_id=$1 order by is_system desc,name`,
      [request.authUser!.organization.id],
    );
    sendData(response, result.rows);
  });
  router.post(
    '/',
    requirePermission('products:manage'),
    validateBody(productUnitSchema),
    async (request, response) => {
      const input = request.body;
      const result = await database.query(
        `insert into product_units (
          organization_id,code,name,kind,default_step,is_active
         ) values ($1,$2,$3,$4,$5,$6)
         returning id,code,name,kind,default_step::float8 as "defaultStep",
           is_system as "isSystem",is_active as "isActive"`,
        [
          request.authUser!.organization.id,
          input.code,
          input.name,
          input.kind,
          input.defaultStep,
          input.isActive,
        ],
      );
      sendData(response, result.rows[0], 201);
    },
  );
  router.patch(
    '/:id',
    requirePermission('products:manage'),
    validateBody(productUnitSchema.partial()),
    async (request, response) => {
      const id = uuidSchema.parse(request.params.id);
      const organizationId = request.authUser!.organization.id;
      const existing = await database.query<any>(
        'select * from product_units where id=$1 and organization_id=$2',
        [id, organizationId],
      );
      if (!existing.rows[0]) throw notFound('Product unit');
      const input = {
        code: existing.rows[0].code,
        name: existing.rows[0].name,
        kind: existing.rows[0].kind,
        defaultStep: Number(existing.rows[0].default_step),
        isActive: existing.rows[0].is_active,
        ...request.body,
      };
      if (existing.rows[0].is_system && input.code !== existing.rows[0].code) {
        throw conflict('SYSTEM_UNIT_CODE', 'The code of a built-in unit cannot be changed');
      }
      if (input.code !== existing.rows[0].code) {
        const usage = await database.query(
          `select 1 from products where organization_id=$1 and unit=$2
           union all
           select 1 from product_variants where organization_id=$1 and unit=$2 limit 1`,
          [organizationId, existing.rows[0].code],
        );
        if (usage.rowCount) {
          throw conflict('UNIT_IN_USE', 'A unit code cannot be changed while products use it');
        }
      }
      const result = await database.query(
        `update product_units set code=$3,name=$4,kind=$5,default_step=$6,is_active=$7,
          updated_at=now()
         where id=$1 and organization_id=$2
         returning id,code,name,kind,default_step::float8 as "defaultStep",
           is_system as "isSystem",is_active as "isActive"`,
        [id, organizationId, input.code, input.name, input.kind, input.defaultStep, input.isActive],
      );
      sendData(response, result.rows[0]);
    },
  );
  return router;
}
