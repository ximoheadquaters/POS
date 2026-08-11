export interface PayablesInvoiceDetail {
  id: string;
  invoiceNumber: string;
  supplierName: string;
  poNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  total: string;
  paidAmount: string;
  balance: string;
  status: string;
  notes?: string;
  branchName?: string;
}

export interface PurchaseOrderDetail {
  id: string;
  poNumber: string;
  supplierName: string;
  orderDate?: string;
  status: string;
  total: string;
  branchName?: string;
}

export interface SalesReceiptDetail {
  id: string;
  receiptNumber: string;
  status: string;
  paymentMethod: string;
  completedAt?: string;
  total: string;
  discount?: string;
  tax?: string;
  branchName?: string;
  cashierName?: string;
}

export interface ShiftLogDetail {
  id: string;
  cashierName?: string;
  openedAt?: string;
  closedAt?: string;
  status: string;
  startingCash?: string;
  cashSales?: string;
  expectedCash?: string;
  countedCash?: string;
  variance?: string;
  branchName?: string;
}

export interface ReportsWorkspace {
  range?: { from: string; to: string; branchId: string | null };
  metadata?: {
    generatedAt: string;
    timezone: string;
    currency: string;
    branchName: string;
    status: 'ready' | 'refreshing' | 'processing';
    version: string;
  };
  kpis: {
    grossSales: string;
    netSales: string;
    customerRefunds: string;
    discounts: string;
    taxes: string;
    transactions: number;
    uniqueCustomers: number;
    averageTransaction: string;
    averageItemsPerTransaction?: string;
    itemsSold: number;
    netCost: string | null;
    grossProfit: string | null;
    grossMarginPercent: string | null;
    refundRatePercent: string;
  };
  sales: {
    paymentMethods: Array<{ method: string; total: string; transactions: number }>;
    topProducts: Array<{
      name: string;
      sku: string;
      unit: string;
      category?: string;
      quantity: number;
      sales: string;
      cost: string | null;
      profit: string | null;
    }>;
    topCategories: Array<{ name: string; sales: string; quantity: number }>;
    branches: Array<{ id: string; name: string; sales: string; transactions: number }>;
    trend: Array<{ date: string; sales: string; transactions: number }>;
    salesReceipts?: SalesReceiptDetail[];
  };
  inventory: {
    stockRecords: number;
    activeProducts: number;
    unitsOnHand: number;
    inventoryValue: string | null;
    retailValue?: string;
    stockValue: string;
    lowStockCount: number;
    outOfStockCount: number;
    deadStockCount?: number;
    stockTurnover?: string | null;
    lowStock: Array<{
      id: string;
      name: string;
      sku: string;
      unit: string;
      branchName: string;
      quantity: number;
      lowStockLevel: number;
      inventoryValue: string;
    }>;
    byCategory: Array<{ name: string; value: string; quantity: number; products: number }>;
    movements: Array<{ type: string; movements: number; quantity: number }>;
  };
  purchasing: {
    purchaseOrders: number;
    openOrders: number;
    orderedValue: string;
    receivedValue: string;
    supplierReturns: string;
    outstandingPayables: string;
    supplierPayments: string;
    supplierRefunds: string;
    receivingAccuracy?: string;
    supplierFulfillmentRate?: string;
    orderStatuses: Array<{ status: string; orders: number; value: string }>;
    topSuppliers: Array<{ id: string; name: string; orders: number; value: string }>;
    payablesInvoices?: PayablesInvoiceDetail[];
    purchaseOrdersList?: PurchaseOrderDetail[];
  };
  profit: {
    grossSales: string;
    refunds: string;
    netSales: string;
    netCost: string | null;
    grossProfit: string | null;
    grossMarginPercent: string | null;
    trend: Array<{ date: string; netSales: string; netCost: string; profit: string }>;
  };
  cash: {
    shifts: number;
    openShifts: number;
    cashSales: string;
    cashRefunds: string;
    countedCash: string;
    variance: string;
    cashIn: string;
    cashOut: string;
    expectedCash?: string;
    drawerBalance?: string;
    shiftLogs?: ShiftLogDetail[];
  };
  audit?: {
    voidedSales: number;
    refundTransactions: number;
    refundAmount: string;
    inventoryAdjustments: number;
    cashAdjustments: number;
    events: Array<{
      id: string;
      type: 'void' | 'refund' | 'inventory' | 'cash';
      title: string;
      detail: string;
      amount: string | null;
      actorName: string | null;
      branchName: string;
      createdAt: string;
    }>;
  };
  repacking?: {
    batches: number;
    outputQuantity: number;
    inputQuantity: number;
    totalCost: string;
    averageCostPerOutput: string;
    yieldPercent: string | null;
    lossPercent: string | null;
    batchRows: Array<{
      id: string;
      batchNumber: string;
      productName: string;
      quantityProduced: number;
      inputQuantity: number;
      totalCost: string;
      unitCost: string;
      yieldPercent: string | null;
      createdAt: string;
    }>;
  };
}

export interface ReportExportMetadata {
  organizationName: string;
  branchName: string;
  rangeLabel: string;
  from: string;
  to: string;
  generatedAt?: Date;
}

export interface InventoryReportStockRow {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  inventoryRole: string;
  unit: string;
  quantity: number;
  sealedQuantity: number;
  openedQuantity: number;
  lowStockLevel: number;
  isLowStock: boolean;
  averageCost: string | null;
  inventoryValue: string | null;
  branchName: string;
  conversionHint: string | null;
}

export interface InventoryReportConversionRow {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  baseUnit: string;
  sellingUnit: string;
  sellingUnitName: string;
  unitsPerBase: number;
  isPortioningContainer: boolean;
  ruleLabel: string;
}

export interface InventoryReportMovementRow {
  id: string;
  createdAt: string;
  productName: string;
  sku: string;
  unit: string;
  type: string;
  quantityDelta: number;
  quantityAfter: number;
  reason: string;
  createdBy: string | null;
  conversionLabel: string | null;
  branchName: string;
}

export interface InventoryReportResponse {
  title: string;
  range: { from: string; to: string; branchId: string | null };
  stock: InventoryReportStockRow[];
  conversions: InventoryReportConversionRow[];
  movements: InventoryReportMovementRow[];
  movementsTotal: number;
  page: number;
  pageSize: number;
}

