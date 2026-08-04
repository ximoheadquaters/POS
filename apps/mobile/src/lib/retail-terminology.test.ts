import { describe, expect, it } from 'vitest';
import {
  getAlternateUnitsSummary,
  getInventorySummary,
  getRepackingRecipeSummary,
  getRetailLabel,
  getSupplierPackageSummary,
  getTaxDetailsSummary,
} from './retail-terminology';

describe('retail terminology and progressive disclosure summaries', () => {
  it('maps terminology correctly for retail profile', () => {
    expect(getRetailLabel('recipe_bom', 'retail')).toBe('Repacking Recipe');
    expect(getRetailLabel('ingredient_output', 'retail')).toBe('Bulk Source Product');
    expect(getRetailLabel('production_batch', 'retail')).toBe('Repacking Batch');
    expect(getRetailLabel('ingredient', 'retail')).toBe('Source Material');
    expect(getRetailLabel('quantity_required', 'retail')).toBe('Amount Needed per Pack');
  });

  it('preserves food-service terminology for non-retail profiles', () => {
    expect(getRetailLabel('recipe_bom', 'food_service')).toBe('Recipe / BOM');
    expect(getRetailLabel('ingredient_output', 'food_service')).toBe('Ingredient Output');
    expect(getRetailLabel('production_batch', 'food_service')).toBe('Production Batch');
    expect(getRetailLabel('ingredient', 'food_service')).toBe('Ingredient');
    expect(getRetailLabel('quantity_required', 'food_service')).toBe('Quantity Required');

    expect(getRetailLabel('recipe_bom', 'hybrid')).toBe('Recipe / BOM');
  });

  it('generates clear section summaries for collapsed cards', () => {
    expect(getAlternateUnitsSummary(2)).toBe('2 units configured');
    expect(getAlternateUnitsSummary(0)).toBe('None configured');

    expect(getSupplierPackageSummary('sack', '25', 'kg')).toBe('1 sack contains 25 kg');
    expect(getSupplierPackageSummary('drum', '20', 'l')).toBe('1 drum contains 20 l');

    expect(getRepackingRecipeSummary(3)).toBe('3 source materials configured');
    expect(getRepackingRecipeSummary(0)).toBe('No materials configured');

    expect(getTaxDetailsSummary('12.00', true)).toBe('12% tax (Inclusive)');
    expect(getInventorySummary(10)).toBe('Alert at 10 units');
  });
});
