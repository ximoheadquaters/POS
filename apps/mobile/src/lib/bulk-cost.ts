export type BulkMeasureUnit = 'g' | 'kg' | 'ml' | 'l';

export type BulkCostSuggestion = {
  packageCost: number;
  packageSize: number;
  primaryUnit: BulkMeasureUnit;
  primaryUnitCost: number;
  secondaryUnit: BulkMeasureUnit;
  secondaryUnitCost: number;
};

export function calculateBulkCostSuggestion(
  packageCost: number,
  packageSize: number,
  unit: BulkMeasureUnit,
): BulkCostSuggestion | null {
  if (!Number.isFinite(packageCost) || packageCost <= 0) return null;
  if (!Number.isFinite(packageSize) || packageSize <= 0) return null;

  const primaryUnitCost = packageCost / packageSize;
  const secondary =
    unit === 'kg'
      ? { unit: 'g' as const, cost: primaryUnitCost / 1_000 }
      : unit === 'g'
        ? { unit: 'kg' as const, cost: primaryUnitCost * 1_000 }
        : unit === 'l'
          ? { unit: 'ml' as const, cost: primaryUnitCost / 1_000 }
          : { unit: 'l' as const, cost: primaryUnitCost * 1_000 };

  return {
    packageCost,
    packageSize,
    primaryUnit: unit,
    primaryUnitCost,
    secondaryUnit: secondary.unit,
    secondaryUnitCost: secondary.cost,
  };
}

export function formatCalculatedUnitCost(value: number): string {
  const decimals = value > 0 && value < 0.01 ? 6 : value < 1 ? 4 : 2;
  return `\u20B1${value.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  })}`;
}
