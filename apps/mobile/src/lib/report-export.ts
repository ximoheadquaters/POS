// Expo/Metro currently resolves pdf-lib's ESM entry through tslib/modules,
// whose default-export interop crashes at runtime. The package's CommonJS
// entry exposes the same API and is compatible with Metro on web and native.
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib/cjs/index.js';
import * as XLSX from 'xlsx-js-style';
import type { ReportExportMetadata, ReportsWorkspace } from './report-types';

const BRAND = rgb(0.102, 0.349, 0.231);
const TEXT = rgb(0.059, 0.09, 0.165);
const MUTED = rgb(0.392, 0.455, 0.545);
const BORDER = rgb(0.886, 0.91, 0.941);
const SOFT = rgb(0.965, 0.976, 0.973);
const A4: [number, number] = [595.28, 841.89];

function money(value: string | number): string {
  const amount = Number(value);
  return `PHP ${Number.isFinite(amount) ? amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}`;
}

function amount(value: string | number): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function inclusiveEndDate(to: string): Date {
  return new Date(new Date(to).getTime() - 1);
}

function reportFileStem(metadata: ReportExportMetadata): string {
  const start = new Date(metadata.from).toISOString().slice(0, 10);
  const end = inclusiveEndDate(metadata.to).toISOString().slice(0, 10);
  const branch = metadata.branchName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
  return `ximo-reports-${branch || 'all-branches'}-${start}-to-${end}`;
}

function addSheet(
  workbook: XLSX.WorkBook,
  name: string,
  rows: Array<Array<string | number | Date>>,
  widths: number[],
): void {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = widths.map((wch) => ({ wch }));
  sheet['!rows'] = rows.map((row) => ({ hpt: row.length === 1 && row[0] ? 24 : 20 }));
  sheet['!merges'] = [];
  const currencyLabels = new Set([
    'Gross sales',
    'Net sales',
    'Customer refunds',
    'Average transaction',
    'Gross profit',
    'Inventory value',
    'Outstanding payables',
    'Cash variance',
    'Ordered value',
    'Received value',
    'Supplier returns',
    'Supplier payments',
    'Supplier refunds',
    'Refunds',
    'Net cost',
    'Cash sales',
    'Cash refunds',
    'Cash in',
    'Cash out',
    'Counted cash',
    'Variance',
  ]);
  let currencyColumns = new Set<number>();
  rows.forEach((row, rowIndex) => {
    const nonEmpty = row.filter((value) => value !== '' && value !== null && value !== undefined);
    if (!nonEmpty.length) {
      currencyColumns = new Set();
    }
    const section = nonEmpty.length === 1 && row[0] === nonEmpty[0];
    const metadataRow = name === 'Summary' && rowIndex < 4;
    const header =
      !metadataRow &&
      !section &&
      nonEmpty.length > 1 &&
      nonEmpty.every((value) => typeof value === 'string');
    if (section && widths.length > 1) {
      sheet['!merges']!.push({
        s: { r: rowIndex, c: 0 },
        e: { r: rowIndex, c: widths.length - 1 },
      });
    }
    if (header) {
      const kpiHeader = typeof row[0] === 'string' && /(?:^KPI$|KPI$)/i.test(row[0]);
      currencyColumns = kpiHeader
        ? new Set()
        : new Set(
            row.flatMap((value, index) =>
              typeof value === 'string' && /sales|cost|profit|total|value/i.test(value)
                ? [index]
                : [],
            ),
          );
    }
    for (let columnIndex = 0; columnIndex < widths.length; columnIndex += 1) {
      const value = row[columnIndex];
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      const cell = (sheet[address] ?? { t: 's', v: '' }) as XLSX.CellObject & {
        s?: Record<string, unknown>;
      };
      sheet[address] = cell;
      const empty = value === '' || value === null || value === undefined;
      const style: Record<string, unknown> = {
        fill: {
          patternType: 'solid',
          fgColor: {
            rgb: section
              ? '1A593B'
              : header
                ? 'EAF4EF'
                : metadataRow && columnIndex === 0
                  ? 'F3F6F4'
                  : 'FFFFFF',
          },
        },
      };
      if (!empty) {
        style.font = {
          name: 'Aptos',
          sz: section ? 12 : 10,
          bold: section || header || (metadataRow && columnIndex === 0),
          color: { rgb: section ? 'FFFFFF' : header ? '175C3A' : '172033' },
        };
        style.alignment = {
          vertical: 'center',
          horizontal: typeof value === 'number' ? 'right' : 'left',
        };
      }
      if (!empty && !section && !header) {
        style.border = { bottom: { style: 'hair', color: { rgb: 'E2E8F0' } } };
      }
      cell.s = style;
      if (
        typeof value === 'number' &&
        columnIndex === 1 &&
        typeof row[0] === 'string' &&
        /margin|\(%\)/i.test(row[0])
      ) {
        cell.z = '0.00"%"';
      } else if (
        typeof value === 'number' &&
        (currencyColumns.has(columnIndex) ||
          (columnIndex === 1 && typeof row[0] === 'string' && currencyLabels.has(row[0])))
      ) {
        cell.z = '"PHP" #,##0.00';
      } else if (typeof value === 'number') {
        cell.z = '#,##0.##';
      }
    }
  });
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}

export function buildReportsExcel(
  report: ReportsWorkspace,
  metadata: ReportExportMetadata,
): { bytes: Uint8Array; fileName: string } {
  const workbook = XLSX.utils.book_new();
  workbook.Props = {
    Title: `${metadata.organizationName} reports`,
    Subject: `${metadata.rangeLabel} - ${metadata.branchName}`,
    Author: 'Ximo POS',
    CreatedDate: metadata.generatedAt ?? new Date(),
  };

  addSheet(
    workbook,
    'Summary',
    [
      [`${metadata.organizationName} - Ximo POS business report`],
      ['Date range', metadata.rangeLabel],
      ['Branch', metadata.branchName],
      ['Generated', (metadata.generatedAt ?? new Date()).toISOString()],
      [],
      ['KPI', 'Value'],
      ['Gross sales', amount(report.kpis.grossSales)],
      ['Net sales', amount(report.kpis.netSales)],
      ['Customer refunds', amount(report.kpis.customerRefunds)],
      ['Transactions', report.kpis.transactions],
      ['Average transaction', amount(report.kpis.averageTransaction)],
      ['Items sold', report.kpis.itemsSold],
      ['Gross profit', amount(report.kpis.grossProfit)],
      ['Gross margin (%)', amount(report.kpis.grossMarginPercent)],
      ['Inventory value', amount(report.inventory.inventoryValue)],
      ['Outstanding payables', amount(report.purchasing.outstandingPayables)],
      ['Cash variance', amount(report.cash.variance)],
    ],
    [28, 28],
  );

  addSheet(
    workbook,
    'Sales',
    [
      ['Sales trend'],
      ['Date', 'Gross sales', 'Transactions'],
      ...report.sales.trend.map((item) => [item.date, amount(item.sales), item.transactions]),
      [],
      ['Top products'],
      ['Product', 'SKU', 'Unit', 'Quantity', 'Sales', 'Cost', 'Profit'],
      ...report.sales.topProducts.map((item) => [
        item.name,
        item.sku,
        item.unit,
        item.quantity,
        amount(item.sales),
        amount(item.cost),
        amount(item.profit),
      ]),
      [],
      ['Payment methods'],
      ['Method', 'Transactions', 'Total'],
      ...report.sales.paymentMethods.map((item) => [
        item.method,
        item.transactions,
        amount(item.total),
      ]),
      [],
      ['Sales by category'],
      ['Category', 'Quantity', 'Sales'],
      ...report.sales.topCategories.map((item) => [item.name, item.quantity, amount(item.sales)]),
      [],
      ['Sales by branch'],
      ['Branch', 'Transactions', 'Sales'],
      ...report.sales.branches.map((item) => [item.name, item.transactions, amount(item.sales)]),
    ],
    [26, 20, 14, 14, 18, 18, 18],
  );

  addSheet(
    workbook,
    'Inventory',
    [
      ['Inventory KPI', 'Value'],
      ['Active products', report.inventory.activeProducts],
      ['Stock records', report.inventory.stockRecords],
      ['Units on hand', report.inventory.unitsOnHand],
      ['Inventory value', amount(report.inventory.inventoryValue)],
      ['Low stock records', report.inventory.lowStockCount],
      ['Out of stock records', report.inventory.outOfStockCount],
      [],
      ['Low stock products'],
      ['Product', 'SKU', 'Branch', 'Unit', 'On hand', 'Low stock level', 'Inventory value'],
      ...report.inventory.lowStock.map((item) => [
        item.name,
        item.sku,
        item.branchName,
        item.unit,
        item.quantity,
        item.lowStockLevel,
        amount(item.inventoryValue),
      ]),
      [],
      ['Inventory by category'],
      ['Category', 'Products', 'Quantity', 'Value'],
      ...report.inventory.byCategory.map((item) => [
        item.name,
        item.products,
        item.quantity,
        amount(item.value),
      ]),
      [],
      ['Inventory movements'],
      ['Movement type', 'Movements', 'Quantity'],
      ...report.inventory.movements.map((item) => [item.type, item.movements, item.quantity]),
    ],
    [28, 20, 24, 14, 14, 18, 20],
  );

  addSheet(
    workbook,
    'Purchasing',
    [
      ['Purchasing KPI', 'Value'],
      ['Purchase orders', report.purchasing.purchaseOrders],
      ['Open orders', report.purchasing.openOrders],
      ['Ordered value', amount(report.purchasing.orderedValue)],
      ['Received value', amount(report.purchasing.receivedValue)],
      ['Supplier returns', amount(report.purchasing.supplierReturns)],
      ['Supplier payments', amount(report.purchasing.supplierPayments)],
      ['Supplier refunds', amount(report.purchasing.supplierRefunds)],
      ['Outstanding payables', amount(report.purchasing.outstandingPayables)],
      [],
      ['Order status', 'Orders', 'Value'],
      ...report.purchasing.orderStatuses.map((item) => [
        item.status,
        item.orders,
        amount(item.value),
      ]),
      [],
      ['Top supplier', 'Orders', 'Value'],
      ...report.purchasing.topSuppliers.map((item) => [item.name, item.orders, amount(item.value)]),
    ],
    [30, 18, 20],
  );

  addSheet(
    workbook,
    'Profit',
    [
      ['Profit KPI', 'Value'],
      ['Gross sales', amount(report.profit.grossSales)],
      ['Refunds', amount(report.profit.refunds)],
      ['Net sales', amount(report.profit.netSales)],
      ['Net cost', amount(report.profit.netCost)],
      ['Gross profit', amount(report.profit.grossProfit)],
      ['Gross margin (%)', amount(report.profit.grossMarginPercent)],
      [],
      ['Date', 'Net sales', 'Net cost', 'Gross profit'],
      ...report.profit.trend.map((item) => [
        item.date,
        amount(item.netSales),
        amount(item.netCost),
        amount(item.profit),
      ]),
    ],
    [22, 20, 20, 20],
  );

  addSheet(
    workbook,
    'Cash & Shifts',
    [
      ['Cash and shift KPI', 'Value'],
      ['Shifts', report.cash.shifts],
      ['Open shifts', report.cash.openShifts],
      ['Cash sales', amount(report.cash.cashSales)],
      ['Cash refunds', amount(report.cash.cashRefunds)],
      ['Cash in', amount(report.cash.cashIn)],
      ['Cash out', amount(report.cash.cashOut)],
      ['Counted cash', amount(report.cash.countedCash)],
      ['Variance', amount(report.cash.variance)],
    ],
    [30, 22],
  );

  const output = XLSX.write(workbook, {
    bookType: 'xlsx',
    type: 'array',
    compression: true,
    cellDates: true,
  }) as ArrayBuffer;
  return { bytes: new Uint8Array(output), fileName: `${reportFileStem(metadata)}.xlsx` };
}

interface PdfContext {
  document: PDFDocument;
  regular: PDFFont;
  bold: PDFFont;
  page: PDFPage;
  y: number;
  pageNumber: number;
  metadata: ReportExportMetadata;
}

function drawPageHeader(context: PdfContext): void {
  const { page, bold, regular, metadata, pageNumber } = context;
  page.drawText(metadata.organizationName || 'Ximo POS', {
    x: 40,
    y: 804,
    size: 15,
    font: bold,
    color: BRAND,
  });
  page.drawText(`${metadata.rangeLabel} | ${metadata.branchName}`, {
    x: 40,
    y: 786,
    size: 9,
    font: regular,
    color: MUTED,
  });
  page.drawText(`Page ${pageNumber}`, {
    x: 515,
    y: 795,
    size: 8,
    font: regular,
    color: MUTED,
  });
  page.drawLine({
    start: { x: 40, y: 775 },
    end: { x: 555, y: 775 },
    thickness: 0.7,
    color: BORDER,
  });
}

function addPdfPage(context: PdfContext): void {
  context.page = context.document.addPage(A4);
  context.pageNumber += 1;
  context.y = 750;
  drawPageHeader(context);
}

function ensureSpace(context: PdfContext, height: number): void {
  if (context.y - height < 48) addPdfPage(context);
}

function sectionTitle(context: PdfContext, title: string, subtitle?: string): void {
  // Keep a section heading with its table header and at least a few rows.
  ensureSpace(context, subtitle ? 138 : 116);
  context.page.drawText(title, { x: 40, y: context.y, size: 16, font: context.bold, color: TEXT });
  context.y -= 19;
  if (subtitle) {
    context.page.drawText(subtitle, {
      x: 40,
      y: context.y,
      size: 8.5,
      font: context.regular,
      color: MUTED,
    });
    context.y -= 17;
  }
}

function truncate(font: PDFFont, value: string, size: number, width: number): string {
  if (font.widthOfTextAtSize(value, size) <= width) return value;
  let result = value;
  while (result.length > 1 && font.widthOfTextAtSize(`${result}...`, size) > width) {
    result = result.slice(0, -1);
  }
  return `${result}...`;
}

function pdfTable(
  context: PdfContext,
  headers: string[],
  rows: string[][],
  widths: number[],
): void {
  const rowHeight = 22;
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  const drawHeader = () => {
    ensureSpace(context, rowHeight * 2);
    context.page.drawRectangle({
      x: 40,
      y: context.y - rowHeight + 5,
      width: totalWidth,
      height: rowHeight,
      color: SOFT,
    });
    let x = 46;
    headers.forEach((header, index) => {
      context.page.drawText(truncate(context.bold, header, 8, widths[index]! - 12), {
        x,
        y: context.y - 10,
        size: 8,
        font: context.bold,
        color: BRAND,
      });
      x += widths[index]!;
    });
    context.y -= rowHeight;
  };
  drawHeader();
  if (!rows.length) rows = [['No data in this period', ...headers.slice(1).map(() => '')]];
  for (const row of rows) {
    if (context.y - rowHeight < 48) {
      addPdfPage(context);
      drawHeader();
    }
    let x = 46;
    row.forEach((cell, index) => {
      context.page.drawText(truncate(context.regular, cell, 8, widths[index]! - 12), {
        x,
        y: context.y - 10,
        size: 8,
        font: context.regular,
        color: TEXT,
      });
      x += widths[index]!;
    });
    context.page.drawLine({
      start: { x: 40, y: context.y - 17 },
      end: { x: 40 + totalWidth, y: context.y - 17 },
      thickness: 0.45,
      color: BORDER,
    });
    context.y -= rowHeight;
  }
  context.y -= 14;
}

function kpiTable(context: PdfContext, rows: Array<[string, string]>): void {
  pdfTable(context, ['KPI', 'Value'], rows, [335, 180]);
}

export async function buildReportsPdf(
  report: ReportsWorkspace,
  metadata: ReportExportMetadata,
): Promise<{ bytes: Uint8Array; fileName: string }> {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  document.setTitle(`${metadata.organizationName} reports`);
  document.setAuthor('Ximo POS');
  document.setSubject(`${metadata.rangeLabel} - ${metadata.branchName}`);
  document.setCreationDate(metadata.generatedAt ?? new Date());
  const context: PdfContext = {
    document,
    regular,
    bold,
    page: document.addPage(A4),
    y: 750,
    pageNumber: 1,
    metadata,
  };
  drawPageHeader(context);

  sectionTitle(context, 'Business report', 'Consolidated KPIs and detailed operational reports');
  kpiTable(context, [
    ['Gross sales', money(report.kpis.grossSales)],
    ['Net sales', money(report.kpis.netSales)],
    ['Transactions', report.kpis.transactions.toLocaleString()],
    ['Average transaction', money(report.kpis.averageTransaction)],
    ['Gross profit', money(report.kpis.grossProfit)],
    ['Gross margin', `${amount(report.kpis.grossMarginPercent).toFixed(2)}%`],
    ['Inventory value', money(report.inventory.inventoryValue)],
    ['Outstanding payables', money(report.purchasing.outstandingPayables)],
    ['Cash variance', money(report.cash.variance)],
  ]);

  sectionTitle(context, 'Sales');
  kpiTable(context, [
    ['Gross sales', money(report.kpis.grossSales)],
    ['Customer refunds', money(report.kpis.customerRefunds)],
    ['Net sales', money(report.kpis.netSales)],
    ['Items sold', report.kpis.itemsSold.toLocaleString()],
    ['Known customers', report.kpis.uniqueCustomers.toLocaleString()],
  ]);
  pdfTable(
    context,
    ['Date', 'Gross sales', 'Transactions'],
    report.sales.trend.map((item) => [item.date, money(item.sales), String(item.transactions)]),
    [195, 190, 130],
  );
  pdfTable(
    context,
    ['Top product', 'SKU', 'Qty', 'Sales'],
    report.sales.topProducts.map((item) => [
      item.name,
      item.sku,
      String(item.quantity),
      money(item.sales),
    ]),
    [220, 120, 70, 105],
  );
  pdfTable(
    context,
    ['Payment method', 'Transactions', 'Total'],
    report.sales.paymentMethods.map((item) => [
      item.method,
      String(item.transactions),
      money(item.total),
    ]),
    [250, 125, 140],
  );
  pdfTable(
    context,
    ['Sales category', 'Quantity', 'Sales'],
    report.sales.topCategories.map((item) => [item.name, String(item.quantity), money(item.sales)]),
    [250, 125, 140],
  );
  pdfTable(
    context,
    ['Branch', 'Transactions', 'Sales'],
    report.sales.branches.map((item) => [item.name, String(item.transactions), money(item.sales)]),
    [250, 125, 140],
  );

  sectionTitle(context, 'Inventory');
  kpiTable(context, [
    ['Active products', String(report.inventory.activeProducts)],
    ['Units on hand', report.inventory.unitsOnHand.toLocaleString()],
    ['Inventory value', money(report.inventory.inventoryValue)],
    ['Low stock records', String(report.inventory.lowStockCount)],
    ['Out of stock records', String(report.inventory.outOfStockCount)],
  ]);
  pdfTable(
    context,
    ['Low stock product', 'Branch', 'On hand', 'Level'],
    report.inventory.lowStock.map((item) => [
      item.name,
      item.branchName,
      String(item.quantity),
      String(item.lowStockLevel),
    ]),
    [220, 165, 65, 65],
  );
  pdfTable(
    context,
    ['Inventory category', 'Products', 'Quantity', 'Value'],
    report.inventory.byCategory.map((item) => [
      item.name,
      String(item.products),
      String(item.quantity),
      money(item.value),
    ]),
    [220, 95, 90, 110],
  );
  pdfTable(
    context,
    ['Movement type', 'Movements', 'Quantity'],
    report.inventory.movements.map((item) => [
      item.type,
      String(item.movements),
      String(item.quantity),
    ]),
    [250, 125, 140],
  );

  sectionTitle(context, 'Purchasing');
  kpiTable(context, [
    ['Purchase orders', String(report.purchasing.purchaseOrders)],
    ['Open orders', String(report.purchasing.openOrders)],
    ['Ordered value', money(report.purchasing.orderedValue)],
    ['Received value', money(report.purchasing.receivedValue)],
    ['Supplier returns', money(report.purchasing.supplierReturns)],
    ['Supplier payments', money(report.purchasing.supplierPayments)],
    ['Outstanding payables', money(report.purchasing.outstandingPayables)],
  ]);
  pdfTable(
    context,
    ['Order status', 'Orders', 'Value'],
    report.purchasing.orderStatuses.map((item) => [
      item.status,
      String(item.orders),
      money(item.value),
    ]),
    [250, 125, 140],
  );
  pdfTable(
    context,
    ['Supplier', 'Orders', 'Value'],
    report.purchasing.topSuppliers.map((item) => [
      item.name,
      String(item.orders),
      money(item.value),
    ]),
    [250, 125, 140],
  );

  sectionTitle(context, 'Profit');
  kpiTable(context, [
    ['Gross sales', money(report.profit.grossSales)],
    ['Refunds', money(report.profit.refunds)],
    ['Net sales', money(report.profit.netSales)],
    ['Net cost', money(report.profit.netCost)],
    ['Gross profit', money(report.profit.grossProfit)],
    ['Gross margin', `${amount(report.profit.grossMarginPercent).toFixed(2)}%`],
  ]);
  pdfTable(
    context,
    ['Date', 'Net sales', 'Net cost', 'Profit'],
    report.profit.trend.map((item) => [
      item.date,
      money(item.netSales),
      money(item.netCost),
      money(item.profit),
    ]),
    [155, 120, 120, 120],
  );

  sectionTitle(context, 'Cash and shifts');
  kpiTable(context, [
    ['Shifts', String(report.cash.shifts)],
    ['Open shifts', String(report.cash.openShifts)],
    ['Cash sales', money(report.cash.cashSales)],
    ['Cash refunds', money(report.cash.cashRefunds)],
    ['Cash in', money(report.cash.cashIn)],
    ['Cash out', money(report.cash.cashOut)],
    ['Counted cash', money(report.cash.countedCash)],
    ['Variance', money(report.cash.variance)],
  ]);

  const generatedAt = metadata.generatedAt ?? new Date();
  for (const page of document.getPages()) {
    page.drawText(`Generated by Ximo POS on ${generatedAt.toLocaleString('en-PH')}`, {
      x: 40,
      y: 25,
      size: 7,
      font: regular,
      color: MUTED,
    });
  }
  return { bytes: await document.save(), fileName: `${reportFileStem(metadata)}.pdf` };
}
