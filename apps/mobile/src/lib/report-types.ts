export interface ReportsWorkspace {
  range?: { from: string; to: string; branchId: string | null };
  kpis: {
    grossSales: string;
    netSales: string;
    customerRefunds: string;
    discounts: string;
    taxes: string;
    transactions: number;
    uniqueCustomers: number;
    averageTransaction: string;
    itemsSold: number;
    netCost: string;
    grossProfit: string;
    grossMarginPercent: string;
    refundRatePercent: string;
  };
  sales: {
    paymentMethods: Array<{ method: string; total: string; transactions: number }>;
    topProducts: Array<{
      name: string;
      sku: string;
      unit: string;
      quantity: number;
      sales: string;
      cost: string;
      profit: string;
    }>;
    topCategories: Array<{ name: string; sales: string; quantity: number }>;
    branches: Array<{ id: string; name: string; sales: string; transactions: number }>;
    trend: Array<{ date: string; sales: string; transactions: number }>;
  };
  inventory: {
    stockRecords: number;
    activeProducts: number;
    unitsOnHand: number;
    inventoryValue: string;
    stockValue: string;
    lowStockCount: number;
    outOfStockCount: number;
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
    orderStatuses: Array<{ status: string; orders: number; value: string }>;
    topSuppliers: Array<{ id: string; name: string; orders: number; value: string }>;
  };
  profit: {
    grossSales: string;
    refunds: string;
    netSales: string;
    netCost: string;
    grossProfit: string;
    grossMarginPercent: string;
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
