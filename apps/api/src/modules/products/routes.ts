import { Router } from 'express';
import {
  categorySchema,
  createProductSchema,
  paginationSchema,
  productLookupSchema,
  productSchema,
  productVariantSchema,
  uuidSchema,
} from '@ximo/shared';
import type { Database } from '../../database/types.js';
import { requireBranchAccess, requireModule, requirePermission } from '../../middleware/auth.js';
import { validateBody, validateQuery } from '../../middleware/validation.js';
import { notFound } from '../../shared/errors.js';
import { sendData, sendPage } from '../../shared/http.js';

export function productsRouter(database: Database): Router {
  const router = Router();
  router.use(requireModule('products'));
  router.get(
    '/lookup',
    requirePermission('products:read'),
    validateQuery(productLookupSchema),
    async (request, response) => {
      const { code } = request.query as unknown as { code: string };
      const result = await database.query(
        `select p.id,p.name,p.sku,p.selling_price::text as "sellingPrice",
          p.tax_rate::text as "taxRate",p.is_tax_inclusive as "isTaxInclusive",p.status,
          coalesce((
            select jsonb_agg(pb.barcode)
            from product_barcodes pb
            where pb.product_id=p.id
          ),'[]') as barcodes
         from products p
         where p.organization_id=$1 and (
           p.sku=$2 or exists (
             select 1 from product_barcodes pb
             where pb.product_id=p.id and pb.organization_id=$1 and pb.barcode=$2
           )
         )
         order by case when p.sku=$2 then 0 else 1 end
         limit 1`,
        [request.authUser!.organization.id, code],
      );
      sendData(response, result.rows[0] ?? null);
    },
  );
  router.get(
    '/',
    requirePermission('products:read'),
    validateQuery(paginationSchema),
    async (request, response) => {
      const { page, pageSize, search } = request.query as unknown as {
        page: number;
        pageSize: number;
        search?: string;
      };
      const offset = (page - 1) * pageSize;
      const organizationId = request.authUser!.organization.id;
      const result = await database.query(
        `select p.id,p.name,p.sku,p.cost::text,p.selling_price::text as "sellingPrice",
          p.tax_rate::text as "taxRate",p.is_tax_inclusive as "isTaxInclusive",
          p.status,p.image_path as "imagePath",c.name as "categoryName",
          coalesce((select jsonb_agg(pb.barcode) from product_barcodes pb where pb.product_id=p.id),'[]') as barcodes,
          count(*) over()::int as total
         from products p left join categories c on c.id=p.category_id
         where p.organization_id=$1 and ($2::text is null or
           p.name ilike '%'||$2||'%' or p.sku ilike '%'||$2||'%' or exists (
             select 1 from product_barcodes pb where pb.product_id=p.id and pb.barcode=$2
           ))
         order by p.name limit $3 offset $4`,
        [organizationId, search ?? null, pageSize, offset],
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
        const { branchId, openingQuantity, ...input } = request.body;
        const organizationId = request.authUser!.organization.id;
        const created = await tx.query<{
          id: string;
          name: string;
          sku: string;
          sellingPrice: string;
          taxRate: string;
          isTaxInclusive: boolean;
          status: string;
        }>(
          `insert into products (
            organization_id,category_id,name,sku,description,cost,selling_price,tax_rate,
            is_tax_inclusive,status,image_path
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           returning id,name,sku,selling_price::text as "sellingPrice",
             tax_rate::text as "taxRate",is_tax_inclusive as "isTaxInclusive",status`,
          [
            organizationId,
            input.categoryId ?? null,
            input.name,
            input.sku,
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
        await tx.query(
          `insert into branch_inventory (
            organization_id,branch_id,product_id,variant_id,quantity
           )
           select $1,b.id,$2,null,case when b.id=$3 then $4 else 0 end
           from branches b
           where b.organization_id=$1 and b.is_active`,
          [organizationId, created.rows[0]!.id, branchId, openingQuantity],
        );
        if (openingQuantity > 0) {
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
        };
      });
      sendData(response, product, 201);
    },
  );
  router.patch(
    '/:id',
    requirePermission('products:manage'),
    validateBody(productSchema.partial()),
    async (request, response) => {
      const id = uuidSchema.parse(request.params.id);
      const organizationId = request.authUser!.organization.id;
      const existing = await database.query<any>(
        `select *,selling_price::text as "sellingPrice",tax_rate::text as "taxRate",
          is_tax_inclusive as "isTaxInclusive",category_id as "categoryId",image_path as "imagePath"
         from products where id=$1 and organization_id=$2`,
        [id, organizationId],
      );
      if (!existing.rows[0]) throw notFound('Product');
      const input = { ...existing.rows[0], ...request.body };
      const updated = await database.transaction(async (tx) => {
        const row = await tx.query(
          `update products set category_id=$3,name=$4,sku=$5,description=$6,cost=$7,
            selling_price=$8,tax_rate=$9,is_tax_inclusive=$10,status=$11,image_path=$12
           where id=$1 and organization_id=$2 returning id,name,sku,cost::text,selling_price::text as "sellingPrice"`,
          [
            id,
            organizationId,
            input.categoryId ?? null,
            input.name,
            input.sku,
            input.description ?? null,
            input.cost,
            input.sellingPrice,
            input.taxRate,
            input.isTaxInclusive,
            input.status,
            input.imagePath ?? null,
          ],
        );
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
      `select v.id,v.name,v.sku,v.cost::text,v.selling_price::text as "sellingPrice",
        v.is_active as "isActive",
        coalesce((select jsonb_agg(pb.barcode) from product_barcodes pb where pb.variant_id=v.id),'[]') as barcodes
       from product_variants v where v.product_id=$1 and v.organization_id=$2 order by v.name`,
      [uuidSchema.parse(request.params.id), request.authUser!.organization.id],
    );
    sendData(response, result.rows);
  });
  router.post(
    '/:id/variants',
    requirePermission('products:manage'),
    validateBody(productVariantSchema),
    async (request, response) => {
      const organizationId = request.authUser!.organization.id;
      const productId = uuidSchema.parse(request.params.id);
      const input = request.body;
      const created = await database.transaction(async (tx) => {
        const result = await tx.query<{ id: string }>(
          `insert into product_variants (
            organization_id,product_id,name,sku,cost,selling_price,is_active
           ) select $1,p.id,$3,$4,$5,$6,$7 from products p
             where p.id=$2 and p.organization_id=$1 returning id`,
          [
            organizationId,
            productId,
            input.name,
            input.sku,
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
        return result.rows[0];
      });
      sendData(response, created, 201);
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
  return router;
}
