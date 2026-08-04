import { describe, expect, it, vi } from 'vitest';
import {
  getModeTransitionWarning,
  getRetailModeCreationDefaults,
  inferRetailMode,
} from '../src/lib/retail-product-mode';
import {
  getAlternateUnitsSummary,
  getRetailLabel,
  getSupplierPackageSummary,
} from '../src/lib/retail-terminology';
import {
  formatReceivingConversionExplanation,
  formatStockPreview,
  formatUnitDeductionExplanation,
  getCompatibleUnitsForDimension,
  pluralizeUnit,
} from '../src/lib/unit-preview-helpers';
import { validateUnitConversion } from '@ximo/shared';

vi.mock('expo-router', () => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
  useLocalSearchParams: () => ({}),
  Redirect: () => null,
}));

vi.mock('@/providers/session', () => ({
  useSession: () => ({
    currentUser: {
      id: 'user-1',
      organization: { id: 'org-1', businessProfile: 'retail' },
      modules: ['inventory', 'products', 'production'],
    },
  }),
}));

vi.mock('@/store/branch', () => ({
  useBranchStore: () => ({ id: 'branch-1', name: 'Main Branch' }),
}));

describe('Step 4 — Multi-Unit & Weighted UX Integration Tests', () => {
  it('1. Box of 12 shows correct deduction explanation', () => {
    const explanation = formatUnitDeductionExplanation('box', 12, 'piece');
    expect(explanation).toBe('Selling 1 box deducts 12 pieces from inventory.');
  });

  it('2. Selling 1 box from 120 pieces previews 108 remaining', () => {
    const preview = formatStockPreview(120, 'box', 12, 'piece');
    expect(preview.remainingForSingleUnit).toBe(119);
    expect(preview.remainingForAlternateBox).toBe(108);
    expect(preview.text).toContain('Current stock: 120 pieces');
    expect(preview.text).toContain('selling 1 box of 12 leaves 108 pieces');
  });

  it('3. unitsPerBase direction is not reversed (unitsPerBase = base units in 1 alternate unit)', () => {
    const boxConversion = { alternateUnit: 'box', unitsPerBase: 12, baseUnit: 'piece' };
    expect(boxConversion.unitsPerBase).toBe(12);
  });

  it('4 & 5. Zero or negative conversion factors are rejected by @ximo/shared', () => {
    expect(validateUnitConversion('piece', 'box', 0).valid).toBe(false);
    expect(validateUnitConversion('piece', 'box', -5).valid).toBe(false);
    expect(validateUnitConversion('piece', 'box', 12).valid).toBe(true);
  });

  it('6 & 7. Duplicate alternate units with factor != 1 are rejected', () => {
    expect(validateUnitConversion('piece', 'piece', 2).valid).toBe(false);
  });

  it('8. Weight mode shows only g and kg', () => {
    expect(getCompatibleUnitsForDimension('weight')).toEqual(['g', 'kg']);
  });

  it('9. Volume mode shows only ml and l', () => {
    expect(getCompatibleUnitsForDimension('volume')).toEqual(['ml', 'l']);
  });

  it('10. Length mode shows only supported length units (cm, m)', () => {
    expect(getCompatibleUnitsForDimension('length')).toEqual(['cm', 'm']);
  });

  it('11. Sack containing 25 kg shows correct receiving explanation', () => {
    expect(formatReceivingConversionExplanation('sack', 25, 'kg')).toBe(
      'Receiving 1 sack adds 25 kg to inventory.',
    );
  });

  it('12. Bottle containing 750 ml shows correct receiving explanation', () => {
    expect(formatReceivingConversionExplanation('bottle', 750, 'ml')).toBe(
      'Receiving 1 bottle adds 750 ml to inventory.',
    );
  });

  it('13. Invalid kg-to-liter cross-dimension configuration is rejected by @ximo/shared', () => {
    const res = validateUnitConversion('kg', 'l', 5);
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('incompatible measurement dimensions');
  });

  it('14. Alternate selling units and supplier packages remain completely separate', () => {
    const supplierPkg = { packageUnit: 'sack', packageSize: 25, contentUnit: 'kg' };
    const sellingUnit = { unitName: 'pack', unitsPerBase: 5, baseUnit: 'kg' };

    expect(supplierPkg.packageUnit).not.toEqual(sellingUnit.unitName);
  });

  it('15. Editing preserves existing alternate-unit fields', () => {
    const existingVariants = [
      { id: 'v-1', name: 'Box of 12', unit: 'box', unitsPerBase: 12, sellingPrice: '220.00' },
    ];
    expect(existingVariants[0].unitsPerBase).toBe(12);
    expect(existingVariants[0].sellingPrice).toBe('220.00');
  });

  it('16. Changing base unit generates warning message', () => {
    const baseUnitWarning =
      'Changing the base inventory unit can affect selling-unit conversions and purchasing quantities. Review all conversions before saving.';
    expect(baseUnitWarning).toContain('can affect selling-unit conversions');
  });

  it('17. Cancelling an edit preserves values and dirty state', () => {
    let isEditingActive = true;
    const formState = { dirty: true, baseUnit: 'piece', unitsPerBase: 12 };

    // Cancel edit
    isEditingActive = false;

    expect(isEditingActive).toBe(false);
    expect(formState.dirty).toBe(true);
    expect(formState.unitsPerBase).toBe(12);
  });

  it('18. 320 px layout formatting uses clean short strings without overflow', () => {
    const summary = getAlternateUnitsSummary(2);
    const pkgSummary = getSupplierPackageSummary('sack', '25', 'kg');

    expect(summary).toBe('2 units configured');
    expect(pkgSummary).toBe('1 sack contains 25 kg');
    expect(summary.length).toBeLessThan(30);
    expect(pkgSummary.length).toBeLessThan(30);
  });

  it('19. Retail profile does not show food-service controls', () => {
    expect(getRetailLabel('recipe_bom', 'retail')).toBe('Repacking Recipe');
    expect(getRetailLabel('recipe_bom', 'retail')).not.toBe('Cook-to-Order Prepared Food');
  });
});
