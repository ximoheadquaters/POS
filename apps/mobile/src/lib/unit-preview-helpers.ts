export function pluralizeUnit(quantity: number, unit: string): string {
  if (!unit) return '';
  const norm = unit.trim().toLowerCase();
  if (Math.abs(quantity) === 1) {
    if (['pieces', 'pcs', 'pc'].includes(norm)) return 'piece';
    if (['boxes'].includes(norm)) return 'box';
    if (['packs'].includes(norm)) return 'pack';
    if (['sacks'].includes(norm)) return 'sack';
    if (['bottles'].includes(norm)) return 'bottle';
    if (['cans'].includes(norm)) return 'can';
    if (['grams'].includes(norm)) return 'g';
    if (['kilograms'].includes(norm)) return 'kg';
    if (['liters', 'litres'].includes(norm)) return 'l';
    if (['milliliters', 'millilitres'].includes(norm)) return 'ml';
    if (['meters', 'metres'].includes(norm)) return 'm';
    return norm;
  }

  // Plural forms for quantity !== 1
  if (norm === 'piece' || norm === 'pc') return 'pieces';
  if (norm === 'box') return 'boxes';
  if (norm === 'pack') return 'packs';
  if (norm === 'sack') return 'sacks';
  if (norm === 'bottle') return 'bottles';
  if (norm === 'can') return 'cans';
  if (norm === 'serving') return 'servings';
  if (norm === 'item') return 'items';
  if (norm === 'unit') return 'units';

  return norm;
}

export function formatUnitDeductionExplanation(
  alternateUnitName: string,
  unitsPerBase: number,
  baseUnit: string,
): string {
  if (!alternateUnitName || !unitsPerBase || unitsPerBase <= 0) return '';
  const altLabel = alternateUnitName.trim().toLowerCase();
  const basePlural = pluralizeUnit(unitsPerBase, baseUnit);
  return `Selling 1 ${altLabel} deducts ${unitsPerBase} ${basePlural} from inventory.`;
}

export function formatStockPreview(
  currentStock: number,
  alternateUnitName: string,
  unitsPerBase: number,
  baseUnit: string,
): { remainingForSingleUnit: number; remainingForAlternateBox: number; text: string } {
  const stock = Math.max(0, currentStock);
  const remainingForSingleUnit = Math.max(0, stock - 1);
  const remainingForAlternateBox = Math.max(0, stock - unitsPerBase);
  const basePlural = pluralizeUnit(unitsPerBase, baseUnit);
  const stockPlural = pluralizeUnit(stock, baseUnit);
  const altLabel = (alternateUnitName || 'box').trim().toLowerCase();

  const text = `Current stock: ${stock} ${stockPlural}. Selling 1 ${pluralizeUnit(1, baseUnit)} leaves ${remainingForSingleUnit} ${pluralizeUnit(remainingForSingleUnit, baseUnit)}; selling 1 ${altLabel} of ${unitsPerBase} leaves ${remainingForAlternateBox} ${pluralizeUnit(remainingForAlternateBox, baseUnit)}.`;

  return {
    remainingForSingleUnit,
    remainingForAlternateBox,
    text,
  };
}

export function formatReceivingConversionExplanation(
  packageUnit: string,
  packageSize: number | string,
  contentUnit: string,
  packageCount?: number,
): string {
  const pkg = (packageUnit || 'container').trim().toLowerCase();
  const size = Number(packageSize);
  if (!Number.isFinite(size) || size <= 0) return '';
  const cntUnit = pluralizeUnit(size, contentUnit);

  const count = Number(packageCount || 1);
  if (count > 1) {
    const totalBase = count * size;
    const totalCntUnit = pluralizeUnit(totalBase, contentUnit);
    const pkgPlural = pluralizeUnit(count, packageUnit);
    return `Receiving ${count} ${pkgPlural} adds ${totalBase} ${totalCntUnit} to inventory (${size} ${cntUnit} / ${pkg}).`;
  }

  return `Receiving 1 ${pkg} adds ${size} ${cntUnit} to inventory.`;
}

export function getCompatibleUnitsForDimension(
  dimension: 'weight' | 'volume' | 'length',
): string[] {
  switch (dimension) {
    case 'weight':
      return ['g', 'kg'];
    case 'volume':
      return ['ml', 'l'];
    case 'length':
      return ['cm', 'm'];
  }
}
