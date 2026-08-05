import { Router } from 'express';
import { posBarcodeItemSchema, type POSBarcodeItem } from '@ximo/shared';
import type { Database } from '../../database/types.js';
import { requireBranchAccess, requireModule, requirePermission } from '../../middleware/auth.js';
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
