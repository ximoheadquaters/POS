import { formatMoney } from './format';

export type ReportRouteId = 'overview' | 'sales' | 'products';

export interface ReportFilterState {
  from: string;
  to: string;
  branchId?: string;
  section?: ReportRouteId;
}

export interface AlternateUnitLine {
  productName: string;
  quantity: number;
  unit: string;
  baseQuantity: number;
  baseUnit: string;
  revenue: number;
}

export function reportRouteTitle(route: ReportRouteId): string {
  switch (route) {
    case 'overview':
      return 'Executive Overview';
    case 'sales':
      return 'Detailed Sales Report';
    case 'products':
      return 'Product Performance Report';
  }
}

export function buildReportQueryPath(
  route: ReportRouteId,
  filters: ReportFilterState,
): string {
  const params = new URLSearchParams();
  params.set('from', filters.from);
  params.set('to', filters.to);
  if (filters.branchId) params.set('branchId', filters.branchId);
  return `/reports/${route}?${params.toString()}`;
}

export function parseReportFiltersFromSearch(
  search: string,
  allowedBranchIds: string[],
  canViewAllBranches: boolean,
): { filters: ReportFilterState; error: string | null } {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const branchId = params.get('branchId') ?? undefined;
  const sectionParam = params.get('section');
  const section =
    sectionParam === 'overview' || sectionParam === 'sales' || sectionParam === 'products'
      ? sectionParam
      : undefined;

  if (branchId && !canViewAllBranches && !allowedBranchIds.includes(branchId)) {
    return {
      filters: { from, to, section },
      error: 'You do not have access to that branch.',
    };
  }

  return {
    filters: { from, to, branchId, section },
    error: null,
  };
}

export function reportDisplayValue(options: {
  isLoading: boolean;
  hasError: boolean;
  isEmpty: boolean;
  value: number | null | undefined;
  emptyMessage?: string;
  errorMessage?: string;
}): string {
  if (options.isLoading) return 'Loading...';
  if (options.hasError) return options.errorMessage ?? 'We couldn’t load this report. Try again.';
  if (options.isEmpty) return options.emptyMessage ?? 'No sales were recorded for this period.';
  if (options.value == null || !Number.isFinite(options.value)) return formatMoney('0');
  return formatMoney(String(options.value));
}

export function visibleReportCards<T extends { id: string; isSensitive?: boolean }>(
  cards: T[],
  permissions: { canViewCost: boolean; canViewProfit: boolean },
): T[] {
  return cards.filter((card) => {
    if (card.id === 'cogs' || card.id === 'netCost' || card.id === 'unitCost') {
      return permissions.canViewCost;
    }
    if (card.id === 'gross_profit' || card.id === 'gross_margin_percent' || card.id === 'grossProfit') {
      return permissions.canViewProfit;
    }
    return true;
  });
}

export function restrictedValuesHiddenWhileLoading(isLoading: boolean, canView: boolean): boolean {
  return isLoading || !canView;
}

export function detailPresentationMode(screenWidth: number): 'drawer' | 'fullscreen' {
  return screenWidth < 640 ? 'fullscreen' : 'drawer';
}

export function tableScrollMode(screenWidth: number): 'internal-scroll' | 'natural' {
  return screenWidth < 960 ? 'internal-scroll' : 'natural';
}

export function layoutFitsMobileWidth(screenWidth: number): boolean {
  return screenWidth >= 320;
}

export function formatAlternateUnitBreakdown(lines: AlternateUnitLine[]): {
  pieceQuantity: number;
  boxQuantity: number;
  equivalentBaseQuantity: number;
  pieceRevenue: number;
  boxRevenue: number;
  totalRevenue: number;
  displayLabel: string;
} {
  const piece = lines.find((l) => l.unit.toLowerCase() === 'piece');
  const box = lines.find((l) => l.unit.toLowerCase() === 'box');
  const pieceQuantity = piece?.quantity ?? 0;
  const boxQuantity = box?.quantity ?? 0;
  const equivalentBaseQuantity = lines.reduce((acc, line) => acc + line.baseQuantity, 0);
  const pieceRevenue = piece?.revenue ?? 0;
  const boxRevenue = box?.revenue ?? 0;
  const totalRevenue = lines.reduce((acc, line) => acc + line.revenue, 0);
  return {
    pieceQuantity,
    boxQuantity,
    equivalentBaseQuantity,
    pieceRevenue,
    boxRevenue,
    totalRevenue,
    displayLabel: `${pieceQuantity} Piece + ${boxQuantity} Box (${equivalentBaseQuantity} equivalent Pieces)`,
  };
}

export function sanitizeReportNumber(value: number): number {
  if (!Number.isFinite(value) || Number.isNaN(value)) return 0;
  return value;
}

export function sanitizeReportDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  return value;
}

export function formatSafeCurrency(value: number): string {
  return formatMoney(String(sanitizeReportNumber(value)));
}

export function kpiOpensDrillDown(card: { drillDownAvailable?: boolean }): boolean {
  return Boolean(card.drillDownAvailable);
}

export function chartClickAppliesFilter(
  current: ReportFilterState,
  nextFilterKey: 'categoryId' | 'branchId',
  nextValue: string,
): ReportFilterState {
  return {
    ...current,
    [nextFilterKey]: nextValue,
  } as ReportFilterState;
}

export function retainActiveFilters(
  previous: ReportFilterState,
  next: Partial<ReportFilterState>,
): ReportFilterState {
  return {
    from: next.from ?? previous.from,
    to: next.to ?? previous.to,
    branchId: next.branchId ?? previous.branchId,
    section: next.section ?? previous.section,
  };
}
