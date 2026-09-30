import { describe, expect, it } from 'vitest';
import { requireReportsWorkspace } from './reports-workspace-guard';

describe('report workspace response guard', () => {
  it('rejects a partial response before report rendering', () => {
    expect(() => requireReportsWorkspace(null)).toThrow('empty');
    expect(() => requireReportsWorkspace({ kpis: {} })).toThrow('incomplete');
  });

  it('rejects missing lists instead of letting report views call map on undefined', () => {
    expect(() =>
      requireReportsWorkspace({
        kpis: {},
        sales: { paymentMethods: [] },
        inventory: {},
        purchasing: {},
        profit: {},
        cash: {},
      }),
    ).toThrow('missing');
  });

  it('accepts the required report structure', () => {
    const report = {
      kpis: {},
      sales: { paymentMethods: [], topProducts: [], topCategories: [], branches: [], trend: [] },
      inventory: { lowStock: [], byCategory: [], movements: [] },
      purchasing: { orderStatuses: [], topSuppliers: [] },
      profit: { trend: [] },
      cash: {},
    };
    expect(requireReportsWorkspace(report)).toBe(report);
  });
});
