import type { QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { ModuleCode } from '@ximo/shared';
import type { Queryable } from '../database/types.js';
import { result } from '../test/fakes.js';
import {
  EntitlementService,
  expandRequiredDependencies,
  pruneDisabledDependentModules,
  resolveEffectiveModules,
} from './entitlement-service.js';

class MockQueryable implements Queryable {
  public readonly calls: Array<{ text: string; values?: readonly unknown[] }> = [];

  constructor(
    private readonly enabledRows: Array<{ code: string }> = [],
    private readonly disabledRows: Array<{ code: string }> = [],
  ) {}

  async query<T extends QueryResultRow>(text: string, values?: readonly unknown[]) {
    this.calls.push(values ? { text, values } : { text });
    const rows = text.includes('om.enabled = false') ? this.disabledRows : this.enabledRows;
    return result(rows as unknown as T[]);
  }
}

describe('pruneDisabledDependentModules', () => {
  it('prunes dependent modules if required parent modules are missing', () => {
    // recipes requires ['ingredients', 'products', 'inventory']
    // prepared_food requires ['recipes']
    const modules: ModuleCode[] = ['dashboard', 'pos', 'products', 'inventory', 'recipes', 'prepared_food'];
    const pruned = pruneDisabledDependentModules(modules);
    expect(pruned).toEqual(['dashboard', 'pos', 'products', 'inventory']);
  });

  it('keeps dependent modules when all required parent modules are present', () => {
    const modules: ModuleCode[] = [
      'dashboard',
      'pos',
      'products',
      'inventory',
      'ingredients',
      'recipes',
      'prepared_food',
    ];
    const pruned = pruneDisabledDependentModules(modules);
    expect(pruned).toEqual(modules);
  });

  it('prunes production if inventory is missing', () => {
    const modules: ModuleCode[] = ['dashboard', 'products', 'production'];
    const pruned = pruneDisabledDependentModules(modules);
    expect(pruned).toEqual(['dashboard', 'products']);
  });

  it('prunes held_sales if pos is missing', () => {
    const modules: ModuleCode[] = ['dashboard', 'held_sales'];
    const pruned = pruneDisabledDependentModules(modules);
    expect(pruned).toEqual(['dashboard']);
  });

  it('prunes purchasing if suppliers is missing', () => {
    const modules: ModuleCode[] = ['dashboard', 'inventory', 'purchasing'];
    const pruned = pruneDisabledDependentModules(modules);
    expect(pruned).toEqual(['dashboard', 'inventory']);
  });
});

describe('expandRequiredDependencies', () => {
  it('adds suppliers when purchasing is enabled', () => {
    const expanded = expandRequiredDependencies(['inventory', 'purchasing']);
    expect(expanded.sort()).toEqual(['inventory', 'purchasing', 'suppliers'].sort());
  });
});

describe('resolveEffectiveModules', () => {
  it('expands purchasing dependencies so it is not pruned', () => {
    const resolved = resolveEffectiveModules(['inventory', 'purchasing']);
    expect(resolved.sort()).toEqual(['inventory', 'purchasing', 'suppliers'].sort());
  });

  it('still prunes purchasing when suppliers is explicitly disabled', () => {
    const resolved = resolveEffectiveModules(['inventory', 'purchasing', 'suppliers'], ['suppliers']);
    expect(resolved.sort()).toEqual(['inventory'].sort());
  });
});

describe('EntitlementService', () => {
  it('returns zero modules [] when an organization has no active or trialing subscription', async () => {
    // Query returns empty array because current_sub join fails
    const mockDb = new MockQueryable([]);
    const entitlementService = new EntitlementService(mockDb);

    const modules = await entitlementService.getEffectiveModules('no-sub-org-id');
    expect(modules).toEqual([]);
    expect(mockDb.calls).toHaveLength(2);
    expect(mockDb.calls[0]?.text).toContain('join lateral');
    expect(mockDb.calls[0]?.text).toContain("sub.status in ('trialing', 'active')");
    expect(mockDb.calls[0]?.text).not.toContain('default_plan');
  });

  it('returns pruned effective modules for an active subscription', async () => {
    const mockDb = new MockQueryable([
      { code: 'pos' },
      { code: 'products' },
      { code: 'inventory' },
      { code: 'held_sales' },
    ]);
    const entitlementService = new EntitlementService(mockDb);

    const modules = await entitlementService.getEffectiveModules('active-org-id', 'food_service');
    expect(modules).toEqual(['pos', 'products', 'inventory', 'held_sales']);
    expect(mockDb.calls[0]?.values).toEqual(['active-org-id', 'food_service']);
  });

  it('expands purchasing to include suppliers for POS visibility', async () => {
    const mockDb = new MockQueryable([
      { code: 'inventory' },
      { code: 'purchasing' },
    ]);
    const entitlementService = new EntitlementService(mockDb);

    const modules = await entitlementService.getEffectiveModules('active-org-id');
    expect(modules.sort()).toEqual(['inventory', 'purchasing', 'suppliers'].sort());
  });

  it('accepts a custom transaction Queryable handle', async () => {
    const defaultDb = new MockQueryable([]);
    const transactionTx = new MockQueryable([{ code: 'pos' }]);
    const entitlementService = new EntitlementService(defaultDb);

    const modules = await entitlementService.getEffectiveModules(
      'active-org-id',
      'retail',
      transactionTx,
    );

    expect(modules).toEqual(['pos']);
    expect(defaultDb.calls).toHaveLength(0);
    expect(transactionTx.calls).toHaveLength(2);
  });
});
