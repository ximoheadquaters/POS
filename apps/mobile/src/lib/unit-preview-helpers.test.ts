import { describe, expect, it } from 'vitest';
import {
  formatReceivingConversionExplanation,
  formatStockPreview,
  formatUnitDeductionExplanation,
  getCompatibleUnitsForDimension,
  pluralizeUnit,
} from './unit-preview-helpers';

describe('unit-preview-helpers unit tests', () => {
  it('pluralizes units correctly for quantity 1 vs multiple', () => {
    expect(pluralizeUnit(1, 'pieces')).toBe('piece');
    expect(pluralizeUnit(12, 'piece')).toBe('pieces');
    expect(pluralizeUnit(1, 'box')).toBe('box');
    expect(pluralizeUnit(5, 'box')).toBe('boxes');
    expect(pluralizeUnit(1, 'kg')).toBe('kg');
    expect(pluralizeUnit(25, 'kg')).toBe('kg');
  });

  it('formats deduction explanation accurately without reversing unitsPerBase factor', () => {
    const explanation = formatUnitDeductionExplanation('box', 12, 'piece');
    expect(explanation).toBe('Selling 1 box deducts 12 pieces from inventory.');
  });

  it('formats stock preview correctly when selling 1 piece vs 1 box of 12 from 120 pieces', () => {
    const preview = formatStockPreview(120, 'box', 12, 'piece');
    expect(preview.remainingForSingleUnit).toBe(119);
    expect(preview.remainingForAlternateBox).toBe(108);
    expect(preview.text).toContain('Current stock: 120 pieces');
    expect(preview.text).toContain('Selling 1 piece leaves 119 pieces');
    expect(preview.text).toContain('selling 1 box of 12 leaves 108 pieces');
  });

  it('formats receiving conversion explanation for sack and bottle', () => {
    expect(formatReceivingConversionExplanation('sack', 25, 'kg')).toBe(
      'Receiving 1 sack adds 25 kg to inventory.',
    );
    expect(formatReceivingConversionExplanation('bottle', 750, 'ml')).toBe(
      'Receiving 1 bottle adds 750 ml to inventory.',
    );
  });

  it('returns compatible units for measurement dimensions', () => {
    expect(getCompatibleUnitsForDimension('weight')).toEqual(['g', 'kg']);
    expect(getCompatibleUnitsForDimension('volume')).toEqual(['ml', 'l']);
    expect(getCompatibleUnitsForDimension('length')).toEqual(['cm', 'm']);
  });
});
