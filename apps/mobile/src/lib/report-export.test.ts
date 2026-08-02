import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib/cjs/index.js';
import * as XLSX from 'xlsx-js-style';
import { describe, expect, it } from 'vitest';
import { buildReportsExcel, buildReportsPdf } from './report-export';
import type { ReportExportMetadata, ReportsWorkspace } from './report-types';

const metadata: ReportExportMetadata = {
  organizationName: 'Jethro Store',
  branchName: 'Main Branch',
  rangeLabel: '30 days',
  from: '2026-07-01T00:00:00.000Z',
  to: '2026-08-01T00:00:00.000Z',
  generatedAt: new Date('2026-08-02T02:00:00.000Z'),
};

const report: ReportsWorkspace = {
  kpis: {
    grossSales: '12500.00',
    netSales: '12000.00',
    customerRefunds: '500.00',
    discounts: '100.00',
    taxes: '1339.29',
    transactions: 48,
    uniqueCustomers: 12,
    averageTransaction: '250.00',
    itemsSold: 126,
    netCost: '7200.00',
    grossProfit: '4800.00',
    grossMarginPercent: '40.00',
    refundRatePercent: '4.00',
  },
  sales: {
    paymentMethods: [{ method: 'cash', total: '12000.00', transactions: 48 }],
    topProducts: [
      {
        name: 'Coca-Cola 330ml',
        sku: 'COKE-330',
        unit: 'PIECE',
        quantity: 42,
        sales: '4200.00',
        cost: '2520.00',
        profit: '1680.00',
      },
    ],
    topCategories: [{ name: 'Beverages', sales: '4200.00', quantity: 42 }],
    branches: [{ id: 'branch-1', name: 'Main Branch', sales: '12000.00', transactions: 48 }],
    trend: Array.from({ length: 31 }, (_, index) => ({
      date: `2026-07-${String(index + 1).padStart(2, '0')}`,
      sales: String((index + 1) * 25),
      transactions: (index % 4) + 1,
    })),
  },
  inventory: {
    stockRecords: 18,
    activeProducts: 14,
    unitsOnHand: 820,
    inventoryValue: '28500.00',
    stockValue: '28500.00',
    lowStockCount: 2,
    outOfStockCount: 1,
    lowStock: [
      {
        id: 'product-1',
        name: 'Coca-Cola 330ml',
        sku: 'COKE-330',
        unit: 'PIECE',
        branchName: 'Main Branch',
        quantity: 3,
        lowStockLevel: 5,
        inventoryValue: '180.00',
      },
    ],
    byCategory: [{ name: 'Beverages', value: '12500.00', quantity: 220, products: 5 }],
    movements: [{ type: 'sale', movements: 48, quantity: 126 }],
  },
  purchasing: {
    purchaseOrders: 5,
    openOrders: 1,
    orderedValue: '15000.00',
    receivedValue: '12000.00',
    supplierReturns: '400.00',
    outstandingPayables: '3500.00',
    supplierPayments: '8500.00',
    supplierRefunds: '200.00',
    orderStatuses: [{ status: 'received', orders: 4, value: '12000.00' }],
    topSuppliers: [{ id: 'supplier-1', name: 'Metro Supplier', orders: 5, value: '15000.00' }],
  },
  profit: {
    grossSales: '12500.00',
    refunds: '500.00',
    netSales: '12000.00',
    netCost: '7200.00',
    grossProfit: '4800.00',
    grossMarginPercent: '40.00',
    trend: [{ date: '2026-07-31', netSales: '12000.00', netCost: '7200.00', profit: '4800.00' }],
  },
  cash: {
    shifts: 7,
    openShifts: 1,
    cashSales: '12000.00',
    cashRefunds: '500.00',
    countedCash: '11600.00',
    variance: '100.00',
    cashIn: '500.00',
    cashOut: '300.00',
  },
};

describe('report exports', () => {
  it('creates a valid six-sheet Excel workbook with numeric report values', async () => {
    const output = buildReportsExcel(report, metadata);
    expect(output.fileName).toBe('ximo-reports-main-branch-2026-07-01-to-2026-07-31.xlsx');
    expect(Array.from(output.bytes.slice(0, 2))).toEqual([0x50, 0x4b]);

    const workbook = XLSX.read(output.bytes, { type: 'array' });
    expect(workbook.SheetNames).toEqual([
      'Summary',
      'Sales',
      'Inventory',
      'Purchasing',
      'Profit',
      'Cash & Shifts',
    ]);
    expect(workbook.Sheets.Summary?.B7?.v).toBe(12500);
    expect(workbook.Sheets.Sales?.A1?.v).toBe('Sales trend');

    if (process.env.REPORT_EXPORT_FIXTURE_DIR) {
      await mkdir(process.env.REPORT_EXPORT_FIXTURE_DIR, { recursive: true });
      await writeFile(`${process.env.REPORT_EXPORT_FIXTURE_DIR}/${output.fileName}`, output.bytes);
    }
  });

  it('creates a readable, paginated PDF report', async () => {
    const output = await buildReportsPdf(report, metadata);
    expect(output.fileName).toBe('ximo-reports-main-branch-2026-07-01-to-2026-07-31.pdf');
    expect(new TextDecoder().decode(output.bytes.slice(0, 8))).toContain('%PDF-');

    const document = await PDFDocument.load(output.bytes);
    expect(document.getPageCount()).toBeGreaterThan(1);
    expect(document.getTitle()).toBe('Jethro Store reports');

    if (process.env.REPORT_EXPORT_FIXTURE_DIR) {
      await mkdir(process.env.REPORT_EXPORT_FIXTURE_DIR, { recursive: true });
      await writeFile(`${process.env.REPORT_EXPORT_FIXTURE_DIR}/${output.fileName}`, output.bytes);
    }
  });
});
