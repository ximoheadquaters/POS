import type { ReportsWorkspace } from './report-types';

/** A stale or partial API response must produce the report error state, not a render exception. */
export function requireReportsWorkspace(value: unknown): ReportsWorkspace {
  if (!value || typeof value !== 'object') {
    throw new Error('The reports response is empty. Please retry.');
  }
  const report = value as Partial<ReportsWorkspace>;
  const requiredSections = ['kpis', 'sales', 'inventory', 'purchasing', 'profit', 'cash'] as const;
  if (requiredSections.some((key) => !report[key] || typeof report[key] !== 'object')) {
    throw new Error('The reports response is incomplete. Please retry or contact support.');
  }
  const arrays: unknown[] = [
    report.sales?.paymentMethods,
    report.sales?.topProducts,
    report.sales?.topCategories,
    report.sales?.branches,
    report.sales?.trend,
    report.inventory?.lowStock,
    report.inventory?.byCategory,
    report.inventory?.movements,
    report.purchasing?.orderStatuses,
    report.purchasing?.topSuppliers,
    report.profit?.trend,
  ];
  if (arrays.some((item) => !Array.isArray(item))) {
    throw new Error('Some report data is missing. Please retry or contact support.');
  }
  return report as ReportsWorkspace;
}
