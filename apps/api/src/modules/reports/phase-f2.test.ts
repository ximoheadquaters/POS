import { describe, expect, it } from 'vitest';
import type { CurrentUser } from '@ximo/shared';
import type { QueryResult, QueryResultRow } from 'pg';
import type { Database } from '../../database/types.js';
import { resolveReportScope } from './report-permission-resolver.js';
import { OverviewReportService } from './services/overview-report-service.js';
import { SalesReportService } from './services/sales-report-service.js';
import { ProductPerformanceReportService } from './services/product-performance-report-service.js';
import { TransactionDetailService } from './services/transaction-detail-service.js';

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

const mockCashier: CurrentUser = {
  ...mockOwner,
  id: 'user-cashier-id',
  permissions: ['reports:read'],
};

class FakeF2Database implements Database {
  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    _values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    const sql = text.replace(/\s+/g, ' ').trim();

    let rows: T[] = [];

    if (sql.includes('with scoped_sales as') && sql.includes('merchandiseSubtotal')) {
      rows = [
        {
          merchandiseSubtotal: '1000.00',
          discounts: '100.00',
          taxesCollected: '120.00',
          finalSales: '1020.00',
          customerRefunds: '120.00',
          netSalesAfterRefunds: '900.00',
          transactions: 4,
          averageTransactionValue: '255.00',
          averageNetRevenuePerTransaction: '225.00',
          sellingUnitsSold: 5,
          equivalentBaseUnitsSold: 38,
          cogs: '500.00',
          grossProfit: '400.00',
          grossMarginPercent: '44.44',
        } as unknown as T,
      ];
    } else if (sql.includes('from sales s') && sql.includes('receiptNumber')) {
      rows = [
        {
          id: 'sale-1',
          receiptNumber: 'MAIN-20260806-0001',
          completedAt: '2026-08-06T10:00:00.000Z',
          branchName: 'Main Branch',
          cashierName: 'Owner User',
          subtotal: '1000.00',
          discountTotal: '100.00',
          taxTotal: '120.00',
          total: '1020.00',
          refundTotal: '120.00',
          netTotal: '900.00',
          status: 'completed',
          paymentMethod: 'cash',
          itemCount: 2,
          sellingUnitsSold: 5,
          baseUnitsSold: 38,
          saleCost: '500.00',
          saleProfit: '400.00',
        } as unknown as T,
      ];
    } else if (sql.includes('from sale_items si') && sql.includes('productsSold')) {
      rows = [
        {
          productsSold: 1,
          sellingUnitsSold: 5,
          equivalentBaseUnitsSold: 38,
          productRevenue: '1020.00',
          productDiscounts: '100.00',
          productRefunds: '120.00',
          netProductSales: '900.00',
          cogs: '500.00',
          grossProfit: '400.00',
          grossMarginPercent: '44.44',
        } as unknown as T,
      ];
    } else if (sql.includes('from sale_items si') && sql.includes('avgSellingPrice')) {
      rows = [
        {
          id: 'prod-water',
          name: 'Bottled Water',
          sku: 'SKU-WATER',
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
          cost: '360.00',
          profit: '300.00',
          margin: '45.45',
        } as unknown as T,
      ];
    } else if (sql.includes('from sales s where s.id = $1')) {
      rows = [
        {
          id: 'sale-1',
          receiptNumber: 'MAIN-20260806-0001',
          completedAt: '2026-08-06T10:00:00.000Z',
          status: 'completed',
          branchId: 'branch-1111',
          branchName: 'Main Branch',
          registerName: 'Main Register',
          shiftId: 'shift-1',
          cashierName: 'Owner User',
          customerName: 'Walk-in Customer',
          subtotal: '1000.00',
          discountTotal: '100.00',
          taxTotal: '120.00',
          total: '1020.00',
          refundTotal: '120.00',
          netTotal: '900.00',
        } as unknown as T,
      ];
    } else if (sql.includes('from sale_items si') && (sql.includes('where si.sale_id = $1') || sql.includes('si.sale_id = $1'))) {
      rows = [
        {
          id: 'si-1',
          productName: 'Bottled Water Box',
          sku: 'SKU-WATER-BOX',
          sellingUnit: 'box',
          quantity: 3,
          unitsPerBase: 12,
          baseQuantity: 36,
          baseUnit: 'piece',
          unitPrice: '220.00',
          unitCost: '120.00',
          discountTotal: '0.00',
          taxTotal: '70.71',
          lineTotal: '660.00',
          lineProfit: '300.00',
        } as unknown as T,
        {
          id: 'si-2',
          productName: 'Bottled Water Piece',
          sku: 'SKU-WATER-PCS',
          sellingUnit: 'piece',
          quantity: 2,
          unitsPerBase: 1,
          baseQuantity: 2,
          baseUnit: 'piece',
          unitPrice: '20.00',
          unitCost: '10.00',
          discountTotal: '0.00',
          taxTotal: '4.29',
          lineTotal: '40.00',
          lineProfit: '20.00',
        } as unknown as T,
      ];
    } else if (sql.includes('from payments where sale_id = $1')) {
      rows = [
        { method: 'cash', amount: '1020.00', reference: null } as unknown as T,
      ];
    } else if (sql.includes('count(*)::int')) {
      rows = [{ totalRows: 1 } as unknown as T];
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

describe('Phase F2 — Executive Overview, Sales & Product Performance Verification', () => {
  it('1. Verified Financial Formula Relationship (finalSales = merchandiseSubtotal - discounts + taxesCollected)', async () => {
    const db = new FakeF2Database();
    const overviewService = new OverviewReportService(db);
    const scope = resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' });
    const report = await overviewService.generate(scope, { from: '2026-08-01', to: '2026-08-06' });

    const subtotal = Number(report.summaryCards.find((c) => c.cardId === 'merchandise_subtotal')?.value);
    const discounts = Number(report.summaryCards.find((c) => c.cardId === 'discounts')?.value);
    const taxes = Number(report.summaryCards.find((c) => c.cardId === 'taxes_collected')?.value);
    const finalSales = Number(report.summaryCards.find((c) => c.cardId === 'final_sales')?.value);
    const refunds = Number(report.summaryCards.find((c) => c.cardId === 'customer_refunds')?.value);
    const netSales = Number(report.summaryCards.find((c) => c.cardId === 'net_sales_after_refunds')?.value);

    expect(finalSales).toBe(subtotal - discounts + taxes);
    expect(netSales).toBe(finalSales - refunds);
  });

  it('8. Alternate Unit Scenario (2 Pieces + 3 Boxes = 38 Base Pieces)', async () => {
    const db = new FakeF2Database();
    const detailService = new TransactionDetailService(db);
    const scope = resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' });
    const detail = await detailService.getTransactionDetail(scope, 'sale-1');

    const boxItem = detail.items.find((i) => i.sellingUnit === 'box');
    const pieceItem = detail.items.find((i) => i.sellingUnit === 'piece');

    expect(boxItem?.quantity).toBe(3);
    expect(boxItem?.baseQuantity).toBe(36);
    expect(pieceItem?.quantity).toBe(2);
    expect(pieceItem?.baseQuantity).toBe(2);

    const totalBaseQuantity = (boxItem?.baseQuantity ?? 0) + (pieceItem?.baseQuantity ?? 0);
    expect(totalBaseQuantity).toBe(38);
  });

  it('6 & 11. Cost and Profit Sanitization for Cashier User', async () => {
    const db = new FakeF2Database();
    const overviewService = new OverviewReportService(db);
    const scope = resolveReportScope(mockCashier, { from: '2026-08-01', to: '2026-08-06' });
    const report = await overviewService.generate(scope, { from: '2026-08-01', to: '2026-08-06' });

    const cogsCard = report.summaryCards.find((c) => c.cardId === 'cogs');
    const profitCard = report.summaryCards.find((c) => c.cardId === 'gross_profit');
    expect(cogsCard).toBeUndefined();
    expect(profitCard).toBeUndefined();
  });

  it('Full Transaction Detail Drilldown returns complete itemized details', async () => {
    const db = new FakeF2Database();
    const detailService = new TransactionDetailService(db);
    const scope = resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' });
    const detail = await detailService.getTransactionDetail(scope, 'sale-1');

    expect(detail.receiptNumber).toBe('MAIN-20260806-0001');
    expect(detail.items.length).toBe(2);
    expect(detail.payments[0]?.method).toBe('cash');
  });
});
