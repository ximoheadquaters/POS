import { describe, expect, it } from 'vitest';
import {
  convertRecipeQuantity,
  getUnitDimension,
  isCountContainerUnit,
  isSameDimensionConversion,
  validateUnitConversion,
} from './units.js';

describe('recipe quantity conversion', () => {
  it('converts milliliters and liters into the ingredient base unit', () => {
    expect(convertRecipeQuantity(500, 'ml', 'l')).toBe(0.5);
    expect(convertRecipeQuantity(1, 'l', 'ml')).toBe(1_000);
  });

  it('keeps quantities unchanged when recipe and inventory use the same unit', () => {
    expect(convertRecipeQuantity(500, 'ml', 'ml')).toBe(500);
    expect(convertRecipeQuantity(1, 'bottle', 'bottle')).toBe(1);
  });
});

describe('dimensional unit validation', () => {
  it('identifies unit dimensions correctly', () => {
    expect(getUnitDimension('piece')).toBe('count');
    expect(getUnitDimension('kg')).toBe('weight');
    expect(getUnitDimension('ml')).toBe('volume');
    expect(getUnitDimension('m')).toBe('length');
  });

  it('identifies count container units correctly', () => {
    expect(isCountContainerUnit('box')).toBe(true);
    expect(isCountContainerUnit('sack')).toBe(true);
    expect(isCountContainerUnit('bottle')).toBe(true);
    expect(isCountContainerUnit('kg')).toBe(false);
  });

  it('kg to g accepted', () => {
    expect(isSameDimensionConversion('kg', 'g')).toBe(true);
    expect(validateUnitConversion('kg', 'g', 0.001).valid).toBe(true);
  });

  it('g to kg accepted', () => {
    expect(isSameDimensionConversion('g', 'kg')).toBe(true);
    expect(validateUnitConversion('g', 'kg', 1000).valid).toBe(true);
  });

  it('liter to milliliter accepted', () => {
    expect(isSameDimensionConversion('liter', 'milliliter')).toBe(true);
    expect(validateUnitConversion('liter', 'milliliter', 0.001).valid).toBe(true);
  });

  it('piece to box with positive count factor accepted', () => {
    expect(validateUnitConversion('piece', 'box', 12).valid).toBe(true);
  });

  it('box to piece accepted according to current schema semantics', () => {
    expect(validateUnitConversion('box', 'piece', 12).valid).toBe(true);
  });

  it('sack containing 25 kg accepted through explicit package configuration', () => {
    expect(validateUnitConversion('kg', 'sack', 25).valid).toBe(true);
  });

  it('bottle containing 750 ml accepted through explicit package configuration', () => {
    expect(validateUnitConversion('ml', 'bottle', 750).valid).toBe(true);
  });

  it('piece to kg without package configuration rejected', () => {
    const result = validateUnitConversion('piece', 'kg', 2);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Cannot convert a simple piece to a measurement');
  });

  it('kg to liter rejected', () => {
    const result = validateUnitConversion('kg', 'liter', 1);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('incompatible measurement dimensions');
  });

  it('zero factor rejected', () => {
    const result = validateUnitConversion('kg', 'g', 0);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('positive number');
  });

  it('negative factor rejected', () => {
    const result = validateUnitConversion('box', 'piece', -12);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('positive number');
  });
});
