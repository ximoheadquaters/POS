import type { ReportsWorkspace } from './report-types';

export type ReportSectionId =
  | 'overview'
  | 'sales'
  | 'products'
  | 'inventory'
  | 'purchasing'
  | 'profit'
  | 'cash'
  | 'audit'
  | 'repacking';

export type ReportCell = string | number | null | undefined;

export interface ReportTableDefinition {
  id: string;
  title: string;
  description?: string;
  columns: string[];
  rows: ReportCell[][];
  emptyMessage: string;
}

export interface ReportDocumentDefinition {
  id: ReportSectionId;
  title: string;
  purpose: string;
  tables: ReportTableDefinition[];
}

function number(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: string | number | null | undefined, currency = 'PHP'): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(number(value));
}

function quantity(value: string | number | null | undefined): string {
  return number(value).toLocaleString('en-PH', { maximumFractionDigits: 3 });
}

function percentage(value: string | number | null | undefined): string {
  return `${number(value).toFixed(1)}%`;
}

function dateTime(value: string | undefined, timezone: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-PH', {
    timeZone: timezone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function metricRows(
  rows: Array<[string, ReportCell, string]>,
  comparisonRows?: Map<string, ReportCell>,
): ReportTableDefinition {
  const withComparison = Boolean(comparisonRows);
  return {
    id: 'metrics',
    title: 'Report totals',
    description: 'Canonical totals calculated before display rounding.',
    columns: withComparison
      ? ['Metric', 'Current period', 'Comparison period', 'Change']
      : ['Metric', 'Value', 'Definition'],
    rows: rows.map(([label, value, definition]) => {
      if (!comparisonRows) return [label, value, definition];
      const comparisonValue = comparisonRows.get(label) ?? '—';
      const current = typeof value === 'string' ? Number(value.replace(/[^0-9.-]/g, '')) : Number(value);
      const previous =
        typeof comparisonValue === 'string'
          ? Number(comparisonValue.replace(/[^0-9.-]/g, ''))
          : Number(comparisonValue);
      const change =
        Number.isFinite(current) && Number.isFinite(previous) && previous !== 0
          ? `${(((current - previous) / Math.abs(previous)) * 100).toFixed(1)}%`
          : '—';
      return [label, value, comparisonValue, change];
    }),
    emptyMessage: 'No totals are available for this period.',
  };
}

function sectionMetrics(
  report: ReportsWorkspace,
  section: ReportSectionId,
  currency: string,
): Array<[string, ReportCell, string]> {
  switch (section) {
    case 'overview':
      return [
        ['Net Sales', money(report.kpis.netSales, currency), 'Gross Sales − Discounts − Refunds'],
        ['Completed Transactions', quantity(report.kpis.transactions), 'Completed transactions only'],
        ['Average Transaction Value', money(report.kpis.averageTransaction, currency), 'Net Sales ÷ Completed Transactions'],
        ['Inventory Value (Cost)', money(report.inventory.inventoryValue, currency), 'Current Stock × Unit Cost'],
        ['Open Purchase Orders', quantity(report.purchasing.openOrders), 'Purchase orders not yet closed'],
        ['Cash Variance', money(report.cash.variance, currency), 'Closing Cash − Expected Cash'],
      ];
    case 'sales':
      return [
        ['Gross Sales', money(report.kpis.grossSales, currency), 'Selling Price × Quantity on completed transactions'],
        ['Total Discounts', money(report.kpis.discounts, currency), 'All promotion, manual, statutory, and employee discounts'],
        ['Refund Amount', money(report.kpis.customerRefunds, currency), 'All completed customer refunds'],
        ['Net Sales', money(report.kpis.netSales, currency), 'Gross Sales − Discounts − Refunds'],
        ['Completed Transactions', quantity(report.kpis.transactions), 'Voids and cancelled sales excluded'],
        ['Average Transaction Value', money(report.kpis.averageTransaction, currency), 'Net Sales ÷ Completed Transactions'],
        ['Average Items per Transaction', quantity(report.kpis.averageItemsPerTransaction), 'Quantity Sold ÷ Completed Transactions'],
      ];
    case 'products':
      return [];
    case 'inventory':
      return [
        ['Inventory Value (Cost)', money(report.inventory.inventoryValue, currency), 'Current Stock × Unit Cost'],
        ['Inventory Value (Retail)', money(report.inventory.retailValue, currency), 'Current Stock × Selling Price'],
        ['Inventory Quantity', quantity(report.inventory.unitsOnHand), 'Current available base stock'],
        ['Stock Turnover', quantity(report.inventory.stockTurnover), 'COGS ÷ Average Inventory Value'],
        ['Dead Stock', quantity(report.inventory.deadStockCount), 'Stock with no sales within 90 days'],
        ['Low Stock', quantity(report.inventory.lowStockCount), 'Stock at or below its configured threshold'],
        ['Out of Stock', quantity(report.inventory.outOfStockCount), 'Stock with no available quantity'],
      ];
    case 'purchasing':
      return [
        ['Purchase Value', money(report.purchasing.orderedValue, currency), 'Total non-draft, non-cancelled purchase orders'],
        ['Receiving Accuracy', percentage(report.purchasing.receivingAccuracy), 'Received Quantity ÷ Ordered Quantity'],
        ['Supplier Fulfillment', percentage(report.purchasing.supplierFulfillmentRate), 'Fully Delivered POs ÷ Total POs'],
        ['Outstanding Payables', money(report.purchasing.outstandingPayables, currency), 'Supplier invoices less recorded payments'],
        ['Supplier Returns', money(report.purchasing.supplierReturns, currency), 'Confirmed returns to suppliers'],
      ];
    case 'profit':
      return [
        ['Gross Sales', money(report.profit.grossSales, currency), 'Selling Price × Quantity on completed transactions'],
        ['Total Discounts', money(report.kpis.discounts, currency), 'All discounts recorded for completed transactions'],
        ['Refund Amount', money(report.profit.refunds, currency), 'All completed customer refunds'],
        ['Net Sales', money(report.profit.netSales, currency), 'Gross Sales − Discounts − Refunds'],
        ['COGS', money(report.profit.netCost, currency), 'Product Cost × Quantity Sold'],
        ['Gross Profit', money(report.profit.grossProfit, currency), 'Net Sales − COGS'],
        ['Profit Margin', percentage(report.profit.grossMarginPercent), 'Gross Profit ÷ Net Sales'],
      ];
    case 'cash':
      return [
        ['Cash Drawer Balance', money(report.cash.drawerBalance, currency), 'Opening Cash + Cash Sales − Cash Out ± Adjustments'],
        ['Expected Cash', money(report.cash.expectedCash, currency), 'Calculated cash expected in drawers'],
        ['Counted Cash', money(report.cash.countedCash, currency), 'Physical cash entered at shift close'],
        ['Cash Variance', money(report.cash.variance, currency), 'Closing Cash − Expected Cash'],
        ['Cash In', money(report.cash.cashIn, currency), 'Recorded cash-in movements'],
        ['Cash Out', money(report.cash.cashOut, currency), 'Recorded cash-out movements'],
      ];
    case 'audit':
      return [
        ['Voided Sales', quantity(report.audit?.voidedSales), 'Voids retained in the immutable audit trail'],
        ['Refund Transactions', quantity(report.audit?.refundTransactions), 'Completed refund records'],
        ['Refund Amount', money(report.audit?.refundAmount, currency), 'Value of completed refunds'],
        ['Inventory Adjustments', quantity(report.audit?.inventoryAdjustments), 'Direct inventory adjustment events'],
        ['Cash Adjustments', quantity(report.audit?.cashAdjustments), 'Direct cash adjustment events'],
      ];
    case 'repacking':
      return [
        ['Production Batches', quantity(report.repacking?.batches), 'Recorded production or repacking batches'],
        ['Output Quantity', quantity(report.repacking?.outputQuantity), 'Finished output quantity'],
        ['Input Quantity', quantity(report.repacking?.inputQuantity), 'Measured input quantity'],
        ['Yield', percentage(report.repacking?.yieldPercent), 'Output size ÷ Input size'],
        ['Loss', percentage(report.repacking?.lossPercent), '100 − Yield'],
        ['Cost Allocation', money(report.repacking?.averageCostPerOutput, currency), 'Consumed ingredient cost ÷ Output Quantity'],
      ];
  }
}

export function buildReportDocument(
  report: ReportsWorkspace,
  section: ReportSectionId,
  comparison?: ReportsWorkspace,
): ReportDocumentDefinition {
  const currency = report.metadata?.currency || 'PHP';
  const timezone = report.metadata?.timezone || 'Asia/Manila';
  const metrics = sectionMetrics(report, section, currency);
  const comparisonMetrics = comparison
    ? new Map(sectionMetrics(comparison, section, currency).map(([label, value]) => [label, value]))
    : undefined;
  const tables: ReportTableDefinition[] = [];
  if (metrics.length) tables.push(metricRows(metrics, comparisonMetrics));

  if (section === 'overview') {
    tables.push({
      id: 'attention',
      title: 'Operational attention',
      columns: ['Area', 'Status', 'Records'],
      rows: [
        ['Low stock', report.inventory.lowStockCount > 0 ? 'Needs attention' : 'Clear', report.inventory.lowStockCount],
        ['Out of stock', report.inventory.outOfStockCount > 0 ? 'Needs attention' : 'Clear', report.inventory.outOfStockCount],
        ['Open purchase orders', report.purchasing.openOrders > 0 ? 'Open' : 'None', report.purchasing.openOrders],
        ['Open shifts', report.cash.openShifts > 0 ? 'Open' : 'None', report.cash.openShifts],
      ],
      emptyMessage: 'No operational exceptions were found.',
    });
  } else if (section === 'sales') {
    tables.push(
      {
        id: 'transactions',
        title: 'Transaction history',
        columns: ['Receipt', 'Completed', 'Payment', 'Cashier', 'Total', 'Status'],
        rows: (report.sales.salesReceipts ?? []).map((row) => [
          row.receiptNumber,
          dateTime(row.completedAt, timezone),
          row.paymentMethod,
          row.cashierName ?? '—',
          money(row.total, currency),
          row.status,
        ]),
        emptyMessage: 'No completed transactions were recorded for this period.',
      },
      {
        id: 'payments',
        title: 'Payment methods',
        columns: ['Payment method', 'Transactions', 'Net amount'],
        rows: report.sales.paymentMethods.map((row) => [row.method, row.transactions, money(row.total, currency)]),
        emptyMessage: 'No payments were recorded for this period.',
      },
    );
  } else if (section === 'products') {
    tables.push({
      id: 'product-performance',
      title: 'Product performance',
      columns: ['Product', 'SKU', 'Category', 'Unit', 'Quantity sold', 'Gross sales', 'COGS', 'Gross profit'],
      rows: report.sales.topProducts.map((row) => [
        row.name,
        row.sku,
        row.category ?? 'Uncategorized',
        row.unit,
        quantity(row.quantity),
        money(row.sales, currency),
        row.cost == null ? 'Restricted' : money(row.cost, currency),
        row.profit == null ? 'Restricted' : money(row.profit, currency),
      ]),
      emptyMessage: 'No product sales were recorded for this period.',
    });
  } else if (section === 'inventory') {
    tables.push(
      {
        id: 'stock-alerts',
        title: 'Low-stock products',
        columns: ['Product', 'SKU', 'Unit', 'Available', 'Low-stock level', 'Cost value'],
        rows: report.inventory.lowStock.map((row) => [row.name, row.sku, row.unit, quantity(row.quantity), quantity(row.lowStockLevel), money(row.inventoryValue, currency)]),
        emptyMessage: 'No low-stock products were found.',
      },
      {
        id: 'category-valuation',
        title: 'Inventory by category',
        columns: ['Category', 'Products', 'Quantity', 'Cost value'],
        rows: report.inventory.byCategory.map((row) => [row.name, row.products, quantity(row.quantity), money(row.value, currency)]),
        emptyMessage: 'No inventory category totals are available.',
      },
      {
        id: 'movement-summary',
        title: 'Inventory movement summary',
        columns: ['Movement type', 'Events', 'Quantity change'],
        rows: report.inventory.movements.map((row) => [row.type, row.movements, quantity(row.quantity)]),
        emptyMessage: 'No inventory movements were recorded for this period.',
      },
    );
  } else if (section === 'purchasing') {
    tables.push(
      {
        id: 'purchase-orders',
        title: 'Purchase orders',
        columns: ['PO number', 'Supplier', 'Order date', 'Status', 'Total'],
        rows: (report.purchasing.purchaseOrdersList ?? []).map((row) => [row.poNumber, row.supplierName, dateTime(row.orderDate, timezone), row.status, money(row.total, currency)]),
        emptyMessage: 'No purchase orders were recorded for this period.',
      },
      {
        id: 'suppliers',
        title: 'Supplier performance',
        columns: ['Supplier', 'Orders', 'Purchase value'],
        rows: report.purchasing.topSuppliers.map((row) => [row.name, row.orders, money(row.value, currency)]),
        emptyMessage: 'No supplier activity was recorded for this period.',
      },
      {
        id: 'payables',
        title: 'Supplier payables',
        columns: ['Invoice', 'Supplier', 'Due date', 'Total', 'Paid', 'Balance', 'Status'],
        rows: (report.purchasing.payablesInvoices ?? []).map((row) => [row.invoiceNumber, row.supplierName, dateTime(row.dueDate, timezone), money(row.total, currency), money(row.paidAmount, currency), money(row.balance, currency), row.status]),
        emptyMessage: 'No supplier payables are available.',
      },
    );
  } else if (section === 'profit') {
    tables.push({
      id: 'daily-profit',
      title: 'Profit by day',
      columns: ['Date', 'Net sales', 'COGS', 'Gross profit'],
      rows: report.profit.trend.map((row) => [row.date, money(row.netSales, currency), money(row.netCost, currency), money(row.profit, currency)]),
      emptyMessage: 'No profit records were calculated for this period.',
    });
  } else if (section === 'cash') {
    tables.push({
      id: 'shift-log',
      title: 'Shift reconciliation',
      columns: ['Cashier', 'Opened', 'Closed', 'Status', 'Opening cash', 'Cash sales', 'Expected', 'Counted', 'Variance'],
      rows: (report.cash.shiftLogs ?? []).map((row) => [row.cashierName ?? '—', dateTime(row.openedAt, timezone), dateTime(row.closedAt, timezone), row.status, money(row.startingCash, currency), money(row.cashSales, currency), money(row.expectedCash, currency), money(row.countedCash, currency), money(row.variance, currency)]),
      emptyMessage: 'No shifts were recorded for this period.',
    });
  } else if (section === 'audit') {
    tables.push({
      id: 'audit-events',
      title: 'Immutable audit events',
      columns: ['Date', 'Type', 'Record', 'Details', 'Amount', 'Employee'],
      rows: (report.audit?.events ?? []).map((row) => [dateTime(row.createdAt, timezone), row.type, row.title, row.detail, row.amount == null ? '—' : money(row.amount, currency), row.actorName ?? 'System']),
      emptyMessage: 'No audit events were recorded for this period.',
    });
  } else if (section === 'repacking') {
    tables.push({
      id: 'production-batches',
      title: 'Production and repacking batches',
      columns: ['Batch', 'Product', 'Produced', 'Input', 'Unit cost', 'Total cost', 'Yield', 'Recorded'],
      rows: (report.repacking?.batchRows ?? []).map((row) => [row.batchNumber, row.productName, quantity(row.quantityProduced), quantity(row.inputQuantity), money(row.unitCost, currency), money(row.totalCost, currency), percentage(row.yieldPercent), dateTime(row.createdAt, timezone)]),
      emptyMessage: 'No production or repacking batches were recorded for this period.',
    });
  }

  const titles: Record<ReportSectionId, [string, string]> = {
    overview: ['Overview Report', 'Review the branch’s key operating totals and exceptions.'],
    sales: ['Sales Report', 'Reconcile completed sales, discounts, refunds, payments, and transactions.'],
    products: ['Product Performance Report', 'Review quantity, revenue, cost, and gross profit by product.'],
    inventory: ['Inventory Report', 'Review current stock valuation, stock risk, and movement activity.'],
    purchasing: ['Purchasing Report', 'Review orders, receiving, supplier fulfillment, and payables.'],
    profit: ['Profit Report', 'Reconcile net sales, cost of goods sold, gross profit, and margin.'],
    cash: ['Cash & Shift Report', 'Reconcile expected cash, counted cash, and shift variance.'],
    audit: ['Audit Report', 'Review direct immutable records for sensitive operational events.'],
    repacking: ['Repacking Report', 'Review production input, output, yield, loss, and allocated cost.'],
  };

  return { id: section, title: titles[section][0], purpose: titles[section][1], tables };
}

export function reportDocumentRowCount(document: ReportDocumentDefinition): number {
  return document.tables.reduce((total, table) => total + table.rows.length, 0);
}
