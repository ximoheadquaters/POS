import { describe, expect, it } from 'vitest';
import { resolveFeatureLock } from './feature-lock';

describe('feature-lock resolution tests', () => {
  it('1. Returns available when user has plan, module, and permission', () => {
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

  it('2. Returns profile_not_applicable if business profile does not match', () => {
    const lock = resolveFeatureLock({
      featureName: 'BOM Recipes',
      applicableProfiles: ['food_service', 'hybrid'],
      user: {
        businessProfile: 'retail',
      },
    });
    expect(lock.state).toBe('profile_not_applicable');
  });

  it('3. Identifies plan_required for Pro-only features on basic plans', () => {
    const lockAdmin = resolveFeatureLock({
      featureName: 'Promotions & Combos',
      proOnly: true,
      user: {
        plan: 'starter',
        role: 'owner',
        permissions: ['organization:manage'],
      },
    });
    expect(lockAdmin.state).toBe('plan_required');
    if (lockAdmin.state === 'plan_required') {
      expect(lockAdmin.requiredPlan).toBe('Pro');
      expect(lockAdmin.canManageBilling).toBe(true);
    }

    const lockEmployee = resolveFeatureLock({
      featureName: 'Promotions & Combos',
      proOnly: true,
      user: {
        plan: 'starter',
        role: 'cashier',
        permissions: ['pos:create'],
      },
    });
    expect(lockEmployee.state).toBe('plan_required');
    if (lockEmployee.state === 'plan_required') {
      expect(lockEmployee.canManageBilling).toBe(false);
    }
  });

  it('4. Distinguishes module_disabled from plan_required', () => {
    const lock = resolveFeatureLock({
      featureName: 'Repacking',
      module: 'production',
      user: {
        plan: 'pro',
        modules: ['inventory'], // production missing
        role: 'owner',
        permissions: ['organization:manage'],
      },
    });
    expect(lock.state).toBe('module_disabled');
    if (lock.state === 'module_disabled') {
      expect(lock.canManageModules).toBe(true);
    }
  });

  it('5. Identifies permission_denied when module is enabled but permission missing', () => {
    const lock = resolveFeatureLock({
      featureName: 'Repacking',
      module: 'production',
      permission: 'inventory:read',
      user: {
        modules: ['production', 'inventory'],
        permissions: ['pos:create'], // missing inventory:read
        role: 'cashier',
      },
    });
    expect(lock.state).toBe('permission_denied');
  });
});
