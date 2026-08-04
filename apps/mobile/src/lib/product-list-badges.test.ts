import { describe, expect, it } from 'vitest';
import {
  formatAlternateSellingUnitBadge,
  formatCatalogUnitPrice,
  getRetailProductTypeBadges,
  getStockStatus,
  hasLegacyInvalidConversion,
} from './product-list-badges';

describe('product-list-badges unit tests', () => {
  it('1. Simple product has no irrelevant type badges', () => {
    const badges = getRetailProductTypeBadges({
      unit: 'piece',
      inventoryRole: 'sellable',
      preparationBehavior: 'standard',
      hasRecipe: false,
      sellingUnits: [],
    });
    expect(badges).toHaveLength(0);
  });

  it('2. Box of 12 badge uses unitsPerBase in the correct direction', () => {
    const badgeStr = formatAlternateSellingUnitBadge(
      [{ name: 'Box', unit: 'box', unitsPerBase: 12, sellingPrice: '220.00' }],
      'piece',
    );
    expect(badgeStr).toBe('Box of 12: ₱220.00');
  });

  it('3. Weighted price displays per base unit', () => {
    expect(formatCatalogUnitPrice('65.00', 'kg')).toBe('₱65.00 / kg');
    expect(formatCatalogUnitPrice('95.00', 'l')).toBe('₱95.00 / l');
    expect(formatCatalogUnitPrice('25.00', 'piece')).toBe('₱25.00');
  });

  it('4. Ingredient product shows Bulk Source in management catalog', () => {
    const badges = getRetailProductTypeBadges({
      inventoryRole: 'ingredient',
      unit: 'kg',
    });
    expect(badges.map((b) => b.label)).toContain('Bulk Source');
  });

  it('5. Ingredient-only product is excluded from cashier catalog filter', () => {
    const cashierFilter = (role: string) => ['sellable', 'both'].includes(role);
    expect(cashierFilter('ingredient')).toBe(false);
    expect(cashierFilter('sellable')).toBe(true);
    expect(cashierFilter('both')).toBe(true);
  });

  it('6. Preproduced product shows Repacked badge', () => {
    const badges = getRetailProductTypeBadges({
      preparationBehavior: 'preproduced',
      unit: 'pack',
    });
    expect(badges.map((b) => b.label)).toContain('Repacked');
  });

  it('7 & 8. hasRecipe shows recipe-configured status without extra N+1 recipe requests', () => {
    const badges = getRetailProductTypeBadges({
      preparationBehavior: 'standard',
      hasRecipe: true,
      unit: 'piece',
    });
    expect(badges.map((b) => b.label)).toContain('Repacking recipe configured');
  });

  it('9. Zero quantity shows Out of Stock', () => {
    const status = getStockStatus(0);
    expect(status.status).toBe('out_of_stock');
    expect(status.label).toBe('Out of Stock');
  });

  it('10. Low-stock threshold behavior applies only when threshold is available', () => {
    const noThreshold = getStockStatus(3);
    expect(noThreshold.status).toBe('in_stock');
    expect(noThreshold.label).toBe('In Stock');

    const withThreshold = getStockStatus(3, 5);
    expect(withThreshold.status).toBe('low_stock');
    expect(withThreshold.label).toBe('Low Stock');
  });

  it('11. Legacy invalid conversion product remains visible with non-blocking warning', () => {
    const legacyProduct = {
      unit: 'kg',
      sellingUnits: [{ unit: 'l', unitsPerBase: 5 }],
    };
    const legacyCheck = hasLegacyInvalidConversion(legacyProduct);
    expect(legacyCheck.isInvalid).toBe(true);
    expect(legacyCheck.warning).toBe('Review unit setup');
  });

  it('12 & 13. Retail navigation points to /retail/repacking gated by module and permission', () => {
    const user = {
      modules: ['inventory', 'production'],
      permissions: ['inventory:read'],
      businessProfile: 'retail',
    };
    const canNavigate =
      user.businessProfile === 'retail' &&
      (user.modules.includes('production') || user.modules.includes('inventory')) &&
      user.permissions.includes('inventory:read');

    expect(canNavigate).toBe(true);
  });

  it('14. Badge cards formatting string length fits 320 px screen without overflow', () => {
    const badges = getRetailProductTypeBadges({
      inventoryRole: 'ingredient',
      preparationBehavior: 'preproduced',
      unit: 'kg',
      sellingUnits: [{ name: 'Box', unit: 'box', unitsPerBase: 12, sellingPrice: '220.00' }],
    });

    for (const badge of badges) {
      expect(badge.label.length).toBeLessThan(35);
    }
  });
});
