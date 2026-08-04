export type InventoryRole = 'sellable' | 'ingredient' | 'both';
export type PreparationBehavior = 'standard' | 'preproduced' | 'cook_to_order';
export type ProductUnit = 'piece' | 'serving' | 'box' | 'pack' | 'sack' | 'bottle' | 'can' | 'ml' | 'l' | 'g' | 'kg' | 'm' | 'cm' | 'mm' | string;

export type RetailProductMode =
  | 'simple'
  | 'multi_unit'
  | 'weighted'
  | 'bulk_source'
  | 'repacked_finished';

export type MeasurementDimension = 'count' | 'weight' | 'volume' | 'length';

export function isMeasurementUnit(unit?: string | null): boolean {
  if (!unit) return false;
  const normalized = unit.trim().toLowerCase();
  return ['kg', 'g', 'kilogram', 'gram', 'grams', 'l', 'ml', 'liter', 'milliliter', 'm', 'cm', 'mm'].includes(
    normalized,
  );
}

export interface InferRetailModeInput {
  preparationBehavior?: PreparationBehavior | null;
  inventoryRole?: InventoryRole | null;
  unit?: string | null;
  recipeItemsCount?: number;
  hasSupplierPackage?: boolean;
  hasPortioningContainer?: boolean;
  hasAlternateSellingUnits?: boolean;
  alternateEnabled?: boolean;
}

export function inferRetailMode(input: InferRetailModeInput): RetailProductMode {
  // 1. Repacked Finished Product (Strictly preproduced behavior)
  if (input.preparationBehavior === 'preproduced') {
    return 'repacked_finished';
  }

  // 2. Bulk Source Product
  if (
    input.inventoryRole === 'ingredient' ||
    input.hasSupplierPackage ||
    input.hasPortioningContainer
  ) {
    return 'bulk_source';
  }

  // 3. Multi-Unit Item
  if (input.hasAlternateSellingUnits || input.alternateEnabled) {
    return 'multi_unit';
  }

  // 4. Weighted / Measured Item
  if (isMeasurementUnit(input.unit)) {
    return 'weighted';
  }

  // 5. Default Simple Item
  return 'simple';
}

export interface RetailModeDefaults {
  inventoryRole: InventoryRole;
  preparationBehavior: PreparationBehavior;
  unit: ProductUnit;
  trackInventory: boolean;
  alternateEnabled: boolean;
  recipeEnabled: boolean;
}

export function getRetailModeCreationDefaults(
  mode: RetailProductMode,
  dimension: MeasurementDimension = 'weight',
): RetailModeDefaults {
  switch (mode) {
    case 'simple':
      return {
        inventoryRole: 'sellable',
        preparationBehavior: 'standard',
        unit: 'piece',
        trackInventory: true,
        alternateEnabled: false,
        recipeEnabled: false,
      };
    case 'multi_unit':
      return {
        inventoryRole: 'sellable',
        preparationBehavior: 'standard',
        unit: 'piece',
        trackInventory: true,
        alternateEnabled: true,
        recipeEnabled: false,
      };
    case 'weighted': {
      let defaultUnit: ProductUnit = 'kg';
      if (dimension === 'volume') defaultUnit = 'l';
      if (dimension === 'length') defaultUnit = 'm';
      return {
        inventoryRole: 'sellable',
        preparationBehavior: 'standard',
        unit: defaultUnit,
        trackInventory: true,
        alternateEnabled: false,
        recipeEnabled: false,
      };
    }
    case 'bulk_source': {
      let defaultUnit: ProductUnit = 'kg';
      if (dimension === 'count') defaultUnit = 'piece';
      if (dimension === 'volume') defaultUnit = 'l';
      if (dimension === 'length') defaultUnit = 'm';
      return {
        inventoryRole: 'ingredient',
        preparationBehavior: 'standard',
        unit: defaultUnit,
        trackInventory: true,
        alternateEnabled: false,
        recipeEnabled: false,
      };
    }
    case 'repacked_finished':
      return {
        inventoryRole: 'sellable',
        preparationBehavior: 'preproduced',
        unit: 'pack',
        trackInventory: true,
        alternateEnabled: false,
        recipeEnabled: true,
      };
  }
}

export function getModeTransitionWarning(
  currentMode: RetailProductMode,
  targetMode: RetailProductMode,
): string {
  if (currentMode === targetMode) return '';
  return `Changing product mode from ${modeLabel(currentMode)} to ${modeLabel(
    targetMode,
  )} will update the form presentation view only. No domain fields (unit, price, variants, recipe items, supplier packages) will be changed until you explicitly edit them.`;
}

function modeLabel(mode: RetailProductMode): string {
  switch (mode) {
    case 'simple':
      return 'Simple Item';
    case 'multi_unit':
      return 'Multi-Unit Item';
    case 'weighted':
      return 'Weighted / Measured Item';
    case 'bulk_source':
      return 'Bulk Source Product';
    case 'repacked_finished':
      return 'Repacked Finished Product';
  }
}
