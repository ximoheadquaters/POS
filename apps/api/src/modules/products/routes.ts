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
} from '@ximo/shared';
import type { Database, Queryable } from '../../database/types.js';
import { requireBranchAccess, requireModule, requirePermission } from '../../middleware/auth.js';
import { validateBody, validateQuery } from '../../middleware/validation.js';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors.js';
import { sendData, sendPage } from '../../shared/http.js';

async function validateProductMasters(
  database: Queryable,
  organizationId: string,
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
        select 1 from categories where organization_id=$1 and id=$3 and is_active
      )) as "categoryValid",
      ($4::uuid is null or exists(
        select 1 from brands where organization_id=$1 and id=$4 and is_active
      )) as "brandValid"`,
    [organizationId, input.unit, input.categoryId ?? null, input.brandId ?? null],
  );
  const state = result.rows[0];
  if (!state?.unitValid) throw badRequest('INVALID_PRODUCT_UNIT', 'Select an active product unit');
  if (!state.categoryValid) throw badRequest('INVALID_CATEGORY', 'Select an active category');
  if (!state.brandValid) throw badRequest('INVALID_BRAND', 'Select an active brand');
}

export function productsRouter(database: Database): Router {
  const router = Router();
  router.use(requireModule('products'));
  router.get(
    '/lookup',
    requirePermission('products:read'),
    validateQuery(productLookupSchema.extend({ branchId: uuidSchema.optional() })),
    async (request, response) => {
      const { code, branchId } = request.query as unknown as { code: string; branchId?: string };
      if (
        branchId &&
        !request.authUser!.branches.some((assignedBranch) => assignedBranch.id === branchId)
      ) {
        throw forbidden('BRANCH_ACCESS_DENIED', 'You do not have access to this branch');
      }
      const result = await database.query(
        `select p.id,p.name,p.sku,p.unit,pu.kind as "unitKind",
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
         where p.organization_id=$1 and ($3::uuid is null or p.status='active') and (
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
        [request.authUser!.organization.id, code, branchId ?? null],
      );
      sendData(response, result.rows[0] ?? null);
    },
  );
  router.get(
    '/',
    requirePermission('products:read'),
    validateQuery(
      paginationSchema.extend({
        branchId: uuidSchema.optional(),
        includeIncoming: z
          .enum(['true', 'false'])
          .optional()
          .transform((value) => value === 'true'),
        includeInactive: z
          .enum(['true', 'false'])
          .optional()
          .transform((value) => value === 'true'),
      }),
    ),
    async (request, response) => {
      const { page, pageSize, search, branchId, includeIncoming, includeInactive } =
        request.query as unknown as {
          page: number;
          pageSize: number;
          search?: string;
          branchId?: string;
          includeIncoming: boolean;
          includeInactive: boolean;
        };
      if (
        branchId &&
        !request.authUser!.branches.some((assignedBranch) => assignedBranch.id === branchId)
      ) {
        throw forbidden('BRANCH_ACCESS_DENIED', 'You do not have access to this branch');
      }
      const offset = (page - 1) * pageSize;
      const organizationId = request.authUser!.organization.id;
      const result = await database.query(
        `select p.id,p.name,p.sku,p.unit,pu.kind as "unitKind",
          pu.default_step::float8 as "defaultStep",p.category_id as "categoryId",
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
         join product_units pu on pu.organization_id=p.organization_id and pu.code=p.unit
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
          where p.organization_id=$1 and (
            ($5::uuid is null and (
              p.status='active'
              or ($6::boolean and p.status='pending_receipt')
              or ($7::boolean and p.status='inactive')
            ))
            or ($5::uuid is not null and (
              p.status='active'
              or ($6::boolean and p.status='pending_receipt')
              or ($7::boolean and p.status='inactive')
            ))
          ) and ($2::text is null or
           p.name ilike '%'||$2||'%' or p.sku ilike '%'||$2||'%' or exists (
             select 1 from product_barcodes pb where pb.product_id=p.id and pb.barcode=$2
           ))
         order by p.name limit $3 offset $4`,
        [
          organizationId,
          search ?? null,
          pageSize,
          offset,
          branchId ?? null,
          includeIncoming,
          includeInactive,
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
  router.post(
    '/',
    requirePermission('products:manage'),
    requireBranchAccess('body'),
    validateBody(createProductSchema),
    async (request, response) => {
      const product = await database.transaction(async (tx) => {
        const { branchId, openingQuantity, sellingUnits, ...input } = request.body;
        const organizationId = request.authUser!.organization.id;
        await validateProductMasters(tx, organizationId, input);
        const created = await tx.query<{
          id: string;
          name: string;
          sku: string;
          unit: string;
          trackInventory: boolean;
          sellingPrice: string;
          taxRate: string;
          isTaxInclusive: boolean;
          status: string;
        }>(
          `insert into products (
            organization_id,category_id,brand_id,name,sku,unit,track_inventory,description,cost,
            selling_price,tax_rate,is_tax_inclusive,status,image_path
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           returning id,name,sku,unit,track_inventory as "trackInventory",
             selling_price::text as "sellingPrice",tax_rate::text as "taxRate",
             is_tax_inclusive as "isTaxInclusive",status`,
          [
            organizationId,
            input.categoryId ?? null,
            input.brandId ?? null,
            input.name,
            input.sku,
            input.unit,
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
            `insert into product_barcodes (organization_id,product_id,barcode) values ($1,$2,$3)`,
            [organizationId, created.rows[0]!.id, input.barcode],
          );
        }
        for (const sellingUnit of sellingUnits) {
          const variant = await tx.query<{ id: string }>(
            `insert into product_variants (
              organization_id,product_id,name,sku,unit,units_per_base,cost,selling_price,is_active
             ) values ($1,$2,$3,$4,$5,$6,$7,$8,true) returning id`,
            [
              organizationId,
              created.rows[0]!.id,
              sellingUnit.name,
              sellingUnit.sku,
              sellingUnit.unit,
              sellingUnit.unitsPerBase,
              sellingUnit.cost ?? null,
              sellingUnit.sellingPrice,
            ],
          );
          if (sellingUnit.barcode) {
            await tx.query(
              `insert into product_barcodes (
                organization_id,product_id,variant_id,barcode
               ) values ($1,$2,$3,$4)`,
              [organizationId, created.rows[0]!.id, variant.rows[0]!.id, sellingUnit.barcode],
            );
          }
        }
        await tx.query(
          `insert into branch_inventory (
            organization_id,branch_id,product_id,variant_id,quantity,inventory_value,average_cost
           )
           select $1,b.id,$2,null,
             case when b.id=$3 then $4 else 0 end,
             case when b.id=$3 then round($4::numeric*$5::numeric,4) else 0 end,
             round($5::numeric,4)
           from branches b
           where b.organization_id=$1 and b.is_active`,
          [
            organizationId,
            created.rows[0]!.id,
            branchId,
            input.trackInventory ? openingQuantity : 0,
            input.cost,
          ],
        );
        if (input.trackInventory && openingQuantity > 0) {
          const movement = await tx.query<{ id: string }>(
            `insert into inventory_movements (
              organization_id,branch_id,product_id,variant_id,movement_type,quantity_delta,
              quantity_after,reason,reference_type,created_by
             ) values ($1,$2,$3,null,'adjustment',$4,$4,'Opening stock','product_setup',$5)
             returning id`,
            [organizationId, branchId, created.rows[0]!.id, openingQuantity, request.authUser!.id],
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
                quantity: openingQuantity,
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
        };
      });
      sendData(response, product, 201);
    },
  );
  router.get('/:id', requirePermission('products:read'), async (request, response) => {
    const id = uuidSchema.parse(request.params.id);
    const result = await database.query(
      `select p.id,p.category_id as "categoryId",p.brand_id as "brandId",
        p.name,p.sku,p.unit,p.track_inventory as "trackInventory",p.description,
        p.cost::text,p.selling_price::text as "sellingPrice",
        p.tax_rate::text as "taxRate",p.is_tax_inclusive as "isTaxInclusive",
        p.status,p.image_path as "imagePath",
        (select pb.barcode from product_barcodes pb
          where pb.organization_id=p.organization_id and pb.product_id=p.id
            and pb.variant_id is null order by pb.created_at limit 1) as barcode
       from products p where p.id=$1 and p.organization_id=$2`,
      [id, request.authUser!.organization.id],
    );
    if (!result.rows[0]) throw notFound('Product');
    sendData(response, result.rows[0]);
  });
  router.patch(
    '/:id',
    requirePermission('products:manage'),
    validateBody(updateProductSchema),
    async (request, response) => {
      const id = uuidSchema.parse(request.params.id);
      const organizationId = request.authUser!.organization.id;
      const existing = await database.query<any>(
        `select *,selling_price::text as "sellingPrice",tax_rate::text as "taxRate",
          track_inventory as "trackInventory",is_tax_inclusive as "isTaxInclusive",
          category_id as "categoryId",brand_id as "brandId",image_path as "imagePath"
         from products where id=$1 and organization_id=$2`,
        [id, organizationId],
      );
      if (!existing.rows[0]) throw notFound('Product');
      const input = { ...existing.rows[0], ...request.body };
      // Barcode omission means "leave unchanged"; null means "remove it".
      const barcodeWasProvided = Object.prototype.hasOwnProperty.call(request.body, 'barcode');
      const updated = await database.transaction(async (tx) => {
        await validateProductMasters(tx, organizationId, input);
        const row = await tx.query(
          `update products set category_id=$3,brand_id=$4,name=$5,sku=$6,unit=$7,track_inventory=$8,
            description=$9,cost=$10,selling_price=$11,tax_rate=$12,is_tax_inclusive=$13,
            status=$14,image_path=$15
           where id=$1 and organization_id=$2
           returning id,name,sku,unit,track_inventory as "trackInventory",
             cost::text,selling_price::text as "sellingPrice"`,
          [
            id,
            organizationId,
            input.categoryId ?? null,
            input.brandId ?? null,
            input.name,
            input.sku,
            input.unit,
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
              `insert into product_barcodes (organization_id,product_id,barcode)
               values ($1,$2,$3)`,
              [organizationId, id, input.barcode],
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
        coalesce((select jsonb_agg(pb.barcode) from product_barcodes pb where pb.variant_id=v.id),'[]') as barcodes
       from product_variants v
       join product_units pu on pu.organization_id=v.organization_id and pu.code=v.unit
       where v.product_id=$1 and v.organization_id=$2 order by v.name`,
      [uuidSchema.parse(request.params.id), request.authUser!.organization.id],
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
         p.name as "ingredientName", p.sku as "ingredientSku", p.cost::text as "ingredientCost"
       from product_recipes pr
       join products p on p.id = pr.ingredient_product_id and p.organization_id = pr.organization_id
       where pr.parent_product_id = $1 and pr.organization_id = $2
       order by p.name`,
      [parentProductId, organizationId],
    );

    sendData(response, result.rows);
  });

  // PUT /products/:id/recipe -> Save/Update product recipe items
  router.put(
    '/:id/recipe',
    requirePermission('products:manage'),
    validateBody(saveRecipeSchema),
    async (request, response) => {
      const parentProductId = uuidSchema.parse(request.params.id);
      const organizationId = request.authUser!.organization.id;
      const input = request.body;

      await database.transaction(async (tx) => {
        // Delete existing recipe items
        await tx.query(
          `delete from product_recipes where parent_product_id = $1 and organization_id = $2`,
          [parentProductId, organizationId],
        );

        // Insert new recipe items
        for (const item of input.items) {
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
          `select round(coalesce(sum(p.cost * pr.quantity_required), 0), 2)::text as total_cost
           from product_recipes pr
           join products p on p.id = pr.ingredient_product_id and p.organization_id = pr.organization_id
           where pr.parent_product_id = $1 and pr.organization_id = $2`,
          [parentProductId, organizationId],
        );
        const computedBomCost = costRes.rows[0]?.total_cost || '0.00';
        if (parseFloat(computedBomCost) > 0) {
          await tx.query(
            `update products set cost = $3, updated_at = now()
             where id = $1 and organization_id = $2`,
            [parentProductId, organizationId, computedBomCost],
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
            JSON.stringify({ itemCount: input.items.length, computedBomCost }),
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
        await validateProductMasters(tx, organizationId, { unit: input.unit });
        const result = await tx.query<{ id: string }>(
          `insert into product_variants (
            organization_id,product_id,name,sku,unit,units_per_base,cost,selling_price,is_active
           ) select $1,p.id,$3,$4,$5,$6,$7,$8,$9 from products p
             where p.id=$2 and p.organization_id=$1 returning id`,
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
          ],
        );
        if (!result.rows[0]) throw notFound('Product');
        if (input.barcode) {
          await tx.query(
            `insert into product_barcodes (organization_id,product_id,variant_id,barcode)
             values ($1,$2,$3,$4)`,
            [organizationId, productId, result.rows[0].id, input.barcode],
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
            (select barcode from product_barcodes where variant_id=v.id limit 1) as barcode
           from product_variants v
           where v.id=$1 and v.product_id=$2 and v.organization_id=$3 for update`,
          [variantId, productId, organizationId],
        );
        if (!existing.rows[0]) throw notFound('Product variant');
        const input = { ...existing.rows[0], ...request.body };
        await validateProductMasters(tx, organizationId, { unit: input.unit });
        const row = await tx.query(
          `update product_variants set name=$4,sku=$5,unit=$6,units_per_base=$7,
            cost=$8,selling_price=$9,is_active=$10,updated_at=now()
           where id=$1 and product_id=$2 and organization_id=$3
           returning id,name,sku,unit,units_per_base::float8 as "unitsPerBase",
             cost::text,selling_price::text as "sellingPrice",is_active as "isActive"`,
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
          ],
        );
        if (request.body.barcode !== undefined) {
          await tx.query(
            'delete from product_barcodes where organization_id=$1 and variant_id=$2',
            [organizationId, variantId],
          );
          if (request.body.barcode) {
            await tx.query(
              `insert into product_barcodes (organization_id,product_id,variant_id,barcode)
               values ($1,$2,$3,$4)`,
              [organizationId, productId, variantId, request.body.barcode],
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
  router.get('/', requirePermission('products:read'), async (request, response) => {
    const result = await database.query(
      `select id,name,description,is_active as "isActive" from categories
       where organization_id=$1 order by name`,
      [request.authUser!.organization.id],
    );
    sendData(response, result.rows);
  });
  router.post(
    '/',
    requirePermission('products:manage'),
    validateBody(categorySchema),
    async (request, response) => {
      const input = request.body;
      const result = await database.query(
        `insert into categories (organization_id,name,description,is_active)
         values ($1,$2,$3,$4) returning id,name,description,is_active as "isActive"`,
        [request.authUser!.organization.id, input.name, input.description ?? null, input.isActive],
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
        'select * from categories where id=$1 and organization_id=$2',
        [id, organizationId],
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
  router.get('/', requirePermission('products:read'), async (request, response) => {
    const result = await database.query(
      `select id,name,description,is_active as "isActive" from brands
       where organization_id=$1 order by name`,
      [request.authUser!.organization.id],
    );
    sendData(response, result.rows);
  });
  router.post(
    '/',
    requirePermission('products:manage'),
    validateBody(brandSchema),
    async (request, response) => {
      const input = request.body;
      const result = await database.query(
        `insert into brands (organization_id,name,description,is_active)
         values ($1,$2,$3,$4)
         returning id,name,description,is_active as "isActive"`,
        [request.authUser!.organization.id, input.name, input.description ?? null, input.isActive],
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
        'select * from brands where id=$1 and organization_id=$2',
        [id, organizationId],
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
