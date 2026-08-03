import { describe, expect, it } from 'vitest';
import { calculateBulkCostSuggestion, formatCalculatedUnitCost } from './bulk-cost';

describe('calculateBulkCostSuggestion', () => {
  it('calculates a 10 kg sack cost per kg and gram', () => {
    expect(calculateBulkCostSuggestion(500, 10, 'kg')).toEqual({
      packageCost: 500,
      packageSize: 10,
      primaryUnit: 'kg',
      primaryUnitCost: 50,
      secondaryUnit: 'g',
      secondaryUnitCost: 0.05,
    });
  });

  it('calculates the matching kilogram cost when stock is recorded in grams', () => {
    const result = calculateBulkCostSuggestion(500, 10_000, 'g');
    expect(result?.primaryUnitCost).toBe(0.05);
    expect(result?.secondaryUnit).toBe('kg');
    expect(result?.secondaryUnitCost).toBe(50);
  });

  it('supports liquid containers', () => {
    const result = calculateBulkCostSuggestion(900, 20, 'l');
    expect(result?.primaryUnitCost).toBe(45);
    expect(result?.secondaryUnitCost).toBe(0.045);
  });

  it('rejects incomplete or invalid values', () => {
    expect(calculateBulkCostSuggestion(0, 10, 'kg')).toBeNull();
    expect(calculateBulkCostSuggestion(500, 0, 'kg')).toBeNull();
    expect(calculateBulkCostSuggestion(Number.NaN, 10, 'kg')).toBeNull();
  });
});

describe('formatCalculatedUnitCost', () => {
  it('keeps useful precision for very small ingredient costs', () => {
    expect(formatCalculatedUnitCost(0.005)).toBe('\u20B10.005');
  });
});
