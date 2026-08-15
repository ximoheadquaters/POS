import { describe, expect, it } from 'vitest';
import type { CurrentUser } from '@ximo/shared';
import type { QueryResult, QueryResultRow } from 'pg';
import type { Database } from '../../database/types.js';
import { requirePermission } from '../../middleware/auth.js';
import { calculateLine } from '../../sales/checkout-service.js';
import { minorToMoney } from '@ximo/shared';
import { resolveReportScope } from './report-permission-resolver.js';
import { OverviewReportService } from './services/overview-report-service.js';
import { SalesReportService } from './services/sales-report-service.js';
import { ProductPerformanceReportService } from './services/product-performance-report-service.js';
import { TransactionDetailService } from './services/transaction-detail-service.js';

const orgId = 'org-11111111-1111-4111-8111-111111111111';
const branchMain = 'branch-1111';
const branchOther = 'branch-2222';

const mockOwner: CurrentUser = {
  id: 'user-owner-id',
  email: 'owner@ximo.test',
  displayName: 'Owner User',
  role: 'owner',
  organization: {
    id: orgId,
    name: 'Ximo Retail Store',
    currency: 'PHP',
    timezone: 'Asia/Manila',
    businessProfile: 'retail',
    subscriptionStatus: 'active',
  },
  branches: [
    { id: branchMain, name: 'Main Branch', code: 'MAIN' },
    { id: branchOther, name: 'Secondary Branch', code: 'SEC' },
  ],
  modules: ['dashboard', 'inventory', 'purchasing', 'recipes'],
  permissions: [
    'reports:read',
    'reports:view_cost',
    'reports:view_profit',
    'reports:view_all_branches',
    'reports:export',
  ],
};

const mockManager: CurrentUser = {
  ...mockOwner,
  id: 'user-manager-id',
  role: 'manager',
  branches: [{ id: branchMain, name: 'Main Branch', code: 'MAIN' }],
  permissions: ['reports:read'],
};

const mockGraceOwner: CurrentUser = {
  ...mockOwner,
  organization: {
    ...mockOwner.organization,
    subscriptionStatus: 'past_due',
  },
};

interface CapturedQuery {
  sql: string;
  values: readonly unknown[] | undefined;
}

class RecordingReportDatabase implements Database {
  readonly queries: CapturedQuery[] = [];
  zeroTransactions = false;
  foreignBranchSale = false;
  pageAwareTotals = {
    merchandiseSubtotal: '700.00',
    discounts: '0.00',
    taxesCollected: '0.00',
    finalSales: '700.00',
    customerRefunds: '40.00',
    netSalesAfterRefunds: '660.00',
    transactions: 2,
    averageTransactionValue: '350.00',
    averageNetRevenuePerTransaction: '330.00',
    sellingUnitsSold: 5,
    equivalentBaseUnitsSold: 38,
    cogs: '200.00',
    grossProfit: '460.00',
    grossMarginPercent: '69.70',
    productsSold: 1,
    productRevenue: '700.00',
    productDiscounts: '0.00',
    productRefunds: '40.00',
    netProductSales: '660.00',
  };

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    const sql = text.replace(/\s+/g, ' ').trim();
    this.queries.push({ sql, values });
    let rows: T[] = [];

    if (sql.includes('where s.id = $1')) {
      if (values?.[0] === 'foreign-sale-id') {
        rows = [];
      } else if (this.foreignBranchSale) {
        rows = [
          {
            id: 'sale-foreign-branch',
            receiptNumber: 'SEC-1',
            completedAt: '2026-08-06T10:00:00.000Z',
            status: 'completed',
            branchId: branchOther,
            branchName: 'Secondary Branch',
            registerName: 'Reg',
            shiftId: null,
            cashierName: 'Cashier',
            customerName: null,
            subtotal: '40.00',
            discountTotal: '0.00',
            taxTotal: '0.00',
            total: '40.00',
            refundTotal: '0.00',
            netTotal: '40.00',
          } as unknown as T,
        ];
      } else {
        rows = [
          {
            id: 'sale-water',
            receiptNumber: 'MAIN-WATER-0001',
            completedAt: '2026-08-06T10:00:00.000Z',
            status: 'completed',
            branchId: branchMain,
            branchName: 'Main Branch',
            registerName: 'Main Register',
            shiftId: 'shift-1',
            cashierName: 'Owner User',
            customerName: null,
            subtotal: '700.00',
            discountTotal: '0.00',
            taxTotal: '0.00',
            total: '700.00',
            refundTotal: '0.00',
            netTotal: '700.00',
          } as unknown as T,
        ];
      }
    } else if (sql.includes('from sale_items si') && sql.includes('"sellingUnit"') && sql.includes('where si.sale_id')) {
      rows = [
        {
          id: 'item-piece',
          productName: 'Bottled Water',
          sku: 'WATER',
          sellingUnit: 'piece',
          quantity: 2,
          unitsPerBase: 1,
          baseQuantity: 2,
          baseUnit: 'piece',
          unitPrice: '20.00',
          unitCost: '5.00',
          discountTotal: '0.00',
          taxTotal: '0.00',
          lineTotal: '40.00',
          lineProfit: '30.00',
        } as unknown as T,
        {
          id: 'item-box',
          productName: 'Bottled Water',
          sku: 'WATER',
          sellingUnit: 'box',
          quantity: 3,
          unitsPerBase: 12,
          baseQuantity: 36,
          baseUnit: 'piece',
          unitPrice: '220.00',
          unitCost: '50.00',
          discountTotal: '0.00',
          taxTotal: '0.00',
          lineTotal: '660.00',
          lineProfit: '510.00',
        } as unknown as T,
      ];
    } else if (sql.includes('from payments where sale_id')) {
      rows = [
        { method: 'cash', amount: '300.00', reference: null } as unknown as T,
        { method: 'card', amount: '400.00', reference: 'AUTH-1' } as unknown as T,
      ];
    } else if (sql.includes('with scoped_sales as') && sql.includes('merchandiseSubtotal')) {
      if (this.zeroTransactions) {
        rows = [
          {
            merchandiseSubtotal: '0.00',
            discounts: '0.00',
            taxesCollected: '0.00',
            finalSales: '0.00',
            customerRefunds: '0.00',
            netSalesAfterRefunds: '0.00',
            transactions: 0,
            averageTransactionValue: '0.00',
            averageNetRevenuePerTransaction: '0.00',
            sellingUnitsSold: 0,
            equivalentBaseUnitsSold: 0,
            cogs: '0.00',
            grossProfit: '0.00',
            grossMarginPercent: '0.00',
          } as unknown as T,
        ];
      } else {
        rows = [this.pageAwareTotals as unknown as T];
      }
    } else if (sql.includes('from sale_items si') && sql.includes('productsSold')) {
      rows = [this.pageAwareTotals as unknown as T];
    } else if (sql.includes('from sales s') && sql.includes('receiptNumber')) {
      rows = [
        {
          id: 'sale-water',
          receiptNumber: 'MAIN-WATER-0001',
          completedAt: '2026-08-06T10:00:00.000Z',
          branchName: 'Main Branch',
          cashierName: 'Owner User',
          subtotal: '700.00',
          discountTotal: '0.00',
          taxTotal: '0.00',
          total: '700.00',
          refundTotal: '0.00',
          netTotal: '700.00',
          status: 'completed',
          paymentMethod: 'cash, card',
          itemCount: 2,
          sellingUnitsSold: 5,
          baseUnitsSold: 38,
          saleCost: '200.00',
          saleProfit: '500.00',
        } as unknown as T,
      ];
    } else if (sql.includes('as "totalRows"')) {
      rows = [{ totalRows: 1 } as unknown as T];
    } else if (sql.includes('group by p.id') || (sql.includes('"sellingUnit"') && sql.includes('si.product_name'))) {
      rows = [
        {
          id: 'prod-water',
          name: 'Bottled Water',
          sku: 'WATER',
          categoryName: 'Beverages',
          sellingUnit: 'piece',
          baseUnit: 'piece',
          sellingUnitsSold: 2,
          unitsPerBase: 1,
          baseUnitsSold: 2,
          revenue: '40.00',
          discounts: '0.00',
          netSales: '40.00',
          avgSellingPrice: '20.00',
          cost: '10.00',
          profit: '30.00',
          margin: '75.00',
        } as unknown as T,
        {
          id: 'prod-water',
          name: 'Bottled Water',
          sku: 'WATER',
          categoryName: 'Beverages',
          sellingUnit: 'box',
          baseUnit: 'piece',
          sellingUnitsSold: 3,
          unitsPerBase: 12,
          baseUnitsSold: 36,
          revenue: '660.00',
          discounts: '0.00',
          netSales: '660.00',
          avgSellingPrice: '220.00',
          cost: '150.00',
          profit: '510.00',
          margin: '77.27',
        } as unknown as T,
      ];
    } else if (sql.includes('"branchName"') && sql.includes('"totalSales"')) {
      rows = [{ branchName: 'Main Branch', totalSales: '700.00' } as unknown as T];
    } else if (sql.includes('"categoryName"') && sql.includes('"totalSales"')) {
      rows = [{ categoryName: 'Beverages', totalSales: '700.00' } as unknown as T];
    } else if (sql.includes('to_char(') || sql.includes('extract(hour')) {
      rows = [{ period: '2026-08-06', sales: '700.00', transactions: 1, finalSales: '700.00', refunds: '40.00', netSales: '660.00', hourOfDay: 10 } as unknown as T];
    } else if (sql.includes('from payments p')) {
      rows = [{ method: 'cash', totalAmount: '300.00' } as unknown as T, { method: 'card', totalAmount: '400.00' } as unknown as T];
    } else if (sql.includes('from branches')) {
      rows = [{ name: 'Main Branch' } as unknown as T];
    } else if (sql.includes('si.product_name as name') && sql.includes('quantity')) {
      rows = [
        { name: 'Bottled Water', quantity: 2, unit: 'piece', sales: '40.00', revenue: '40.00' } as unknown as T,
        { name: 'Bottled Water', quantity: 3, unit: 'box', sales: '660.00', revenue: '660.00' } as unknown as T,
      ];
    } else if (sql.includes('si.product_name as name')) {
      rows = [
        { name: 'Bottled Water', sales: '700.00', revenue: '700.00', quantity: 5, unit: 'piece' } as unknown as T,
      ];
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

  kpiSql(): string {
    return this.queries.find((q) => q.sql.includes('merchandiseSubtotal'))?.sql ?? '';
  }
}

function moneyFromMinor(minor: bigint): number {
  return Number(minorToMoney(minor));
}

describe('Phase F2 Regression — Financial Formulas', () => {
  it('1. Tax-exclusive sale stores subtotal + tax = total without embedding tax in subtotal', () => {
    const line = calculateLine('100.00', '40.00', 1, '12', false);
    expect(moneyFromMinor(line.subtotal)).toBe(100);
    expect(moneyFromMinor(line.tax)).toBe(12);
    expect(moneyFromMinor(line.total)).toBe(112);
    expect(moneyFromMinor(line.total)).toBe(moneyFromMinor(line.subtotal) + moneyFromMinor(line.tax));
  });

  it('2. Tax-inclusive sale extracts tax from base so total equals the charged price', () => {
    const line = calculateLine('112.00', '40.00', 1, '12', true);
    expect(moneyFromMinor(line.total)).toBe(112);
    expect(moneyFromMinor(line.subtotal) + moneyFromMinor(line.tax)).toBe(112);
    expect(moneyFromMinor(line.subtotal)).toBe(100);
    expect(moneyFromMinor(line.tax)).toBe(12);
  });

  it('3. Mixed inclusive and exclusive items aggregate without re-taxing stored line totals', () => {
    const exclusive = calculateLine('100.00', '40.00', 1, '12', false);
    const inclusive = calculateLine('112.00', '40.00', 1, '12', true);
    const merchandiseSubtotal = moneyFromMinor(exclusive.subtotal) + moneyFromMinor(inclusive.subtotal);
    const taxesCollected = moneyFromMinor(exclusive.tax) + moneyFromMinor(inclusive.tax);
    const finalSales = moneyFromMinor(exclusive.total) + moneyFromMinor(inclusive.total);
    expect(merchandiseSubtotal).toBe(200);
    expect(taxesCollected).toBe(24);
    expect(finalSales).toBe(224);
    expect(finalSales).toBe(merchandiseSubtotal + taxesCollected);
  });

  it('4 & 5. Overview SQL sums stored discount_total and tax_total once (no double application)', async () => {
    const db = new RecordingReportDatabase();
    const service = new OverviewReportService(db);
    const scope = resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' });
    await service.generate(scope, { from: '2026-08-01', to: '2026-08-06' });
    const sql = db.kpiSql();
    expect(sql).toContain('sum(s.discount_total)');
    expect(sql).toContain('sum(s.tax_total)');
    expect(sql).toContain('sum(s.subtotal)');
    expect(sql).toContain('sum(s.total)');
    expect(sql.match(/sum\(s\.discount_total\)/g)?.length).toBe(1);
    expect(sql.match(/sum\(s\.tax_total\)/g)?.length).toBe(1);
  });

  it('6. Partial refund reduces net sales by refund amount only', async () => {
    const db = new RecordingReportDatabase();
    db.pageAwareTotals = {
      ...db.pageAwareTotals,
      finalSales: '1020.00',
      customerRefunds: '120.00',
      netSalesAfterRefunds: '900.00',
    };
    const report = await new OverviewReportService(db).generate(
      resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' }),
      { from: '2026-08-01', to: '2026-08-06' },
    );
    const finalSales = Number(report.summaryCards.find((c) => c.cardId === 'final_sales')?.value);
    const refunds = Number(report.summaryCards.find((c) => c.cardId === 'customer_refunds')?.value);
    const net = Number(report.summaryCards.find((c) => c.cardId === 'net_sales_after_refunds')?.value);
    expect(refunds).toBe(120);
    expect(net).toBe(finalSales - refunds);
  });

  it('7. Full refund drives net sales to zero while keeping final sales', async () => {
    const db = new RecordingReportDatabase();
    db.pageAwareTotals = {
      ...db.pageAwareTotals,
      finalSales: '700.00',
      customerRefunds: '700.00',
      netSalesAfterRefunds: '0.00',
      transactions: 1,
      averageTransactionValue: '700.00',
      averageNetRevenuePerTransaction: '0.00',
    };
    const report = await new OverviewReportService(db).generate(
      resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' }),
      { from: '2026-08-01', to: '2026-08-06' },
    );
    expect(report.summaryCards.find((c) => c.cardId === 'final_sales')?.value).toBe(700);
    expect(report.summaryCards.find((c) => c.cardId === 'customer_refunds')?.value).toBe(700);
    expect(report.summaryCards.find((c) => c.cardId === 'net_sales_after_refunds')?.value).toBe(0);
    expect(report.summaryCards.find((c) => c.cardId === 'transactions')?.value).toBe(1);
  });

  it('8. July sale returned in August scopes sales by completed_at and refunds by return created_at', async () => {
    const db = new RecordingReportDatabase();
    await new OverviewReportService(db).generate(
      resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-31' }),
      { from: '2026-08-01', to: '2026-08-31' },
    );
    const sql = db.kpiSql();
    expect(sql).toMatch(/s\.completed_at\s*>=\s*\$2\s*and\s*s\.completed_at\s*<\s*\$3/);
    expect(sql).toMatch(/r\.created_at\s*>=\s*\$2\s*and\s*r\.created_at\s*<\s*\$3/);
  });

  it('9 & 10. August refund reverses COGS using original sale_item unit_cost', async () => {
    const db = new RecordingReportDatabase();
    await new OverviewReportService(db).generate(
      resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-31' }),
      { from: '2026-08-01', to: '2026-08-31' },
    );
    const sql = db.kpiSql();
    expect(sql).toContain('ri.quantity * si.unit_cost');
    expect(sql).toContain('si.quantity * si.unit_cost');
    expect(sql).not.toMatch(/products\.(average_cost|cost|avg_cost)/i);
  });

  it('11. Current product average cost is ignored by report COGS SQL', async () => {
    const db = new RecordingReportDatabase();
    await new OverviewReportService(db).generate(
      resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' }),
      { from: '2026-08-01', to: '2026-08-06' },
    );
    const allSql = db.queries.map((q) => q.sql).join('\n');
    expect(allSql).not.toMatch(/average_cost/);
    expect(allSql).toContain('si.unit_cost');
  });

  it('12 & 13. Void and cancelled sales are excluded from scoped sales status filter', async () => {
    const db = new RecordingReportDatabase();
    await new OverviewReportService(db).generate(
      resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' }),
      { from: '2026-08-01', to: '2026-08-06' },
    );
    const sql = db.kpiSql();
    expect(sql).toContain("status in ('completed','partially_refunded','refunded')");
    expect(sql).not.toContain("'void'");
    expect(sql).not.toContain("'cancelled'");
  });

  it('14. Split tender still counts one distinct transaction in SQL', async () => {
    const db = new RecordingReportDatabase();
    await new OverviewReportService(db).generate(
      resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' }),
      { from: '2026-08-01', to: '2026-08-06' },
    );
    expect(db.kpiSql()).toContain('count(distinct s.id)');
  });

  it('15. Fully refunded sale remains one transaction via refunded status inclusion', async () => {
    const db = new RecordingReportDatabase();
    await new OverviewReportService(db).generate(
      resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' }),
      { from: '2026-08-01', to: '2026-08-06' },
    );
    expect(db.kpiSql()).toContain("'refunded'");
  });

  it('16 & 17. Zero-transaction averages return zero and never Infinity', async () => {
    const db = new RecordingReportDatabase();
    db.zeroTransactions = true;
    const report = await new OverviewReportService(db).generate(
      resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' }),
      { from: '2026-08-01', to: '2026-08-06' },
    );
    const atv = Number(report.summaryCards.find((c) => c.cardId === 'average_transaction_value')?.value);
    const netAtv = Number(report.summaryCards.find((c) => c.cardId === 'average_net_revenue')?.value);
    const margin = Number(report.summaryCards.find((c) => c.cardId === 'gross_margin_percent')?.value);
    expect(atv).toBe(0);
    expect(netAtv).toBe(0);
    expect(margin).toBe(0);
    expect(Number.isFinite(atv)).toBe(true);
    expect(Number.isFinite(netAtv)).toBe(true);
    expect(Number.isFinite(margin)).toBe(true);
    expect(db.kpiSql()).toContain("else '0.00'");
  });

  it('18. End date is exclusive (to + 1 day in ISO bounds)', () => {
    const scope = resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' });
    expect(scope.fromIso).toBe('2026-07-31T16:00:00.000Z');
    expect(scope.toIso).toBe('2026-08-06T16:00:00.000Z');
  });

  it('19. Organization timezone is passed into period grouping queries', async () => {
    const db = new RecordingReportDatabase();
    await new OverviewReportService(db).generate(
      resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' }),
      { from: '2026-08-01', to: '2026-08-06' },
    );
    const trend = db.queries.find((q) => q.sql.includes('to_char') && q.sql.includes('at time zone'));
    expect(trend).toBeDefined();
    expect(trend?.values?.at(-1)).toBe('Asia/Manila');
  });
});

describe('Phase F2 Regression — Authorization', () => {
  it('1. Unauthenticated report request is rejected by requirePermission', () => {
    const middleware = requirePermission('reports:read');
    let captured: { status?: number } | undefined;
    middleware({ authUser: undefined } as never, {} as never, (err?: unknown) => {
      captured = err as { status?: number };
    });
    expect(captured?.status).toBe(401);
  });

  it('2. Foreign organization is enforced via organization_id bind in report SQL', async () => {
    const db = new RecordingReportDatabase();
    const scope = resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' });
    await new OverviewReportService(db).generate(scope, { from: '2026-08-01', to: '2026-08-06' });
    expect(scope.organizationId).toBe(orgId);
    expect(db.kpiSql()).toContain('organization_id=$1');
    expect(db.queries[0]?.values?.[0]).toBe(orgId);
  });

  it('3. Foreign branch filter is rejected for unauthorized manager', () => {
    expect(() =>
      resolveReportScope(mockManager, {
        from: '2026-08-01',
        to: '2026-08-06',
        branchId: 'branch-9999-unauthorized',
      }),
    ).toThrow();
  });

  it('4. Branch manager allowed branch ids are limited to assigned branches', () => {
    const scope = resolveReportScope(mockManager, { from: '2026-08-01', to: '2026-08-06' });
    expect(scope.allowedBranchIds).toEqual([branchMain]);
    expect(scope.hasAllBranchesAccess).toBe(false);
  });

  it('5. Authorized owner can access organization branches via reports:view_all_branches', () => {
    const scope = resolveReportScope(mockOwner, {
      from: '2026-08-01',
      to: '2026-08-06',
      branchId: branchOther,
    });
    expect(scope.branchId).toBe(branchOther);
    expect(scope.hasAllBranchesAccess).toBe(true);
  });

  it('6. COGS absent without reports:view_cost', async () => {
    const db = new RecordingReportDatabase();
    const report = await new OverviewReportService(db).generate(
      resolveReportScope(mockManager, { from: '2026-08-01', to: '2026-08-06' }),
      { from: '2026-08-01', to: '2026-08-06' },
    );
    expect(report.summaryCards.find((c) => c.cardId === 'cogs')).toBeUndefined();
  });

  it('7. Profit absent without reports:view_profit', async () => {
    const db = new RecordingReportDatabase();
    const report = await new OverviewReportService(db).generate(
      resolveReportScope(mockManager, { from: '2026-08-01', to: '2026-08-06' }),
      { from: '2026-08-01', to: '2026-08-06' },
    );
    expect(report.summaryCards.find((c) => c.cardId === 'gross_profit')).toBeUndefined();
    expect(report.summaryCards.find((c) => c.cardId === 'gross_margin_percent')).toBeUndefined();
  });

  it('8. Transaction detail rejects foreign-tenant sale', async () => {
    const db = new RecordingReportDatabase();
    const scope = resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' });
    await expect(new TransactionDetailService(db).getTransactionDetail(scope, 'foreign-sale-id')).rejects.toThrow();
    const saleQuery = db.queries.find((q) => q.sql.includes('where s.id = $1'));
    expect(saleQuery?.sql).toContain('organization_id = $2');
    expect(saleQuery?.values?.[1]).toBe(orgId);
  });

  it('9. Transaction detail rejects unauthorized branch sale for branch-scoped manager', async () => {
    const db = new RecordingReportDatabase();
    db.foreignBranchSale = true;
    const scope = resolveReportScope(mockManager, {
      from: '2026-08-01',
      to: '2026-08-06',
      branchId: branchMain,
    });
    await expect(
      new TransactionDetailService(db).getTransactionDetail(scope, 'sale-foreign-branch'),
    ).rejects.toThrow();
  });

  it('10. Suspended organization blocked', () => {
    const suspended: CurrentUser = {
      ...mockOwner,
      organization: { ...mockOwner.organization, subscriptionStatus: 'suspended' },
    };
    expect(() => resolveReportScope(suspended, { from: '2026-08-01', to: '2026-08-06' })).toThrow();
  });

  it('11. Grace organization (past_due) allowed', () => {
    const scope = resolveReportScope(mockGraceOwner, { from: '2026-08-01', to: '2026-08-06' });
    expect(scope.organizationId).toBe(orgId);
  });
});

describe('Phase F2 Regression — Alternate Units & Card Equality', () => {
  it('Bottled Water Piece/Box case: 2 pieces + 3 boxes = 38 base pieces and ₱700 revenue', async () => {
    const db = new RecordingReportDatabase();
    const detail = await new TransactionDetailService(db).getTransactionDetail(
      resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' }),
      'sale-water',
    );
    const piece = detail.items.find((i) => i.sellingUnit === 'piece');
    const box = detail.items.find((i) => i.sellingUnit === 'box');
    expect(piece?.quantity).toBe(2);
    expect(box?.quantity).toBe(3);
    expect((piece?.baseQuantity ?? 0) + (box?.baseQuantity ?? 0)).toBe(38);
    expect(piece?.lineTotal).toBe('₱40.00');
    expect(box?.lineTotal).toBe('₱660.00');
    expect(detail.total).toBe('₱700.00');

    const products = await new ProductPerformanceReportService(db).generate(
      resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' }),
      { from: '2026-08-01', to: '2026-08-06' },
    );
    const pieceRow = products.rows.find((r) => r.unit === 'piece');
    const boxRow = products.rows.find((r) => r.unit === 'box');
    expect(pieceRow?.quantity).toBe(2);
    expect(boxRow?.quantity).toBe(3);
    expect((pieceRow?.baseQuantity ?? 0) + (boxRow?.baseQuantity ?? 0)).toBe(38);
    const rowRevenue = products.rows.reduce((acc, row) => acc + Number(row.value.replace(/[^0-9.]/g, '')), 0);
    expect(rowRevenue).toBe(700);
    expect(products.summaryCards.find((c) => c.cardId === 'product_revenue')?.value).toBe(700);
  });

  it('Net Sales card equals Final Sales minus Refunds', async () => {
    const db = new RecordingReportDatabase();
    const report = await new OverviewReportService(db).generate(
      resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' }),
      { from: '2026-08-01', to: '2026-08-06' },
    );
    const finalSales = Number(report.summaryCards.find((c) => c.cardId === 'final_sales')?.value);
    const refunds = Number(report.summaryCards.find((c) => c.cardId === 'customer_refunds')?.value);
    const net = Number(report.summaryCards.find((c) => c.cardId === 'net_sales_after_refunds')?.value);
    expect(net).toBe(finalSales - refunds);
  });

  it('Transaction card equals distinct completed sales count from KPI SQL contract', async () => {
    const db = new RecordingReportDatabase();
    const report = await new OverviewReportService(db).generate(
      resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' }),
      { from: '2026-08-01', to: '2026-08-06' },
    );
    expect(report.summaryCards.find((c) => c.cardId === 'transactions')?.value).toBe(2);
    expect(db.kpiSql()).toContain('count(distinct s.id)');
  });

  it('Category and branch chart values equal supporting series drill-down data', async () => {
    const db = new RecordingReportDatabase();
    const report = await new OverviewReportService(db).generate(
      resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' }),
      { from: '2026-08-01', to: '2026-08-06' },
    );
    const branchSeries = report.series.find((s) => s.seriesId === 'sales_by_branch');
    const categorySeries = report.series.find((s) => s.seriesId === 'sales_by_category');
    expect(branchSeries?.data[0]?.y).toBe(700);
    expect(categorySeries?.data[0]?.y).toBe(700);
  });

  it('Pagination does not alter summary totals (summary query has no limit/offset)', async () => {
    const db = new RecordingReportDatabase();
    const page1 = await new SalesReportService(db).generate(
      resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' }),
      { from: '2026-08-01', to: '2026-08-06', page: 1, pageSize: 10 },
    );
    const page2Db = new RecordingReportDatabase();
    const page2 = await new SalesReportService(page2Db).generate(
      resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' }),
      { from: '2026-08-01', to: '2026-08-06', page: 2, pageSize: 10 },
    );
    expect(page1.summaryCards.find((c) => c.cardId === 'final_sales')?.value).toBe(
      page2.summaryCards.find((c) => c.cardId === 'final_sales')?.value,
    );
    const summarySql = db.queries.find((q) => q.sql.includes('merchandiseSubtotal'))?.sql ?? '';
    expect(summarySql).not.toMatch(/limit\s+\$/i);
    expect(summarySql).not.toMatch(/offset\s+\$/i);
  });

  it('Split payments do not duplicate sale total in transaction detail', async () => {
    const db = new RecordingReportDatabase();
    const detail = await new TransactionDetailService(db).getTransactionDetail(
      resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' }),
      'sale-water',
    );
    expect(detail.payments).toHaveLength(2);
    expect(detail.total).toBe('₱700.00');
    const paymentSum = detail.payments.reduce((acc, p) => acc + Number(p.amount.replace(/[^0-9.]/g, '')), 0);
    expect(paymentSum).toBe(700);
  });
});
