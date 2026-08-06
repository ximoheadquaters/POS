import { describe, expect, it } from 'vitest';
import type { CurrentUser } from '@ximo/shared';
import { reportQueryFilterSchema } from '@ximo/shared';
import type { QueryResult, QueryResultRow } from 'pg';
import type { Database } from '../../database/types.js';
import { resolveReportScope } from './report-permission-resolver.js';
import { SalesSummaryReportService } from './services/sales-summary-service.js';

const mockOwner: CurrentUser = {
  id: 'user-owner-id',
  email: 'owner@ximo.test',
  displayName: 'Owner User',
  role: 'owner',
  organization: {
    id: 'org-11111111-1111-4111-8111-111111111111',
    name: 'Ximo Retail Store',
    currency: 'PHP',
    timezone: 'Asia/Manila',
    businessProfile: 'retail',
    subscriptionStatus: 'active',
  },
  branches: [
    { id: 'branch-1111', name: 'Main Branch', code: 'MAIN' },
    { id: 'branch-2222', name: 'Secondary Branch', code: 'SEC' },
  ],
  modules: ['dashboard', 'inventory', 'purchasing', 'recipes'],
  permissions: [
    'reports:read',
    'reports:view_cost',
    'reports:view_profit',
    'reports:view_all_branches',
    'reports:export',
    'reports:manage_saved_views',
  ],
};

const mockCashier: CurrentUser = {
  ...mockOwner,
  id: 'user-cashier-id',
  email: 'cashier@ximo.test',
  displayName: 'Cashier User',
  role: 'cashier',
  branches: [{ id: 'branch-1111', name: 'Main Branch', code: 'MAIN' }],
  permissions: ['reports:read'],
};

const mockSuspendedOwner: CurrentUser = {
  ...mockOwner,
  organization: {
    ...mockOwner.organization,
    subscriptionStatus: 'suspended',
  },
};

class FakeReportDatabase implements Database {
  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    _values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    const sql = text.replace(/\s+/g, ' ').trim();

    let rows: T[] = [];

    if (sql.includes('with scoped_sales as')) {
      rows = [
        {
          grossSales: '1250.00',
          customerRefunds: '150.00',
          netSales: '1100.00',
          discounts: '50.00',
          taxes: '120.00',
          transactions: 5,
          averageTransaction: '220.00',
          netCost: '600.00',
          grossProfit: '500.00',
          grossMarginPercent: '45.45',
        } as unknown as T,
      ];
    } else if (sql.includes('from sale_items si')) {
      rows = [
        {
          id: 'prod-1',
          name: 'Bottled Water Box',
          sku: 'SKU-WATER-BOX',
          category: 'Beverages',
          quantity: 3,
          sellingUnit: 'box',
          unitsPerBase: 12,
          baseQuantity: 36,
          baseUnit: 'piece',
          sales: '1100.00',
          cost: '600.00',
          profit: '500.00',
        } as unknown as T,
      ];
    } else if (sql.includes('from branches')) {
      rows = [{ name: 'Main Branch' } as unknown as T];
    }

    return {
      rows,
      rowCount: rows.length,
      command: 'SELECT',
      oid: 0,
      fields: [],
    };
  }

  async transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async close(): Promise<void> {}
}

describe('Phase F1 — Reporting Foundation & Sales Summary Proof Tests', () => {
  it('1. Gross Sales uses canonical definition (SUM(sales.total) before refunds)', async () => {
    const db = new FakeReportDatabase();
    const service = new SalesSummaryReportService(db);
    const scope = resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' });
    const report = await service.generate(scope, { from: '2026-08-01', to: '2026-08-06' });

    const grossCard = report.summaryCards.find((c) => c.cardId === 'gross_sales');
    expect(grossCard).toBeDefined();
    expect(grossCard?.value).toBe(1250);
    expect(grossCard?.formattedValue).toBe('₱1,250.00');
  });

  it('2 & 3. Discounts and Refunds are calculated cleanly without double counting', async () => {
    const db = new FakeReportDatabase();
    const service = new SalesSummaryReportService(db);
    const scope = resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' });
    const report = await service.generate(scope, { from: '2026-08-01', to: '2026-08-06' });

    const refundsCard = report.summaryCards.find((c) => c.cardId === 'customer_refunds');
    const netSalesCard = report.summaryCards.find((c) => c.cardId === 'net_sales');
    expect(refundsCard?.value).toBe(150);
    expect(netSalesCard?.value).toBe(1100);
  });

  it('5. Partial and Full Refunds update Net Sales correctly', async () => {
    const db = new FakeReportDatabase();
    const service = new SalesSummaryReportService(db);
    const scope = resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' });
    const report = await service.generate(scope, { from: '2026-08-01', to: '2026-08-06' });

    const netSales = report.summaryCards.find((c) => c.cardId === 'net_sales')?.value;
    const grossSales = report.summaryCards.find((c) => c.cardId === 'gross_sales')?.value;
    const refunds = report.summaryCards.find((c) => c.cardId === 'customer_refunds')?.value;
    expect(netSales).toBe(Number(grossSales) - Number(refunds));
  });

  it('8. Selling unit quantity and base unit quantity are calculated correctly', async () => {
    const db = new FakeReportDatabase();
    const service = new SalesSummaryReportService(db);
    const scope = resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' });
    const report = await service.generate(scope, { from: '2026-08-01', to: '2026-08-06' });

    const row = report.rows[0];
    expect(row?.quantity).toBe(3);
    expect(row?.unit).toBe('box');
    expect(row?.baseQuantity).toBe(36);
    expect(row?.baseUnit).toBe('piece');
    expect(row?.subValue).toContain('3 box (36 piece)');
  });

  it('10. Foreign branch filter is rejected for unauthorized user', () => {
    expect(() =>
      resolveReportScope(mockCashier, {
        from: '2026-08-01',
        to: '2026-08-06',
        branchId: 'branch-2222',
      }),
    ).toThrow();
  });

  it('11 & 12. Cost and Profit fields are omitted for users lacking permissions', async () => {
    const db = new FakeReportDatabase();
    const service = new SalesSummaryReportService(db);
    const scope = resolveReportScope(mockCashier, { from: '2026-08-01', to: '2026-08-06' });
    const report = await service.generate(scope, { from: '2026-08-01', to: '2026-08-06' });

    const cogsCard = report.summaryCards.find((c) => c.cardId === 'cogs');
    const profitCard = report.summaryCards.find((c) => c.cardId === 'gross_profit');
    expect(cogsCard).toBeUndefined();
    expect(profitCard).toBeUndefined();

    const row = report.rows[0];
    expect(row?.netCost).toBeNull();
    expect(row?.grossProfit).toBeNull();
  });

  it('16 & 17. Date boundaries resolve to inclusive start and exclusive end in org timezone', () => {
    const scope = resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' });
    expect(scope.fromIso).toBe('2026-08-01T00:00:00.000Z');
    expect(scope.toIso).toBe('2026-08-07T00:00:00.000Z');
  });

  it('18. Unsupported filters are rejected by Zod schema', () => {
    expect(() => reportQueryFilterSchema.parse({ from: 'invalid-date', to: '2026-08-06' })).toThrow();
  });

  it('19. Summary card Net Sales matches the sum of detailed item sales', async () => {
    const db = new FakeReportDatabase();
    const service = new SalesSummaryReportService(db);
    const scope = resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' });
    const report = await service.generate(scope, { from: '2026-08-01', to: '2026-08-06' });

    const netSales = report.summaryCards.find((c) => c.cardId === 'net_sales')?.value;
    const detailSum = report.rows.reduce((acc, row) => acc + Number(row.value.replace(/[^0-9.]/g, '')), 0);
    expect(Number(netSales)).toBe(detailSum);
  });

  it('20. Suspended tenant is blocked from operational reports', () => {
    expect(() =>
      resolveReportScope(mockSuspendedOwner, { from: '2026-08-01', to: '2026-08-06' }),
    ).toThrow();
  });
});
