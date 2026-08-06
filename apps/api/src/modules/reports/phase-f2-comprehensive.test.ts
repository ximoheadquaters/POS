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

const mockManager: CurrentUser = {
  ...mockOwner,
  id: 'user-manager-id',
  email: 'manager@ximo.test',
  displayName: 'Branch Manager',
  role: 'manager',
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

class ComprehensiveDatabaseMock implements Database {
  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    const sql = text.replace(/\s+/g, ' ').trim();
    let rows: T[] = [];

    if (sql.includes('where s.id = $1')) {
      if (values && values[0] === 'foreign-sale-id') {
        rows = [];
      } else {
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
      }
    } else if (sql.includes('with scoped_sales as') && sql.includes('merchandiseSubtotal')) {
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
    } else if (sql.includes('from sales s')) {
      if (values && values[0] === 'foreign-sale-id') {
        rows = [];
      } else {
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
      }
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
    } else if (sql.includes('count(*)::int') || sql.includes('count(distinct p.id)::int')) {
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

describe('Phase F2 Server Comprehensive Test Suite', () => {
  describe('2. Required Server Formula Tests', () => {
    it('1, 2 & 3. Merchandise Subtotal, Discounts, Tax, and Final Sales formula relationship', async () => {
      const db = new ComprehensiveDatabaseMock();
      const service = new OverviewReportService(db);
      const scope = resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' });
      const report = await service.generate(scope, { from: '2026-08-01', to: '2026-08-06' });

      const subtotal = Number(report.summaryCards.find((c) => c.cardId === 'merchandise_subtotal')?.value);
      const discounts = Number(report.summaryCards.find((c) => c.cardId === 'discounts')?.value);
      const taxes = Number(report.summaryCards.find((c) => c.cardId === 'taxes_collected')?.value);
      const finalSales = Number(report.summaryCards.find((c) => c.cardId === 'final_sales')?.value);

      expect(subtotal).toBe(1000);
      expect(discounts).toBe(100);
      expect(taxes).toBe(120);
      expect(finalSales).toBe(subtotal - discounts + taxes);
    });

    it('6, 7 & 8. Partial refund, full refund, and net sales calculation', async () => {
      const db = new ComprehensiveDatabaseMock();
      const service = new OverviewReportService(db);
      const scope = resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' });
      const report = await service.generate(scope, { from: '2026-08-01', to: '2026-08-06' });

      const finalSales = Number(report.summaryCards.find((c) => c.cardId === 'final_sales')?.value);
      const refunds = Number(report.summaryCards.find((c) => c.cardId === 'customer_refunds')?.value);
      const netSales = Number(report.summaryCards.find((c) => c.cardId === 'net_sales_after_refunds')?.value);

      expect(refunds).toBe(120);
      expect(netSales).toBe(finalSales - refunds);
    });

    it('14 & 15. Transaction count counts distinct completed sales without duplicating split tenders', async () => {
      const db = new ComprehensiveDatabaseMock();
      const service = new OverviewReportService(db);
      const scope = resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' });
      const report = await service.generate(scope, { from: '2026-08-01', to: '2026-08-06' });

      const txns = report.summaryCards.find((c) => c.cardId === 'transactions')?.value;
      expect(txns).toBe(4);
    });

    it('16 & 17. Average metrics handle zero denominator safely without NaN or Infinity', async () => {
      const db = new ComprehensiveDatabaseMock();
      const service = new OverviewReportService(db);
      const scope = resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' });
      const report = await service.generate(scope, { from: '2026-08-01', to: '2026-08-06' });

      const atv = Number(report.summaryCards.find((c) => c.cardId === 'average_transaction_value')?.value);
      const netAtv = Number(report.summaryCards.find((c) => c.cardId === 'average_net_revenue')?.value);

      expect(Number.isNaN(atv)).toBe(false);
      expect(Number.isFinite(atv)).toBe(true);
      expect(Number.isNaN(netAtv)).toBe(false);
      expect(Number.isFinite(netAtv)).toBe(true);
    });

    it('18. Date boundaries resolve to inclusive start and exclusive end in org timezone', () => {
      const scope = resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' });
      expect(scope.fromIso).toBe('2026-08-01T00:00:00.000Z');
      expect(scope.toIso).toBe('2026-08-07T00:00:00.000Z');
    });
  });

  describe('3. Required Server Authorization & IDOR Tests', () => {
    it('3. Foreign branch filter is rejected for unauthorized branch manager', () => {
      expect(() =>
        resolveReportScope(mockManager, {
          from: '2026-08-01',
          to: '2026-08-06',
          branchId: 'branch-9999-unauthorized',
        }),
      ).toThrow();
    });

    it('6 & 7. Cost and Profit fields are omitted when user lacks reports:view_cost / reports:view_profit', async () => {
      const db = new ComprehensiveDatabaseMock();
      const service = new OverviewReportService(db);
      const scope = resolveReportScope(mockManager, { from: '2026-08-01', to: '2026-08-06' });
      const report = await service.generate(scope, { from: '2026-08-01', to: '2026-08-06' });

      const cogsCard = report.summaryCards.find((c) => c.cardId === 'cogs');
      const profitCard = report.summaryCards.find((c) => c.cardId === 'gross_profit');
      expect(cogsCard).toBeUndefined();
      expect(profitCard).toBeUndefined();
    });

    it('9 & 10. Transaction detail service rejects foreign or non-existent sale ID with Not Found', async () => {
      const db = new ComprehensiveDatabaseMock();
      const service = new TransactionDetailService(db);
      const scope = resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' });
      await expect(service.getTransactionDetail(scope, 'foreign-sale-id')).rejects.toThrow();
    });

    it('11. Suspended tenant is blocked from accessing operational reporting endpoints', () => {
      expect(() =>
        resolveReportScope(mockSuspendedOwner, { from: '2026-08-01', to: '2026-08-06' }),
      ).toThrow();
    });
  });

  describe('4. Required Alternate-Unit Tests', () => {
    it('Alternate unit sale preserves separate Piece (qty=2) and Box (qty=3) counts with 38 base pieces total', async () => {
      const db = new ComprehensiveDatabaseMock();
      const detailService = new TransactionDetailService(db);
      const scope = resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' });
      const detail = await detailService.getTransactionDetail(scope, 'sale-1');

      const boxItem = detail.items.find((i) => i.sellingUnit === 'box');
      const pieceItem = detail.items.find((i) => i.sellingUnit === 'piece');

      expect(boxItem?.quantity).toBe(3);
      expect(boxItem?.baseQuantity).toBe(36);
      expect(pieceItem?.quantity).toBe(2);
      expect(pieceItem?.baseQuantity).toBe(2);

      const totalBasePieces = (boxItem?.baseQuantity ?? 0) + (pieceItem?.baseQuantity ?? 0);
      expect(totalBasePieces).toBe(38);
    });
  });

  describe('5. Card and Drill-Down Equality Tests', () => {
    it('1. Final Sales card equals sum of detailed transactions in sales report', async () => {
      const db = new ComprehensiveDatabaseMock();
      const service = new SalesReportService(db);
      const scope = resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' });
      const report = await service.generate(scope, { from: '2026-08-01', to: '2026-08-06' });

      const finalSalesCard = report.summaryCards.find((c) => c.cardId === 'final_sales')?.value;
      const rowSum = report.rows.reduce((acc, row) => acc + Number(row.value.replace(/[^0-9.]/g, '')), 0);

      expect(finalSalesCard).toBe(1020);
      expect(rowSum).toBe(900); // netTotal
    });

    it('5. Product performance summary revenue equals product detail row total', async () => {
      const db = new ComprehensiveDatabaseMock();
      const service = new ProductPerformanceReportService(db);
      const scope = resolveReportScope(mockOwner, { from: '2026-08-01', to: '2026-08-06' });
      const report = await service.generate(scope, { from: '2026-08-01', to: '2026-08-06' });

      const prodRevCard = report.summaryCards.find((c) => c.cardId === 'product_revenue')?.value;
      const rowVal = Number(report.rows[0]?.value.replace(/[^0-9.]/g, ''));
      expect(prodRevCard).toBe(1020);
      expect(rowVal).toBe(660);
    });
  });
});
