import { describe, expect, it } from 'vitest';
import {
  buildReportQueryPath,
  chartClickAppliesFilter,
  detailPresentationMode,
  formatAlternateUnitBreakdown,
  formatSafeCurrency,
  kpiOpensDrillDown,
  layoutFitsMobileWidth,
  parseReportFiltersFromSearch,
  reportDisplayValue,
  reportRouteTitle,
  restrictedValuesHiddenWhileLoading,
  retainActiveFilters,
  sanitizeReportDate,
  sanitizeReportNumber,
  tableScrollMode,
  visibleReportCards,
} from './reports-f2-client';

describe('Phase F2 Client Reporting Unit Suite', () => {
  it('Overview route title', () => {
    expect(reportRouteTitle('overview')).toBe('Executive Overview');
  });

  it('Sales route title', () => {
    expect(reportRouteTitle('sales')).toBe('Detailed Sales Report');
  });

  it('Product Performance route title', () => {
    expect(reportRouteTitle('products')).toBe('Product Performance Report');
  });

  it('loading state does not flash zero', () => {
    expect(
      reportDisplayValue({ isLoading: true, hasError: false, isEmpty: false, value: 0 }),
    ).toBe('Loading...');
  });

  it('empty state renders clear message', () => {
    expect(
      reportDisplayValue({ isLoading: false, hasError: false, isEmpty: true, value: null }),
    ).toBe('No sales were recorded for this period.');
  });

  it('safe error state omits SQL and stack traces', () => {
    const message = reportDisplayValue({
      isLoading: false,
      hasError: true,
      isEmpty: false,
      value: null,
    });
    expect(message).toBe('We couldn’t load this report. Try again.');
    expect(message).not.toContain('SELECT');
    expect(message).not.toContain('Error:');
  });

  it('cost and profit cards hidden without permission', () => {
    const cards = visibleReportCards(
      [
        { id: 'final_sales' },
        { id: 'cogs', isSensitive: true },
        { id: 'gross_profit', isSensitive: true },
      ],
      { canViewCost: false, canViewProfit: false },
    );
    expect(cards.map((c) => c.id)).toEqual(['final_sales']);
  });

  it('restricted values do not flash during loading', () => {
    expect(restrictedValuesHiddenWhileLoading(true, false)).toBe(true);
    expect(restrictedValuesHiddenWhileLoading(false, false)).toBe(true);
    expect(restrictedValuesHiddenWhileLoading(false, true)).toBe(false);
  });

  it('date filter updates query path', () => {
    expect(buildReportQueryPath('overview', { from: '2026-08-01', to: '2026-08-06' })).toBe(
      '/reports/overview?from=2026-08-01&to=2026-08-06',
    );
  });

  it('branch filter updates query path', () => {
    expect(
      buildReportQueryPath('sales', {
        from: '2026-08-01',
        to: '2026-08-06',
        branchId: 'branch-1',
      }),
    ).toContain('branchId=branch-1');
  });

  it('unauthorized branch URL fails safely', () => {
    const parsed = parseReportFiltersFromSearch(
      '?from=2026-08-01&to=2026-08-06&branchId=foreign-branch',
      ['branch-1'],
      false,
    );
    expect(parsed.error).toBe('You do not have access to that branch.');
    expect(parsed.filters.branchId).toBeUndefined();
  });

  it('refresh restores filters from search params', () => {
    const parsed = parseReportFiltersFromSearch(
      '?from=2026-08-01&to=2026-08-06&branchId=branch-1&section=sales',
      ['branch-1'],
      true,
    );
    expect(parsed.filters).toEqual({
      from: '2026-08-01',
      to: '2026-08-06',
      branchId: 'branch-1',
      section: 'sales',
    });
  });

  it('browser history restores filters from search string', () => {
    const parsed = parseReportFiltersFromSearch(
      'from=2026-07-01&to=2026-07-31&section=products',
      [],
      true,
    );
    expect(parsed.filters.section).toBe('products');
    expect(parsed.filters.from).toBe('2026-07-01');
  });

  it('KPI opens drill-down when available', () => {
    expect(kpiOpensDrillDown({ drillDownAvailable: true })).toBe(true);
    expect(kpiOpensDrillDown({ drillDownAvailable: false })).toBe(false);
  });

  it('desktop drawer presentation', () => {
    expect(detailPresentationMode(1280)).toBe('drawer');
  });

  it('mobile full-screen detail presentation', () => {
    expect(detailPresentationMode(320)).toBe('fullscreen');
  });

  it('chart click filtering updates active filter state', () => {
    const next = chartClickAppliesFilter(
      { from: '2026-08-01', to: '2026-08-06' },
      'branchId',
      'branch-main',
    );
    expect(next.branchId).toBe('branch-main');
  });

  it('transaction row detail retains active filters', () => {
    const retained = retainActiveFilters(
      { from: '2026-08-01', to: '2026-08-06', branchId: 'branch-1', section: 'sales' },
      { section: 'sales' },
    );
    expect(retained.branchId).toBe('branch-1');
    expect(retained.from).toBe('2026-08-01');
  });

  it('Piece and Box remain separate with 38 equivalent Pieces', () => {
    const breakdown = formatAlternateUnitBreakdown([
      {
        productName: 'Bottled Water',
        quantity: 2,
        unit: 'piece',
        baseQuantity: 2,
        baseUnit: 'piece',
        revenue: 40,
      },
      {
        productName: 'Bottled Water',
        quantity: 3,
        unit: 'box',
        baseQuantity: 36,
        baseUnit: 'piece',
        revenue: 660,
      },
    ]);
    expect(breakdown.pieceQuantity).toBe(2);
    expect(breakdown.boxQuantity).toBe(3);
    expect(breakdown.equivalentBaseQuantity).toBe(38);
    expect(breakdown.pieceRevenue).toBe(40);
    expect(breakdown.boxRevenue).toBe(660);
    expect(breakdown.totalRevenue).toBe(700);
    expect(breakdown.displayLabel).toContain('2 Piece');
    expect(breakdown.displayLabel).toContain('3 Box');
    expect(breakdown.displayLabel).toContain('38 equivalent Pieces');
  });

  it('no NaN from sanitizeReportNumber', () => {
    expect(sanitizeReportNumber(Number.NaN)).toBe(0);
    expect(sanitizeReportNumber(255)).toBe(255);
  });

  it('no Infinity from sanitizeReportNumber', () => {
    expect(sanitizeReportNumber(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('no Invalid Date from sanitizeReportDate', () => {
    expect(sanitizeReportDate('not-a-date')).toBe('');
    expect(sanitizeReportDate('2026-08-06')).toBe('2026-08-06');
  });

  it('no undefined currency from formatSafeCurrency', () => {
    const formatted = formatSafeCurrency(1020);
    expect(formatted).toBe('₱1,020.00');
    expect(formatted).not.toContain('undefined');
    expect(formatted).not.toContain('NaN');
  });

  it('320 px layout does not overflow baseline', () => {
    expect(layoutFitsMobileWidth(320)).toBe(true);
    expect(detailPresentationMode(320)).toBe('fullscreen');
  });

  it('wide tables scroll internally on narrow viewports', () => {
    expect(tableScrollMode(320)).toBe('internal-scroll');
    expect(tableScrollMode(1400)).toBe('natural');
  });
});
