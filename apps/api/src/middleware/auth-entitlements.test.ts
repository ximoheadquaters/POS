import { describe, expect, it } from 'vitest';
import { pruneDisabledDependentModules, requireModule, requirePermission } from './auth.js';
import type { ModuleCode } from '@ximo/shared';

describe('pruneDisabledDependentModules', () => {
  it('prunes dependent modules if required parent modules are missing', () => {
    // recipes requires ['ingredients', 'products', 'inventory']
    // prepared_food requires ['recipes']
    // If ingredients is missing, both recipes and prepared_food must be pruned!
    const modules: ModuleCode[] = ['dashboard', 'pos', 'products', 'inventory', 'recipes', 'prepared_food'];
    const result = pruneDisabledDependentModules(modules);
    expect(result).toEqual(['dashboard', 'pos', 'products', 'inventory']);
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
    const result = pruneDisabledDependentModules(modules);
    expect(result).toEqual(modules);
  });

  it('prunes production if inventory is missing', () => {
    // production requires ['inventory']
    const modules: ModuleCode[] = ['dashboard', 'products', 'production'];
    const result = pruneDisabledDependentModules(modules);
    expect(result).toEqual(['dashboard', 'products']);
  });

  it('prunes held_sales if pos is missing', () => {
    // held_sales requires ['pos']
    const modules: ModuleCode[] = ['dashboard', 'held_sales'];
    const result = pruneDisabledDependentModules(modules);
    expect(result).toEqual(['dashboard']);
  });
});

describe('requireModule middleware', () => {
  it('returns 403 MODULE_DISABLED when production module is disabled', () => {
    const middleware = requireModule('production');
    let capturedError: any = null;
    const req: any = {
      authUser: {
        modules: ['inventory', 'products'],
        permissions: ['inventory:adjust'],
      },
    };
    const res: any = {};
    const next = (err?: any) => {
      capturedError = err;
    };
    middleware(req, res, next);
    expect(capturedError).toBeDefined();
    expect(capturedError?.status).toBe(403);
    expect(capturedError?.code).toBe('MODULE_DISABLED');
  });

  it('returns permission error when permission is missing even if module is enabled', () => {
    const middleware = requirePermission('inventory:adjust');
    let capturedError: any = null;
    const req: any = {
      authUser: {
        modules: ['inventory', 'products', 'production'],
        permissions: ['inventory:read'],
      },
    };
    const res: any = {};
    const next = (err?: any) => {
      capturedError = err;
    };
    middleware(req, res, next);
    expect(capturedError).toBeDefined();
    expect(capturedError?.status).toBe(403);
    expect(capturedError?.code).toBe('PERMISSION_DENIED');
  });
});
