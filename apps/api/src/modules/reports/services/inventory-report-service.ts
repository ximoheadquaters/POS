import type { Database } from '../../../database/types.js';
import type { ReportScopeContext } from '../report-permission-resolver.js';

export interface InventoryReportStockRow {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  inventoryRole: string;
  unit: string;
  quantity: number;
  sealedQuantity: number;
  openedQuantity: number;
  lowStockLevel: number;
  isLowStock: boolean;
  averageCost: string | null;
  inventoryValue: string | null;
  branchName: string;
  conversionHint: string | null;
}

export interface InventoryReportConversionRow {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  baseUnit: string;
  sellingUnit: string;
  sellingUnitName: string;
  unitsPerBase: number;
  isPortioningContainer: boolean;
  ruleLabel: string;
}

export interface InventoryReportMovementRow {
  id: string;
  createdAt: string;
  productName: string;
  sku: string;
  unit: string;
  type: string;
  quantityDelta: number;
  quantityAfter: number;
  reason: string;
  createdBy: string | null;
  conversionLabel: string | null;
  branchName: string;
}

export interface InventoryReportResponse {
  title: string;
  range: { from: string; to: string; branchId: string | null };
  stock: InventoryReportStockRow[];
  conversions: InventoryReportConversionRow[];
  movements: InventoryReportMovementRow[];
  movementsTotal: number;
  page: number;
  pageSize: number;
}

function formatQty(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(3)));
}

function buildConversionLabel(params: {
  baseUnit: string;
  quantityDelta: number;
  sellingUnit: string | null;
  unitsPerBase: number | null;
}): string | null {
  const unitsPerBase = params.unitsPerBase;
  const sellingUnit = params.sellingUnit;
  if (!sellingUnit || !unitsPerBase || unitsPerBase <= 0 || unitsPerBase === 1) {
    return null;
  }
  const baseQty = Math.abs(params.quantityDelta);
  const sellingQty = baseQty / unitsPerBase;
  return `1 ${sellingUnit} = ${formatQty(unitsPerBase)} ${params.baseUnit} · ${formatQty(sellingQty)} ${sellingUnit}`;
}

export class InventoryReportService {
  constructor(private readonly database: Database) {}

  async generate(
    scope: ReportScopeContext,
    filter: { page?: number; pageSize?: number },
  ): Promise<InventoryReportResponse> {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(200, Math.max(10, filter.pageSize ?? 100));
    const offset = (page - 1) * pageSize;

    const inventoryValues = [
      scope.organizationId,
      scope.branchId,
      scope.hasAllBranchesAccess,
      scope.allowedBranchIds,
    ] as const;
    const inventoryBranchScope = (alias: string) =>
      `($2::uuid is null or ${alias}.branch_id=$2)
       and ($3::boolean or ${alias}.branch_id=any($4::uuid[]))`;

    const movementValues = [
      scope.organizationId,
      scope.fromIso,
      scope.toIso,
      scope.branchId,
      scope.hasAllBranchesAccess,
      scope.allowedBranchIds,
      pageSize,
      offset,
    ] as const;
    const movementBranchScope = (alias: string) =>
      `($4::uuid is null or ${alias}.branch_id=$4)
       and ($5::boolean or ${alias}.branch_id=any($6::uuid[]))`;

    const [stockResult, conversionsResult, movementsResult] = await Promise.all([
      this.database.query<{
        id: string;
        productId: string;
        productName: string;
        sku: string;
        inventoryRole: string;
        unit: string;
        quantity: number;
        sealedQuantity: number;
        openedQuantity: number;
        lowStockLevel: number;
        isLowStock: boolean;
        averageCost: string;
        inventoryValue: string;
        branchName: string;
        containerUnit: string | null;
        containerUnitsPerBase: number | null;
      }>(
        `select bi.id,p.id as "productId",p.name as "productName",p.sku,
          coalesce(p.inventory_role,'sellable') as "inventoryRole",
          p.unit,bi.quantity::float8 as quantity,
          bi.sealed_quantity::float8 as "sealedQuantity",
          bi.opened_quantity::float8 as "openedQuantity",
          bi.low_stock_level::float8 as "lowStockLevel",
          (bi.quantity<=bi.low_stock_level) as "isLowStock",
          bi.average_cost::text as "averageCost",
          bi.inventory_value::text as "inventoryValue",
          b.name as "branchName",
          container.unit as "containerUnit",
          container.units_per_base::float8 as "containerUnitsPerBase"
         from branch_inventory bi
         join products p on p.id=bi.product_id and p.organization_id=bi.organization_id
         join branches b on b.id=bi.branch_id and b.organization_id=bi.organization_id
         left join lateral (
           select v.unit,v.units_per_base
           from product_variants v
           where v.organization_id=bi.organization_id and v.product_id=bi.product_id
             and v.is_active and v.units_per_base > 1
           order by v.is_portioning_container desc, v.units_per_base desc, lower(v.name) asc
           limit 1
         ) container on true
         where bi.organization_id=$1 and p.track_inventory
           and ${inventoryBranchScope('bi')}
         order by lower(p.name) asc, lower(b.name) asc
         limit 500`,
        [...inventoryValues],
      ),
      this.database.query<{
        id: string;
        productId: string;
        productName: string;
        sku: string;
        baseUnit: string;
        sellingUnit: string;
        sellingUnitName: string;
        unitsPerBase: number;
        isPortioningContainer: boolean;
      }>(
        `select v.id,p.id as "productId",p.name as "productName",p.sku,
          p.unit as "baseUnit",v.unit as "sellingUnit",
          coalesce(nullif(v.name,''), v.unit) as "sellingUnitName",
          v.units_per_base::float8 as "unitsPerBase",
          coalesce(v.is_portioning_container,false) as "isPortioningContainer"
         from product_variants v
         join products p on p.id=v.product_id and p.organization_id=v.organization_id
         where v.organization_id=$1 and v.is_active and p.track_inventory
           and v.units_per_base > 0
           and (
             v.units_per_base <> 1
             or lower(v.unit) <> lower(p.unit)
             or coalesce(v.is_portioning_container,false)
           )
           and exists (
             select 1 from branch_inventory bi
             where bi.organization_id=v.organization_id and bi.product_id=p.id
               and ${inventoryBranchScope('bi')}
           )
         order by lower(p.name) asc, v.units_per_base asc, lower(v.unit) asc
         limit 500`,
        [...inventoryValues],
      ),
      this.database.query<{
        id: string;
        createdAt: string;
        productName: string;
        sku: string;
        unit: string;
        type: string;
        quantityDelta: number;
        quantityAfter: number;
        reason: string;
        createdBy: string;
        branchName: string;
        variantUnit: string | null;
        variantUnitsPerBase: number | null;
        saleUnit: string | null;
        saleUnitsPerBase: number | null;
        receiptPurchaseUnit: string | null;
        receiptUnitsPerBase: number | null;
        total: number;
      }>(
        `select im.id,im.created_at as "createdAt",p.name as "productName",p.sku,p.unit,
          im.movement_type::text as type,im.quantity_delta::float8 as "quantityDelta",
          im.quantity_after::float8 as "quantityAfter",im.reason,
          pr.display_name as "createdBy",b.name as "branchName",
          v.unit as "variantUnit",v.units_per_base::float8 as "variantUnitsPerBase",
          sale_ctx.unit as "saleUnit",sale_ctx.units_per_base::float8 as "saleUnitsPerBase",
          receipt_ctx.purchase_unit as "receiptPurchaseUnit",
          receipt_ctx.units_per_base::float8 as "receiptUnitsPerBase",
          count(*) over()::int as total
         from inventory_movements im
         join products p on p.id=im.product_id and p.organization_id=im.organization_id
         join branches b on b.id=im.branch_id and b.organization_id=im.organization_id
         join profiles pr on pr.id=im.created_by and pr.organization_id=im.organization_id
         left join product_variants v
           on v.id=im.variant_id and v.organization_id=im.organization_id
         left join lateral (
           select coalesce(sv.unit, p.unit) as unit, si.units_per_base
           from sale_items si
           left join product_variants sv
             on sv.id=si.variant_id and sv.organization_id=si.organization_id
           where im.reference_type='sale' and si.sale_id=im.reference_id
             and si.product_id=im.product_id
           order by si.created_at desc
           limit 1
         ) sale_ctx on true
         left join lateral (
           select poi.purchase_unit, poi.units_per_base
           from stock_receipt_items sri
           join purchase_order_items poi
             on poi.id=sri.purchase_order_item_id and poi.organization_id=sri.organization_id
           where im.reference_type='stock_receipt' and sri.stock_receipt_id=im.reference_id
             and poi.product_id=im.product_id
           limit 1
         ) receipt_ctx on true
         where im.organization_id=$1
           and im.created_at >= $2 and im.created_at < $3
           and ${movementBranchScope('im')}
         order by im.created_at desc
         limit $7 offset $8`,
        [...movementValues],
      ),
    ]);

    const stock: InventoryReportStockRow[] = stockResult.rows.map((row) => {
      let conversionHint: string | null = null;
      if (row.containerUnit && row.containerUnitsPerBase && row.containerUnitsPerBase > 1) {
        const equivalent = row.quantity / row.containerUnitsPerBase;
        conversionHint = `1 ${row.containerUnit} = ${formatQty(row.containerUnitsPerBase)} ${row.unit} · ≈ ${formatQty(equivalent)} ${row.containerUnit}`;
      }
      return {
        id: row.id,
        productId: row.productId,
        productName: row.productName,
        sku: row.sku,
        inventoryRole: row.inventoryRole,
        unit: row.unit,
        quantity: row.quantity,
        sealedQuantity: row.sealedQuantity,
        openedQuantity: row.openedQuantity,
        lowStockLevel: row.lowStockLevel,
        isLowStock: row.isLowStock,
        averageCost: scope.canViewCost ? row.averageCost : null,
        inventoryValue: scope.canViewCost ? row.inventoryValue : null,
        branchName: row.branchName,
        conversionHint,
      };
    });

    const conversions: InventoryReportConversionRow[] = conversionsResult.rows.map((row) => ({
      id: row.id,
      productId: row.productId,
      productName: row.productName,
      sku: row.sku,
      baseUnit: row.baseUnit,
      sellingUnit: row.sellingUnit,
      sellingUnitName: row.sellingUnitName,
      unitsPerBase: row.unitsPerBase,
      isPortioningContainer: row.isPortioningContainer,
      ruleLabel: `1 ${row.sellingUnit} = ${formatQty(row.unitsPerBase)} ${row.baseUnit}`,
    }));

    const movementsTotal = movementsResult.rows[0]?.total ?? 0;
    const movements: InventoryReportMovementRow[] = movementsResult.rows.map(
      ({ total: _total, ...row }) => {
        const conversionLabel =
          buildConversionLabel({
            baseUnit: row.unit,
            quantityDelta: row.quantityDelta,
            sellingUnit: row.variantUnit,
            unitsPerBase: row.variantUnitsPerBase,
          }) ??
          buildConversionLabel({
            baseUnit: row.unit,
            quantityDelta: row.quantityDelta,
            sellingUnit: row.saleUnit,
            unitsPerBase: row.saleUnitsPerBase,
          }) ??
          buildConversionLabel({
            baseUnit: row.unit,
            quantityDelta: row.quantityDelta,
            sellingUnit: row.receiptPurchaseUnit,
            unitsPerBase: row.receiptUnitsPerBase,
          });

        return {
          id: row.id,
          createdAt: row.createdAt,
          productName: row.productName,
          sku: row.sku,
          unit: row.unit,
          type: row.type,
          quantityDelta: row.quantityDelta,
          quantityAfter: row.quantityAfter,
          reason: row.reason,
          createdBy: scope.canViewStaff ? row.createdBy : null,
          conversionLabel,
          branchName: row.branchName,
        };
      },
    );

    return {
      title: 'Inventory Report',
      range: {
        from: scope.fromIso,
        to: scope.toIso,
        branchId: scope.branchId,
      },
      stock,
      conversions,
      movements,
      movementsTotal,
      page,
      pageSize,
    };
  }
}
