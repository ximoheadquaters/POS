export type UnitDimension = 'count' | 'weight' | 'volume' | 'length' | 'unknown';

const COUNT_UNITS = new Set([
  'piece',
  'pieces',
  'pc',
  'pcs',
  'box',
  'boxes',
  'pack',
  'packs',
  'case',
  'cases',
  'sack',
  'sacks',
  'serving',
  'servings',
  'bottle',
  'bottles',
  'can',
  'cans',
  'container',
  'containers',
  'item',
  'items',
  'unit',
  'units',
]);

const CONTAINER_UNITS = new Set([
  'box',
  'boxes',
  'pack',
  'packs',
  'case',
  'cases',
  'sack',
  'sacks',
  'bottle',
  'bottles',
  'can',
  'cans',
  'container',
  'containers',
]);

const WEIGHT_UNITS = new Set([
  'g',
  'gram',
  'grams',
  'kg',
  'kilogram',
  'kilograms',
  'mg',
  'milligram',
  'milligrams',
]);

const VOLUME_UNITS = new Set([
  'ml',
  'milliliter',
  'milliliters',
  'l',
  'liter',
  'liters',
]);

const LENGTH_UNITS = new Set([
  'mm',
  'millimeter',
  'millimeters',
  'cm',
  'centimeter',
  'centimeters',
  'm',
  'meter',
  'meters',
  'km',
  'kilometer',
  'kilometers',
]);

export function getUnitDimension(unit: string): UnitDimension {
  if (!unit) return 'unknown';
  const u = unit.toLowerCase().trim();
  if (COUNT_UNITS.has(u)) return 'count';
  if (WEIGHT_UNITS.has(u)) return 'weight';
  if (VOLUME_UNITS.has(u)) return 'volume';
  if (LENGTH_UNITS.has(u)) return 'length';
  return 'unknown';
}

export function isCountContainerUnit(unit: string): boolean {
  if (!unit) return false;
  const u = unit.toLowerCase().trim();
  return CONTAINER_UNITS.has(u);
}

export function isSameDimensionConversion(fromUnit: string, toUnit: string): boolean {
  const dim1 = getUnitDimension(fromUnit);
  const dim2 = getUnitDimension(toUnit);
  if (dim1 === 'unknown' || dim2 === 'unknown') return false;
  return dim1 === dim2;
}

export interface UnitConversionValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateUnitConversion(
  baseUnit: string,
  variantUnit: string,
  unitsPerBase: number,
): UnitConversionValidationResult {
  if (!Number.isFinite(unitsPerBase) || unitsPerBase <= 0) {
    return { valid: false, reason: 'Conversion factor must be a positive number' };
  }

  const bNorm = (baseUnit || '').toLowerCase().trim();
  const vNorm = (variantUnit || '').toLowerCase().trim();

  if (bNorm === vNorm) {
    if (unitsPerBase !== 1) {
      return { valid: false, reason: 'Same unit conversion must have a factor of 1' };
    }
    return { valid: true };
  }

  const dimBase = getUnitDimension(bNorm);
  const dimVariant = getUnitDimension(vNorm);

  // Incompatible measurement dimensions (e.g. weight kg to volume liter)
  const isBaseMeas = ['weight', 'volume', 'length'].includes(dimBase);
  const isVarMeas = ['weight', 'volume', 'length'].includes(dimVariant);

  if (isBaseMeas && isVarMeas && dimBase !== dimVariant) {
    return {
      valid: false,
      reason: `Cannot convert between incompatible measurement dimensions (${dimBase} and ${dimVariant})`,
    };
  }

  // Same measurement dimension (e.g. kg to g, l to ml)
  if (isBaseMeas && isVarMeas && dimBase === dimVariant) {
    return { valid: true };
  }

  // Container conversions (e.g. 1 box = 12 pcs, 1 sack = 25 kg, 1 bottle = 750 ml)
  const varIsContainer = isCountContainerUnit(vNorm) || CONTAINER_UNITS.has(vNorm);
  const baseIsContainer = isCountContainerUnit(bNorm) || CONTAINER_UNITS.has(bNorm);

  if (varIsContainer || baseIsContainer) {
    return { valid: true };
  }

  // Count to count conversion (e.g. piece to box/pack/serving)
  if (dimBase === 'count' && dimVariant === 'count') {
    return { valid: true };
  }

  // Arbitrary piece to measurement conversion without container package configuration
  if ((dimBase === 'count' && isVarMeas) || (dimVariant === 'count' && isBaseMeas)) {
    return {
      valid: false,
      reason: 'Cannot convert a simple piece to a measurement without explicit container package configuration',
    };
  }

  return { valid: true };
}

export function convertRecipeQuantity(
  quantityRequired: number,
  recipeUnit?: string | null,
  baseUnit?: string | null,
): number {
  if (!recipeUnit || !baseUnit) return quantityRequired;

  const rUnit = recipeUnit.toLowerCase().trim();
  const bUnit = baseUnit.toLowerCase().trim();

  if (['kg', 'kilogram', 'kilograms'].includes(bUnit) && ['g', 'gram', 'grams'].includes(rUnit)) {
    return quantityRequired / 1000;
  }
  if (['g', 'gram', 'grams'].includes(bUnit) && ['kg', 'kilogram', 'kilograms'].includes(rUnit)) {
    return quantityRequired * 1000;
  }

  if (['l', 'liter', 'liters'].includes(bUnit) && ['ml', 'milliliter', 'milliliters'].includes(rUnit)) {
    return quantityRequired / 1000;
  }
  if (['ml', 'milliliter', 'milliliters'].includes(bUnit) && ['l', 'liter', 'liters'].includes(rUnit)) {
    return quantityRequired * 1000;
  }

  return quantityRequired;
}
