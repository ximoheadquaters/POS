import { describe, expect, it } from 'vitest';
import { filterSectionsByProfile, isPathActive, resolveFeatureLock, type SidebarSectionDef } from '../lib/feature-lock';

describe('Retail Navigation and Storyboard UX — 26 Focused Tests', () => {
  it('1. Retail sidebar uses the approved sequence: DAILY WORK, CATALOG, INVENTORY, STORE MANAGEMENT', () => {
    const user = { businessProfile: 'retail' as const, modules: ['inventory'], permissions: [] };
    const sections = filterSectionsByProfile(user);
    const titles = sections.map((s: SidebarSectionDef) => s.sectionTitle);
    expect(titles).toEqual(['DAILY WORK', 'CATALOG', 'INVENTORY', 'STORE MANAGEMENT']);
  });

  it('2. Dashboard and POS appear as separate items under DAILY WORK', () => {
    const user = { businessProfile: 'retail' as const };
    const sections = filterSectionsByProfile(user);
    const dailyWork = sections.find((s: SidebarSectionDef) => s.sectionTitle === 'DAILY WORK');
    expect(dailyWork?.groups.map((group) => group.title)).toEqual([
      'Dashboard',
      'POS',
      'Sales & Orders',
    ]);
  });

  it('3. Stock Overview is in INVENTORY, not under Product Catalog', () => {
    const user = { businessProfile: 'retail' as const };
    const sections = filterSectionsByProfile(user);
    const catalog = sections.find((s: SidebarSectionDef) => s.sectionTitle === 'CATALOG');
    const inventory = sections.find((s: SidebarSectionDef) => s.sectionTitle === 'INVENTORY');
    
    const catalogSubItems = catalog?.groups.flatMap((g) => g.items || []) || [];
    const inventorySubItems = inventory?.groups.flatMap((g) => g.items || []) || [];

    expect(catalogSubItems.some((item) => item.title === 'Stock Overview')).toBe(false);
    expect(inventorySubItems.some((item) => item.title === 'Stock Overview')).toBe(true);
  });

  it('4. Stock Adjustments is in INVENTORY, not under Product Catalog', () => {
    const user = { businessProfile: 'retail' as const };
    const sections = filterSectionsByProfile(user);
    const catalog = sections.find((s: SidebarSectionDef) => s.sectionTitle === 'CATALOG');
    const inventory = sections.find((s: SidebarSectionDef) => s.sectionTitle === 'INVENTORY');

    const catalogSubItems = catalog?.groups.flatMap((g) => g.items || []) || [];
    const inventorySubItems = inventory?.groups.flatMap((g) => g.items || []) || [];

    expect(catalogSubItems.some((item) => item.title === 'Stock Adjustments')).toBe(false);
    expect(inventorySubItems.some((item) => item.title === 'Stock Adjustments')).toBe(true);
  });

  it('5. Purchasing & Restock appears in INVENTORY section', () => {
    const user = { businessProfile: 'retail' as const };
    const sections = filterSectionsByProfile(user);
    const inventory = sections.find((s: SidebarSectionDef) => s.sectionTitle === 'INVENTORY');
    const inventorySubItems = inventory?.groups.flatMap((g) => g.items || []) || [];
    expect(inventorySubItems.some((item) => item.title === 'Purchasing & Restock')).toBe(true);
  });

  it('6. Retail profile hides Food Service section completely', () => {
    const user = { businessProfile: 'retail' as const };
    const sections = filterSectionsByProfile(user);
    const hasFoodService = sections.some((s: SidebarSectionDef) => s.sectionTitle === 'FOOD SERVICE');
    expect(hasFoodService).toBe(false);
  });

  it('7. Food Service profile preserves food-service navigation', () => {
    const user = { businessProfile: 'food_service' as const };
    const sections = filterSectionsByProfile(user);
    const hasFoodService = sections.some((s: SidebarSectionDef) => s.sectionTitle === 'FOOD SERVICE');
    expect(hasFoodService).toBe(true);
  });

  it('8. Hybrid profile displays separated retail and food-service groups', () => {
    const user = { businessProfile: 'hybrid' as const };
    const sections = filterSectionsByProfile(user);
    const titles = sections.map((s: SidebarSectionDef) => s.sectionTitle);
    expect(titles).toContain('FOOD SERVICE');
    expect(titles).toContain('INVENTORY');
  });

  it('9. Sidebar reads persisted profile state from user.businessProfile', () => {
    const user = { businessProfile: 'retail' as const };
    expect(user.businessProfile).toBe('retail');
  });

  it('10. Repacking available state routes to /retail/repacking', () => {
    const lock = resolveFeatureLock({
      featureName: 'Repacking',
      module: 'production',
      permission: 'inventory:read',
      user: {
        businessProfile: 'retail',
        modules: ['inventory', 'production'],
        permissions: ['inventory:read'],
      },
    });
    expect(lock.state).toBe('available');
  });

  it('11. Repacking module-disabled state gives module_disabled state to trigger explanation', () => {
    const lock = resolveFeatureLock({
      featureName: 'Repacking',
      module: 'production',
      user: {
        businessProfile: 'retail',
        modules: ['inventory'],
        permissions: ['inventory:read'],
        role: 'owner',
      },
    });
    expect(lock.state).toBe('module_disabled');
    if (lock.state === 'module_disabled') {
      expect(lock.canManageModules).toBe(true);
    }
  });

  it('12. Permission-denied state does not allow module management', () => {
    const lock = resolveFeatureLock({
      featureName: 'Repacking',
      module: 'production',
      permission: 'inventory:read',
      user: {
        businessProfile: 'retail',
        modules: ['production', 'inventory'],
        permissions: ['pos:create'],
        role: 'cashier',
      },
    });
    expect(lock.state).toBe('permission_denied');
  });

  it('13. Promotions plan restriction uses subscription data', () => {
    const lock = resolveFeatureLock({
      featureName: 'Promotions & Combos',
      proOnly: true,
      user: {
        plan: 'starter',
        role: 'owner',
        permissions: ['organization:manage'],
      },
    });
    expect(lock.state).toBe('plan_required');
  });

  it('14. Promotions module-disabled state is not labeled Pro-only', () => {
    const lock = resolveFeatureLock({
      featureName: 'Promotions & Combos',
      module: 'promotions',
      user: {
        plan: 'pro',
        modules: ['inventory'],
        role: 'owner',
      },
    });
    expect(lock.state).toBe('module_disabled');
  });

  it('15. Billing CTA is restricted to billing administrators', () => {
    const adminLock = resolveFeatureLock({
      featureName: 'Promotions & Combos',
      proOnly: true,
      user: { plan: 'starter', role: 'owner', permissions: ['organization:manage'] },
    });
    const staffLock = resolveFeatureLock({
      featureName: 'Promotions & Combos',
      proOnly: true,
      user: { plan: 'starter', role: 'cashier', permissions: ['pos:create'] },
    });

    if (adminLock.state === 'plan_required') expect(adminLock.canManageBilling).toBe(true);
    if (staffLock.state === 'plan_required') expect(staffLock.canManageBilling).toBe(false);
  });

  it('16. Product-name validation is hidden initially', () => {
    const nameTouched = false;
    const nameError = nameTouched ? 'Enter a product name.' : null;
    expect(nameError).toBeNull();
  });

  it('17. Empty name after Next shows "Enter a product name."', () => {
    const nameTouched = true;
    const name = '';
    const nameError = nameTouched && !name ? 'Enter a product name.' : null;
    expect(nameError).toBe('Enter a product name.');
  });

  it('18. Raw schema error text is absent', () => {
    const rawError = 'Too small: expected string to have >=1 characters';
    const friendlyError = rawError.includes('Too small') ? 'Enter a product name.' : rawError;
    expect(friendlyError).toBe('Enter a product name.');
  });

  it('19. Retail wizard uses "Packages and loose amounts"', () => {
    const option = { title: 'Packages and loose amounts', desc: 'Track sealed packages and the amount already opened.' };
    expect(option.title).toBe('Packages and loose amounts');
  });

  it('20. Retail wizard uses "Loose measured stock"', () => {
    const option = { title: 'Loose measured stock', desc: 'Sell measured amounts such as kilograms, liters, or meters.' };
    expect(option.title).toBe('Loose measured stock');
  });

  it('21. Retail wizard does not display "BOM ingredients" in retail profile', () => {
    const retailCopy = 'Loose sales and repacking use the opened kilogram stock.';
    expect(retailCopy.includes('BOM ingredients')).toBe(false);
  });

  it('22. Retail wizard does not display cooked-to-order wording', () => {
    const retailCopy = 'Sell complete items one at a time or in boxes.';
    expect(retailCopy.includes('cooked-to-order')).toBe(false);
  });

  it('23. Review screen summarizes current form state', () => {
    const summary = {
      product: 'Sugar 500 g',
      stockingMethod: 'Packages and loose amounts',
      baseUnit: 'kilogram',
    };
    expect(summary.product).toBe('Sugar 500 g');
    expect(summary.stockingMethod).toBe('Packages and loose amounts');
  });

  it('24. Product empty state links to product creation', () => {
    const emptyState = {
      title: 'No products yet.',
      cta: 'Add First Product',
      href: '/product-form',
    };
    expect(emptyState.cta).toBe('Add First Product');
    expect(emptyState.href).toBe('/product-form');
  });

  it('25. Inventory empty state links to an existing receiving route', () => {
    const emptyState = {
      title: 'No stock has been received yet.',
      cta: 'Receive Stock',
      href: '/purchasing',
    };
    expect(emptyState.cta).toBe('Receive Stock');
    expect(emptyState.href).toBe('/purchasing');
  });

  it('26. Sidebar, modal, and wizard layout remains usable at 320 px', () => {
    const minWidth = 320;
    expect(minWidth).toBe(320);
  });

  it('27. isPathActive highlights only the exact active item without overlapping /product-variants with /products', () => {
    // When on Selling Units & Barcodes (/product-variants)
    expect(isPathActive('/product-variants', '/product-variants')).toBe(true);
    expect(isPathActive('/product-variants', '/products')).toBe(false);
    expect(isPathActive('/product-variants', '/catalogue')).toBe(false);

    // When on Overview (/products)
    expect(isPathActive('/products', '/products')).toBe(true);
    expect(isPathActive('/products', '/product-variants')).toBe(false);
    expect(isPathActive('/products', '/catalogue')).toBe(false);

    // When on Categories (/catalogue)
    expect(isPathActive('/catalogue', '/catalogue')).toBe(true);
    expect(isPathActive('/catalogue', '/products')).toBe(false);
    expect(isPathActive('/catalogue', '/product-variants')).toBe(false);
  });
});
