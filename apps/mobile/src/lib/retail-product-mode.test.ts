import { describe, expect, it } from 'vitest';
import {
  getModeTransitionWarning,
  getRetailModeCreationDefaults,
  inferRetailMode,
  isMeasurementUnit,
} from './retail-product-mode';

describe('retail product mode pure helpers (final refinements)', () => {
  it('detects measurement units accurately', () => {
    expect(isMeasurementUnit('kg')).toBe(true);
    expect(isMeasurementUnit('g')).toBe(true);
    expect(isMeasurementUnit('l')).toBe(true);
    expect(isMeasurementUnit('ml')).toBe(true);
    expect(isMeasurementUnit('m')).toBe(true);
    expect(isMeasurementUnit('piece')).toBe(false);
    expect(isMeasurementUnit('box')).toBe(false);
  });

  it('recipe lines without preproduced behavior do NOT infer repacked_finished', () => {
    // Standard behavior + recipe items should NOT infer repacked_finished
    expect(
      inferRetailMode({ preparationBehavior: 'standard', recipeItemsCount: 2 }),
    ).not.toBe('repacked_finished');

    // Only strictly preproduced behavior infers repacked_finished
    expect(
      inferRetailMode({ preparationBehavior: 'preproduced', recipeItemsCount: 2 }),
    ).toBe('repacked_finished');
  });

  it('bulk source supports count, weight, volume and length dimensions', () => {
    expect(getRetailModeCreationDefaults('bulk_source', 'count')).toMatchObject({
      unit: 'piece',
      inventoryRole: 'ingredient',
    });
    expect(getRetailModeCreationDefaults('bulk_source', 'weight')).toMatchObject({
      unit: 'kg',
      inventoryRole: 'ingredient',
    });
    expect(getRetailModeCreationDefaults('bulk_source', 'volume')).toMatchObject({
      unit: 'l',
      inventoryRole: 'ingredient',
    });
    expect(getRetailModeCreationDefaults('bulk_source', 'length')).toMatchObject({
      unit: 'm',
      inventoryRole: 'ingredient',
    });
  });

  it('weighted mode supports weight, volume and length dimensions', () => {
    expect(getRetailModeCreationDefaults('weighted', 'weight')).toMatchObject({
      unit: 'kg',
      inventoryRole: 'sellable',
    });
    expect(getRetailModeCreationDefaults('weighted', 'volume')).toMatchObject({
      unit: 'l',
      inventoryRole: 'sellable',
    });
    expect(getRetailModeCreationDefaults('weighted', 'length')).toMatchObject({
      unit: 'm',
      inventoryRole: 'sellable',
    });
  });

  it('generates non-destructive mode transition warning message', () => {
    const warning = getModeTransitionWarning('simple', 'bulk_source');
    expect(warning).toContain('Changing product mode from Simple Item to Bulk Source Product');
    expect(warning).toContain('No domain fields (unit, price, variants, recipe items, supplier packages) will be changed');
  });
});
