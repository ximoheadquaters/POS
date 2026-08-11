export type ReportMetricFormat = 'currency' | 'number' | 'percentage';

export interface ReportMetricDefinition {
  id: string;
  label: string;
  description: string;
  formula: string;
  format: ReportMetricFormat;
  auditRule?: string;
}

/**
 * Canonical Ximo reporting glossary. UI cards, APIs, exports, and tests should
 * reference these IDs instead of inventing local definitions.
 */
export const REPORT_METRICS: Record<string, ReportMetricDefinition> = {
  gross_sales: {
    id: 'gross_sales',
    label: 'Gross Sales',
    description: 'Completed sale value before discounts and customer refunds.',
    formula: 'SUM(sale_items.unit_price × sale_items.quantity)',
    format: 'currency',
  },
  total_discounts: {
    id: 'total_discounts',
    label: 'Total Discounts',
    description: 'All promotion, manual, statutory, and employee discounts.',
    formula: 'SUM(sales.discount_total)',
    format: 'currency',
  },
  refund_amount: {
    id: 'refund_amount',
    label: 'Refund Amount',
    description: 'Value returned to customers during the selected period.',
    formula: 'SUM(returns.refund_total)',
    format: 'currency',
    auditRule: 'Read directly from immutable return records.',
  },
  net_sales: {
    id: 'net_sales',
    label: 'Net Sales',
    description: 'Revenue after discounts and refunds.',
    formula: 'Gross Sales − Total Discounts − Refund Amount',
    format: 'currency',
  },
  cogs: {
    id: 'cogs',
    label: 'Cost of Goods Sold (COGS)',
    description: 'Inventory cost attached to sold quantities, net of returned cost.',
    formula: 'SUM(sale item cost × quantity sold) − returned item cost',
    format: 'currency',
  },
  gross_profit: {
    id: 'gross_profit',
    label: 'Gross Profit',
    description: 'Net sales remaining after inventory cost.',
    formula: 'Net Sales − COGS',
    format: 'currency',
  },
  profit_margin: {
    id: 'profit_margin',
    label: 'Profit Margin',
    description: 'Gross profit as a percentage of net sales.',
    formula: '(Gross Profit ÷ Net Sales) × 100',
    format: 'percentage',
  },
  average_transaction_value: {
    id: 'average_transaction_value',
    label: 'Average Transaction Value',
    description: 'Average net revenue per completed transaction.',
    formula: 'Net Sales ÷ Completed Transactions',
    format: 'currency',
  },
  average_items_per_transaction: {
    id: 'average_items_per_transaction',
    label: 'Average Items per Transaction',
    description: 'Average selling-unit quantity in each completed transaction.',
    formula: 'Total Quantity Sold ÷ Completed Transactions',
    format: 'number',
  },
  inventory_value_cost: {
    id: 'inventory_value_cost',
    label: 'Inventory Value (Cost)',
    description: 'Current on-hand stock valued at weighted average unit cost.',
    formula: 'SUM(Current Stock × Unit Cost)',
    format: 'currency',
  },
  inventory_value_retail: {
    id: 'inventory_value_retail',
    label: 'Inventory Value (Retail)',
    description: 'Potential retail value of current available stock.',
    formula: 'SUM(Current Stock × Selling Price)',
    format: 'currency',
  },
  inventory_quantity: {
    id: 'inventory_quantity',
    label: 'Inventory Quantity',
    description: 'Available base inventory quantity.',
    formula: 'SUM(Current Available Stock)',
    format: 'number',
  },
  stock_turnover: {
    id: 'stock_turnover',
    label: 'Stock Turnover',
    description: 'How often cost inventory is sold through during the period.',
    formula: 'COGS ÷ Average Inventory Value',
    format: 'number',
  },
  dead_stock: {
    id: 'dead_stock',
    label: 'Dead Stock',
    description: 'Products with on-hand stock and no sales in the last 90 days.',
    formula: 'COUNT(products with stock > 0 and no completed sale in 90 days)',
    format: 'number',
  },
  purchase_value: {
    id: 'purchase_value',
    label: 'Purchase Value',
    description: 'Value of non-draft, non-cancelled purchase orders.',
    formula: 'SUM(Purchase Order Total)',
    format: 'currency',
  },
  receiving_accuracy: {
    id: 'receiving_accuracy',
    label: 'Receiving Accuracy',
    description: 'Share of ordered quantity that was received.',
    formula: '(Received Quantity ÷ Ordered Quantity) × 100',
    format: 'percentage',
  },
  supplier_fulfillment_rate: {
    id: 'supplier_fulfillment_rate',
    label: 'Supplier Fulfillment Rate',
    description: 'Share of purchase orders fully delivered.',
    formula: '(Orders Fully Delivered ÷ Total Purchase Orders) × 100',
    format: 'percentage',
  },
  cash_variance: {
    id: 'cash_variance',
    label: 'Cash Variance',
    description: 'Difference between counted and expected cash at shift close.',
    formula: 'Closing Cash − Expected Cash',
    format: 'currency',
    auditRule: 'Read directly from immutable shift and cash movement records.',
  },
  cash_drawer_balance: {
    id: 'cash_drawer_balance',
    label: 'Cash Drawer Balance',
    description: 'Expected drawer cash after cash sales and movements.',
    formula: 'Opening Cash + Cash Sales − Cash Out ± Adjustments',
    format: 'currency',
  },
  yield_percent: {
    id: 'yield_percent',
    label: 'Yield %',
    description: 'Measured output compared with measured production input.',
    formula: '((Output Quantity × Output Unit Size) ÷ (Input Quantity × Input Unit Size)) × 100',
    format: 'percentage',
  },
  loss_percent: {
    id: 'loss_percent',
    label: 'Loss %',
    description: 'Measured production loss.',
    formula: '100 − Yield %',
    format: 'percentage',
  },
  cost_allocation: {
    id: 'cost_allocation',
    label: 'Cost Allocation',
    description: 'Weighted average ingredient cost allocated to output.',
    formula: 'SUM(consumed ingredient cost) ÷ Output Quantity',
    format: 'currency',
  },
};

export type ReportAccessLevel = 'full' | 'own' | 'limited' | 'receiving' | 'read_only' | 'none' | 'optional';

export const REPORT_PERMISSION_MATRIX: Record<string, Record<string, ReportAccessLevel>> = {
  overview: { owner: 'full', administrator: 'full', manager: 'full', cashier: 'own', inventory_staff: 'limited', purchasing_staff: 'limited', auditor: 'full' },
  sales: { owner: 'full', administrator: 'full', manager: 'full', cashier: 'own', inventory_staff: 'none', purchasing_staff: 'none', auditor: 'full' },
  products: { owner: 'full', administrator: 'full', manager: 'full', cashier: 'none', inventory_staff: 'full', purchasing_staff: 'full', auditor: 'full' },
  inventory: { owner: 'full', administrator: 'full', manager: 'full', cashier: 'limited', inventory_staff: 'full', purchasing_staff: 'full', auditor: 'full' },
  purchasing: { owner: 'full', administrator: 'full', manager: 'full', cashier: 'none', inventory_staff: 'receiving', purchasing_staff: 'full', auditor: 'full' },
  financial: { owner: 'full', administrator: 'full', manager: 'optional', cashier: 'none', inventory_staff: 'none', purchasing_staff: 'none', auditor: 'read_only' },
  cash: { owner: 'full', administrator: 'full', manager: 'full', cashier: 'own', inventory_staff: 'none', purchasing_staff: 'none', auditor: 'full' },
  audit: { owner: 'full', administrator: 'full', manager: 'full', cashier: 'none', inventory_staff: 'none', purchasing_staff: 'none', auditor: 'read_only' },
  repacking: { owner: 'full', administrator: 'full', manager: 'full', cashier: 'none', inventory_staff: 'full', purchasing_staff: 'limited', auditor: 'full' },
};

