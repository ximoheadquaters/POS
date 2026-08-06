import type { CurrentUser } from '@ximo/shared';
import { forbidden, notFound } from '../../shared/errors.js';

export interface ReportScopeContext {
  organizationId: string;
  organizationTimezone: string;
  branchId: string | null;
  allowedBranchIds: string[];
  hasAllBranchesAccess: boolean;
  canViewCost: boolean;
  canViewProfit: boolean;
  canExport: boolean;
  canViewStaff: boolean;
  canViewTax: boolean;
  fromIso: string;
  toIso: string;
}

export function dateAtLocalMidnight(dateStr: string, _timezone: string = 'UTC'): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return date;
}

export function resolveReportScope(
  authUser: CurrentUser,
  query: { from: string; to: string; branchId?: string },
): ReportScopeContext {
  if (authUser.organization?.subscriptionStatus === 'suspended') {
    throw forbidden(
      'SUSPENDED_TENANT',
      'Operational reporting is disabled for suspended subscriptions',
    );
  }

  const permissions = authUser.permissions || [];
  const userBranches = (authUser.branches || []).map((b: { id: string }) => b.id);
  const hasAllBranchesAccess =
    permissions.includes('sales:read_all') || permissions.includes('reports:view_all_branches');

  if (
    query.branchId &&
    !hasAllBranchesAccess &&
    !userBranches.includes(query.branchId)
  ) {
    throw notFound('Branch');
  }

  const orgTimezone = authUser.organization?.timezone || 'Asia/Manila';
  const startDate = dateAtLocalMidnight(query.from, orgTimezone);
  const endDate = dateAtLocalMidnight(query.to, orgTimezone);
  endDate.setUTCDate(endDate.getUTCDate() + 1);

  const canViewCost = permissions.includes('reports:view_cost');
  const canViewProfit = permissions.includes('reports:view_profit');
  const canExport = permissions.includes('reports:export');
  const canViewStaff = permissions.includes('reports:view_staff');
  const canViewTax = permissions.includes('reports:view_tax');

  return {
    organizationId: authUser.organization.id,
    organizationTimezone: orgTimezone,
    branchId: query.branchId ?? null,
    allowedBranchIds: userBranches,
    hasAllBranchesAccess,
    canViewCost,
    canViewProfit,
    canExport,
    canViewStaff,
    canViewTax,
    fromIso: startDate.toISOString(),
    toIso: endDate.toISOString(),
  };
}

export function sanitizeReportSensitiveFields<T extends Record<string, any>>(
  data: T,
  canViewCost: boolean,
  canViewProfit: boolean,
): T {
  const sanitized = { ...data };
  const costFields = ['netCost', 'cogs', 'cost', 'unitCost', 'inventoryValue', 'averageCost'];
  const profitFields = ['grossProfit', 'profit', 'grossMarginPercent', 'marginPercent'];

  if (!canViewCost) {
    for (const field of costFields) {
      if (field in sanitized) {
        (sanitized as any)[field] = null;
      }
    }
  }

  if (!canViewProfit) {
    for (const field of profitFields) {
      if (field in sanitized) {
        (sanitized as any)[field] = null;
      }
    }
  }

  return sanitized;
}
