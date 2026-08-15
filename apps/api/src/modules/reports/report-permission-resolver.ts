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
  // Workspace requests already send exact ISO boundaries. Re-parsing an ISO
  // timestamp as YYYY-MM-DD previously turned the day into NaN (for example,
  // "13T16:00:00.000Z") and caused every report query to fail.
  if (dateStr.includes('T')) {
    const instant = new Date(dateStr);
    if (!Number.isNaN(instant.getTime())) return instant;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return new Date(Number.NaN);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcGuess = new Date(Date.UTC(year, month - 1, day));

  // Convert the store's local midnight into an exact UTC instant. This keeps
  // grouping and range boundaries aligned with the configured store timezone.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: _timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(utcGuess);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value ?? 0);
  const representedAsUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  const timezoneOffset = representedAsUtc - utcGuess.getTime();
  return new Date(utcGuess.getTime() - timezoneOffset);
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
  // Date-only filters are inclusive through the selected end date. Exact ISO
  // timestamps are already explicit boundaries and must not gain another day.
  if (!query.to.includes('T')) endDate.setUTCDate(endDate.getUTCDate() + 1);

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
