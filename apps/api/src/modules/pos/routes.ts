import { Router } from 'express';
import { z } from 'zod';
import { posBarcodeItemSchema, uuidSchema, type POSBarcodeItem } from '@ximo/shared';
import type { Database } from '../../database/types.js';
import { requireBranchAccess, requireModule, requirePermission } from '../../middleware/auth.js';
import { validateQuery } from '../../middleware/validation.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../shared/errors.js';
import { sendData } from '../../shared/http.js';

export function normalizeBarcode(raw: string): string {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw badRequest('INVALID_BARCODE', 'The provided barcode parameter is malformed.');
  }
  const trimmed = decoded.trim();
  if (!trimmed) {
    throw badRequest('INVALID_BARCODE', 'Barcode must not be empty.');
  }
  if (trimmed.length > 120) {
    throw badRequest('INVALID_BARCODE', 'Barcode length must not exceed 120 characters.');
  }
  return trimmed;
}

export function posRouter(database: Database): Router {
  const router = Router();
  router.use(requireModule('pos'));

  // Active combo bundles for the POS product list (cashiers sell these; managers create them elsewhere).
  router.get(
    '/promotions',
    requirePermission('sales:create'),
    validateQuery(
      z.object({
        branchId: uuidSchema,
        search: z.string().trim().min(1).max(120).optional(),
      }),
    ),
    requireBranchAccess('query'),
    async (request, response) => {
      if (!request.authUser!.modules.includes('promotions')) {
        sendData(response, []);
        return;
      }

      const organizationId = request.authUser!.organization.id;
      const { branchId, search } = request.query as { branchId: string; search?: string };

      const result = await database.query<{
        id: string;
        name: string;
        code: string | null;
        type: string;
        comboPrice: string;
        description: string | null;
        components: Array<{
          productId: string;
          requiredQuantity: number;
          role: string;
          id: string;
          name: string;
          sku: string;
          unit: string;
          unitKind: string;
          defaultStep: number;
          trackInventory: boolean;
          sellingPrice: string;
          taxRate: string;
          isTaxInclusive: boolean;
          status: string;
          categoryName: string | null;
          availableQuantity: number | null;
        }>;
      }>(
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
           and p.branch_id = $2
           and p.is_active
           and p.type = 'combo_bundle'
           and p.combo_price is not null
           and (p.start_date is null or p.start_date <= now())
           and (p.end_date is null or p.end_date >= now())
           and not exists (
             select 1
             from promotion_items stock_item
             join products stock_product
               on stock_product.id = stock_item.product_id
               and stock_product.organization_id = stock_item.organization_id
             left join branch_inventory stock
               on stock.organization_id = stock_product.organization_id
               and stock.branch_id = $2
               and stock.product_id = stock_product.id
               and stock.variant_id is null
             where stock_item.promotion_id = p.id
               and stock_item.organization_id = p.organization_id
               and stock_product.track_inventory
               and coalesce(stock.quantity, 0) < stock_item.required_quantity
           )
           and ($3::text is null
             or p.name ilike '%' || $3 || '%'
             or coalesce(p.code, '') ilike '%' || $3 || '%')
         order by p.name`,
        [organizationId, branchId, search ?? null],
      );

      sendData(
        response,
        result.rows.filter((row) => Array.isArray(row.components) && row.components.length > 0),
      );
    },
  );

  router.get(
    '/barcodes/:barcode',
    requirePermission('sales:create'),
    async (request, response) => {
      const organizationId = request.authUser!.organization.id;
      const rawBarcode = request.params.barcode as string;
      const normalizedBarcode = normalizeBarcode(rawBarcode);

      const queryBranch = typeof request.query.branchId === 'string' ? request.query.branchId : undefined;
      const userBranches = request.authUser!.branches ?? [];

      if (queryBranch && !userBranches.some((b) => b.id === queryBranch)) {
        throw forbidden('BRANCH_ACCESS_DENIED', 'You do not have access to this branch');
      }

      const branchId = queryBranch || userBranches[0]?.id;
      if (!branchId) {
        throw badRequest('MISSING_BRANCH_CONTEXT', 'Active branch context is required for barcode lookup.');
      }

      const matches = await database.query<{
        productId: string;
        productName: string;
        productStatus: string;
        baseUnit: string;
        basePrice: string;
        inventoryRole: string;
        isTaxInclusive: boolean;
        taxRate: string | null;
        variantId: string | null;
        variantName: string | null;
        variantUnit: string | null;
        variantUnitsPerBase: number | null;
        variantPrice: string | null;
        variantIsActive: boolean | null;
        currentStock: string;
      }>(
        `select pb.barcode, pb.product_id as "productId", pb.variant_id as "variantId",
          p.name as "productName", p.unit as "baseUnit", p.price::text as "basePrice",
          p.inventory_role as "inventoryRole", p.status as "productStatus",
          p.is_tax_inclusive as "isTaxInclusive", p.tax_rate::text as "taxRate",
          v.name as "variantName", v.unit as "variantUnit",
          v.units_per_base as "variantUnitsPerBase", v.selling_price::text as "variantPrice",
          v.is_active as "variantIsActive",
          coalesce(bi.quantity_on_hand, 0)::text as "currentStock"
         from product_barcodes pb
         join products p on p.id = pb.product_id and p.organization_id = pb.organization_id
         left join product_variants v on v.id = pb.variant_id and v.organization_id = pb.organization_id
         left join branch_inventory bi on bi.product_id = p.id and bi.branch_id = $2
         where pb.organization_id = $1 and pb.barcode = $3`,
        [organizationId, branchId, normalizedBarcode],
      );

      if (matches.rows.length === 0) {
        throw notFound('Barcode');
      }

      if (matches.rows.length > 1) {
        throw conflict(
          'AMBIGUOUS_BARCODE',
          'This barcode is assigned to more than one item. Ask an administrator to correct the catalog.',
        );
      }

      const item = matches.rows[0]!;

      if (item.productStatus !== 'active') {
        throw unprocessable('INACTIVE_PRODUCT', 'This product or selling unit is inactive.');
      }

      if (item.variantId && item.variantIsActive === false) {
        throw unprocessable('INACTIVE_UNIT', 'This product or selling unit is inactive.');
      }

      const isAlternate = Boolean(item.variantId);
      const sellingUnitId = item.variantId;
      const productVariantId = item.variantId;
      const sellingUnitCode = isAlternate ? item.variantUnit! : item.baseUnit;
      const sellingUnitName = isAlternate ? item.variantName! : item.baseUnit;
      const baseUnitsPerSellingUnit = isAlternate ? Number(item.variantUnitsPerBase) : 1;
      const unitPrice = isAlternate ? item.variantPrice! : item.basePrice;

      const dto: POSBarcodeItem = {
        productId: item.productId,
        productName: item.productName,
        sellingUnitId,
        productVariantId,
        sellingUnitCode,
        sellingUnitName,
        baseUnitsPerSellingUnit,
        unitPrice,
        currency: 'PHP',
        barcode: normalizedBarcode,
        currentStock: item.currentStock,
        isInventoryTracked: item.inventoryRole !== 'service',
        taxRate: item.taxRate ? String(item.taxRate) : undefined,
        isTaxInclusive: item.isTaxInclusive ?? true,
        isActive: true,
        isSellable: true,
      };

      const validated = posBarcodeItemSchema.parse(dto);
      sendData(response, validated);
    },
  );

  return router;
}
