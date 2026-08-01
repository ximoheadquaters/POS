import { describe, expect, it } from 'vitest';
import { convertRecipeQuantity } from './units.js';

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
