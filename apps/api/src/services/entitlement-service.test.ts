import type { QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { ModuleCode } from '@ximo/shared';
import type { Queryable } from '../database/types.js';
import { result } from '../test/fakes.js';
import {
  EntitlementService,
  pruneDisabledDependentModules,
} from './entitlement-service.js';

class MockQueryable implements Queryable {
  public readonly calls: Array<{ text: string; values?: readonly unknown[] }> = [];

  constructor(private readonly mockRows: Array<{ code: string }> = []) {}

  async query<T extends QueryResultRow>(text: string, values?: readonly unknown[]) {
    this.calls.push(values ? { text, values } : { text });
    return result(this.mockRows as unknown as T[]);
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
});

describe('EntitlementService', () => {
  it('returns zero modules [] when an organization has no active or trialing subscription', async () => {
    // Query returns empty array because current_sub join fails
    const mockDb = new MockQueryable([]);
    const entitlementService = new EntitlementService(mockDb);

    const modules = await entitlementService.getEffectiveModules('no-sub-org-id');
    expect(modules).toEqual([]);
    expect(mockDb.calls).toHaveLength(1);
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
    expect(transactionTx.calls).toHaveLength(1);
  });
});
