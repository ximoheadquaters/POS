import type { Permission } from './constants.js';

export interface ReportDefinition {
  reportId: string;
  reportName: string;
  description: string;
  category: 'sales' | 'inventory' | 'purchasing' | 'food_service' | 'shifts' | 'platform';
  requiredModules: string[];
  requiredCapabilities: Permission[];
  allowedBusinessProfiles: Array<'retail' | 'food_service' | 'hybrid'>;
  availableFilters: string[];
  availableGroupings: string[];
  supportedCharts: Array<'line' | 'bar' | 'donut' | 'radial'>;
  supportedExports: Array<'pdf' | 'xlsx' | 'csv'>;
  sensitiveFields: string[];
  defaultDateRange: string;
}

export const REPORT_CATALOG: ReportDefinition[] = [
  {
    reportId: 'sales_overview',
    reportName: 'Sales Overview',
    description: 'Executive revenue, transaction, and profitability performance',
    category: 'sales',
    requiredModules: ['dashboard'],
    requiredCapabilities: ['reports:read'],
    allowedBusinessProfiles: ['retail', 'food_service', 'hybrid'],
    availableFilters: ['dateRange', 'branchId', 'cashierId', 'paymentMethod'],
    availableGroupings: ['day', 'branch', 'category', 'paymentMethod'],
    supportedCharts: ['line', 'donut', 'bar'],
    supportedExports: ['pdf', 'xlsx', 'csv'],
    sensitiveFields: ['netCost', 'grossProfit', 'grossMarginPercent'],
    defaultDateRange: '30d',
  },
  {
    reportId: 'sales_summary',
    reportName: 'Sales Summary Proof Report',
    description: 'Canonical sales, refund, tax, discount, and alternate-unit performance summary',
    category: 'sales',
    requiredModules: ['dashboard'],
    requiredCapabilities: ['reports:read'],
    allowedBusinessProfiles: ['retail', 'food_service', 'hybrid'],
    availableFilters: ['dateRange', 'branchId'],
    availableGroupings: ['product', 'category', 'branch'],
    supportedCharts: ['line', 'bar'],
    supportedExports: ['pdf', 'xlsx', 'csv'],
    sensitiveFields: ['netCost', 'grossProfit', 'grossMarginPercent'],
    defaultDateRange: '30d',
  },
  {
    reportId: 'product_performance',
    reportName: 'Product Performance',
    description: 'Product sales volume, alternate selling unit breakdowns, and product gross profit',
    category: 'sales',
    requiredModules: ['dashboard'],
    requiredCapabilities: ['reports:read'],
    allowedBusinessProfiles: ['retail', 'food_service', 'hybrid'],
    availableFilters: ['dateRange', 'branchId', 'categoryId'],
    availableGroupings: ['product', 'category', 'sellingUnit'],
    supportedCharts: ['bar', 'donut'],
    supportedExports: ['pdf', 'xlsx', 'csv'],
    sensitiveFields: ['unitCost', 'netCost', 'grossProfit', 'grossMarginPercent'],
    defaultDateRange: '30d',
  },
  {
    reportId: 'inventory_valuation',
    reportName: 'Inventory Valuation',
    description: 'Stock on hand quantities, low-stock alerts, and stock valuation by branch',
    category: 'inventory',
    requiredModules: ['inventory'],
    requiredCapabilities: ['reports:read'],
    allowedBusinessProfiles: ['retail', 'food_service', 'hybrid'],
    availableFilters: ['branchId', 'categoryId'],
    availableGroupings: ['category', 'branch', 'status'],
    supportedCharts: ['radial', 'donut'],
    supportedExports: ['pdf', 'xlsx', 'csv'],
    sensitiveFields: ['inventoryValue', 'averageCost'],
    defaultDateRange: 'today',
  },
  {
    reportId: 'purchasing_summary',
    reportName: 'Purchasing & Supplier Payables',
    description: 'Purchase orders, stock receipts, and unpaid supplier invoices',
    category: 'purchasing',
    requiredModules: ['purchasing'],
    requiredCapabilities: ['reports:read', 'purchasing:read'],
    allowedBusinessProfiles: ['retail', 'food_service', 'hybrid'],
    availableFilters: ['dateRange', 'branchId', 'supplierId'],
    availableGroupings: ['supplier', 'status'],
    supportedCharts: ['bar', 'radial'],
    supportedExports: ['pdf', 'xlsx', 'csv'],
    sensitiveFields: ['outstandingPayables', 'orderedValue', 'receivedValue'],
    defaultDateRange: '30d',
  },
  {
    reportId: 'recipe_costing',
    reportName: 'Recipe Cost & Ingredient Usage',
    description: 'Food service recipe cost %, theoretical ingredient usage, and margin',
    category: 'food_service',
    requiredModules: ['recipes'],
    requiredCapabilities: ['reports:read'],
    allowedBusinessProfiles: ['food_service', 'hybrid'],
    availableFilters: ['dateRange', 'branchId'],
    availableGroupings: ['recipe', 'ingredient'],
    supportedCharts: ['bar', 'radial'],
    supportedExports: ['pdf', 'xlsx', 'csv'],
    sensitiveFields: ['recipeCost', 'costPerServing', 'foodCostPercent', 'grossMarginPercent'],
    defaultDateRange: '30d',
  },
];
