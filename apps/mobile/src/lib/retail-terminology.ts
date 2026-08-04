export type BusinessProfile = 'retail' | 'food_service' | 'hybrid' | string;

export interface SectionSummaryInput {
  alternateUnitsCount?: number;
  packageUnit?: string;
  packageSize?: string;
  packageMeasureUnit?: string;
  recipeItemsCount?: number;
  isTaxInclusive?: boolean;
  taxRate?: string;
  lowStockLevel?: string | number;
}

export function getRetailLabel(key: string, profile?: BusinessProfile): string {
  const isRetail = (profile ?? 'retail') === 'retail';
  if (!isRetail) {
    switch (key) {
      case 'bom_production':
        return 'BOM Production';
      case 'recipe_bom':
        return 'Recipe / BOM';
      case 'ingredient_output':
        return 'Ingredient Output';
      case 'production_batch':
        return 'Production Batch';
      case 'ingredient':
        return 'Ingredient';
      case 'recipe_item':
        return 'Recipe Item';
      case 'quantity_required':
        return 'Quantity Required';
      case 'units_per_base':
        return 'Units Per Base';
      case 'preproduced':
        return 'Preproduced';
      case 'preparation_behavior':
        return 'Preparation Behavior';
      default:
        return key;
    }
  }

  switch (key) {
    case 'bom_production':
    case 'recipe_bom':
      return 'Repacking Recipe';
    case 'ingredient_output':
      return 'Bulk Source Product';
    case 'production_batch':
      return 'Repacking Batch';
    case 'ingredient':
      return 'Source Material';
    case 'recipe_item':
      return 'Repacking Material';
    case 'quantity_required':
      return 'Amount Needed per Pack';
    case 'units_per_base':
      return 'Contains';
    case 'preproduced':
      return 'Repacked Finished Product';
    case 'preparation_behavior':
      return 'Product Type';
    default:
      return key;
  }
}

export function getAlternateUnitsSummary(count?: number): string {
  if (!count || count <= 0) return 'None configured';
  return count === 1 ? '1 unit configured' : `${count} units configured`;
}

export function getSupplierPackageSummary(
  packageUnit?: string,
  packageSize?: string,
  measureUnit?: string,
): string {
  if (!packageUnit || !packageSize) return 'Not configured';
  const size = packageSize.trim();
  const unit = packageUnit.trim();
  const measure = (measureUnit || '').trim();
  if (measure) {
    return `1 ${unit} contains ${size} ${measure}`;
  }
  return `1 ${unit} contains ${size} base units`;
}

export function getRepackingRecipeSummary(count?: number): string {
  if (!count || count <= 0) return 'No materials configured';
  return count === 1 ? '1 source material configured' : `${count} source materials configured`;
}

export function getTaxDetailsSummary(taxRate?: string, isTaxInclusive?: boolean): string {
  const rate = parseFloat(taxRate || '0');
  if (rate <= 0) return 'No tax (0%)';
  const mode = isTaxInclusive ? 'Inclusive' : 'Exclusive';
  return `${rate}% tax (${mode})`;
}

export function getInventorySummary(lowStockLevel?: string | number): string {
  const level = Number(lowStockLevel);
  if (Number.isFinite(level) && level > 0) {
    return `Alert at ${level} units`;
  }
  return 'Stock tracking active';
}
