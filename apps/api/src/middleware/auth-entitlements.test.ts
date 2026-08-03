import { describe, expect, it } from 'vitest';
import { pruneDisabledDependentModules } from './auth.js';
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

  it('prunes production if inventory or recipes is missing', () => {
    // production requires ['recipes', 'inventory']
    const modules: ModuleCode[] = ['dashboard', 'products', 'inventory', 'production'];
    const result = pruneDisabledDependentModules(modules);
    expect(result).toEqual(['dashboard', 'products', 'inventory']);
  });

  it('prunes held_sales if pos is missing', () => {
    // held_sales requires ['pos']
    const modules: ModuleCode[] = ['dashboard', 'held_sales'];
    const result = pruneDisabledDependentModules(modules);
    expect(result).toEqual(['dashboard']);
  });
});
