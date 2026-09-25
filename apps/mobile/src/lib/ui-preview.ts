import type { CurrentUser } from '@ximo/shared';

const previewStorageKey = 'ximo.ui-preview';

function browserWindow(): (Window & typeof globalThis) | undefined {
  return typeof window === 'undefined' ? undefined : window;
}

/**
 * A review-only mode for the local web build. `?preview=1` enables it and the
 * flag survives client-side navigation in that tab, letting reviewers see the
 * real application screens without a working API or a real user session.
 */
export function isUiPreviewMode(): boolean {
  const target = browserWindow();
  if (!target) return false;
  if (new URLSearchParams(target.location.search).get('preview') === '1') {
    try {
      target.sessionStorage.setItem(previewStorageKey, '1');
    } catch {
      // Preview still works on the first route if session storage is unavailable.
    }
    return true;
  }
  try {
    return target.sessionStorage.getItem(previewStorageKey) === '1';
  } catch {
    return false;
  }
}

export const previewCurrentUser: CurrentUser = {
  id: 'preview-user',
  email: 'preview@ximo.local',
  displayName: 'Alex Rivera',
  organization: {
    id: 'preview-organization',
    name: 'Ximo Preview Store',
    currency: 'PHP',
    timezone: 'Asia/Manila',
    businessProfile: 'retail',
    subscriptionStatus: 'active',
  },
  role: 'owner',
  permissions: [
    'reports:read',
    'branches:read',
    'products:read',
    'products:manage',
    'inventory:read',
    'sales:read_all',
    'registers:read',
    'customers:read',
    'settings:manage',
  ],
  modules: [
    'dashboard',
    'pos',
    'products',
    'inventory',
    'registers',
    'customers',
    'promotions',
    'reports',
    'barcode_scanner',
  ],
  branches: [{ id: 'preview-main-branch', name: 'Main Branch', code: 'MAIN' }],
  mustChangePassword: false,
};

const products = [
  {
    id: 'preview-coffee',
    name: 'House Blend Coffee',
    sku: 'COF-001',
    unit: 'bag',
    sellingPrice: '145.00',
    cost: '78.00',
    averageCost: '78.00',
    grossMarginPercent: '46.21',
    suggestedSellingPrice: '145.00',
    targetMarginPercent: '45.00',
    lowMarginThresholdPercent: '20.00',
    isLowMargin: false,
    status: 'active',
    trackInventory: true,
    availableQuantity: 18,
    lowStockLevel: 5,
    categoryName: 'Beverages',
    inventoryRole: 'sellable',
    taxRate: '0.00',
    isTaxInclusive: true,
    unitsPerBase: 1,
    sellingUnits: [],
  },
  {
    id: 'preview-cookie',
    name: 'Chocolate Chip Cookie',
    sku: 'BAK-014',
    unit: 'piece',
    sellingPrice: '55.00',
    cost: '20.00',
    averageCost: '20.00',
    grossMarginPercent: '63.64',
    suggestedSellingPrice: '55.00',
    targetMarginPercent: '55.00',
    lowMarginThresholdPercent: '20.00',
    isLowMargin: false,
    status: 'active',
    trackInventory: true,
    availableQuantity: 6,
    lowStockLevel: 8,
    categoryName: 'Bakery',
    inventoryRole: 'sellable',
    taxRate: '0.00',
    isTaxInclusive: true,
    unitsPerBase: 1,
    sellingUnits: [],
  },
  {
    id: 'preview-water',
    name: 'Sparkling Water',
    sku: 'BEV-031',
    unit: 'bottle',
    sellingPrice: '45.00',
    cost: '22.00',
    averageCost: '22.00',
    grossMarginPercent: '51.11',
    suggestedSellingPrice: '45.00',
    targetMarginPercent: '50.00',
    lowMarginThresholdPercent: '20.00',
    isLowMargin: false,
    status: 'active',
    trackInventory: true,
    availableQuantity: 24,
    lowStockLevel: 8,
    categoryName: 'Beverages',
    inventoryRole: 'sellable',
    taxRate: '0.00',
    isTaxInclusive: true,
    unitsPerBase: 1,
    sellingUnits: [],
  },
  {
    id: 'preview-tote',
    name: 'Classic Tote Bag',
    sku: 'MER-008',
    unit: 'piece',
    sellingPrice: '380.00',
    cost: '210.00',
    averageCost: '210.00',
    grossMarginPercent: '44.74',
    suggestedSellingPrice: '380.00',
    targetMarginPercent: '40.00',
    lowMarginThresholdPercent: '20.00',
    isLowMargin: false,
    status: 'active',
    trackInventory: true,
    availableQuantity: 4,
    lowStockLevel: 5,
    categoryName: 'Merchandise',
    inventoryRole: 'sellable',
    taxRate: '0.00',
    isTaxInclusive: true,
    unitsPerBase: 1,
    sellingUnits: [],
  },
];

const inventory = products.map((product) => ({
  id: `inventory-${product.id}`,
  productId: product.id,
  name: product.name,
  sku: product.sku,
  unit: product.unit,
  inventoryRole: product.inventoryRole,
  quantity: product.availableQuantity,
  lowStockLevel: product.lowStockLevel,
  isLowStock: product.availableQuantity <= product.lowStockLevel,
}));

const completedSales = [
  {
    id: 'preview-sale-1048',
    receiptNumber: 'SALE-1048',
    status: 'completed',
    total: '200.00',
    completedAt: new Date().toISOString(),
    cashierName: 'Alex Rivera',
    paymentMethods: ['cash'],
  },
  {
    id: 'preview-sale-1047',
    receiptNumber: 'SALE-1047',
    status: 'completed',
    total: '435.00',
    completedAt: new Date(Date.now() - 3_600_000).toISOString(),
    cashierName: 'Alex Rivera',
    paymentMethods: ['card'],
  },
];

const previewShift = {
  id: 'preview-shift-main-counter',
  status: 'open',
  openedAt: new Date(Date.now() - 4 * 3_600_000).toISOString(),
  branchName: 'Main Branch',
  registerName: 'Main Counter',
  cashierName: 'Alex Rivera',
  cashSales: '150.00',
  cashRefunds: '0.00',
  expectedCash: '150.00',
  actualCash: '150.00',
  variance: '0.00',
  transactions: completedSales.length,
};

/** Returns data shaped like the API for local UI review only. */
export function previewApiResponse<T>(path: string, method = 'GET'): T {
  const pathname = path.split('?')[0] ?? path;
  if (method !== 'GET') return {} as T;
  if (pathname === '/auth/current') return previewCurrentUser as T;
  if (pathname === '/reports/summary') {
    return {
      salesTotal: '12480.00',
      transactions: 18,
      averageTransaction: '693.33',
      grossProfit: '5120.00',
      salesByPaymentMethod: [
        { method: 'cash', total: '7280.00' },
        { method: 'card', total: '5200.00' },
      ],
      bestSellingProducts: [
        { name: 'House Blend Coffee', quantity: 12, total: '1740.00', unit: 'bag' },
        { name: 'Chocolate Chip Cookie', quantity: 9, total: '495.00', unit: 'piece' },
      ],
      lowStock: inventory.filter((item) => item.isLowStock).map((item) => ({
        name: item.name,
        branchName: 'Main Branch',
        quantity: item.quantity,
        unit: item.unit,
      })),
      salesByBranch: [{ name: 'Main Branch', total: '12480.00', transactions: 18 }],
    } as T;
  }
  if (pathname === '/reports/workspace') {
    const today = new Date();
    return {
      sales: {
        trend: [6, 5, 4, 3, 2, 1, 0].map((daysAgo, index) => {
          const date = new Date(today);
          date.setDate(today.getDate() - daysAgo);
          return { date: date.toISOString().slice(0, 10), sales: String(860 + index * 210), transactions: 4 + index };
        }),
      },
    } as T;
  }
  if (pathname === '/reports/shifts') {
    return {
      summary: {
        shiftCount: 1,
        openShiftCount: 1,
        cashSales: '150.00',
        cashRefunds: '0.00',
        cashIn: '0.00',
        cashOut: '0.00',
        expectedCash: '150.00',
        actualCash: '150.00',
        variance: '0.00',
      },
      shifts: [previewShift],
      total: 1,
    } as T;
  }
  if (pathname.startsWith('/reports/shifts/')) {
    return {
      ...previewShift,
      startingCash: '0.00',
      salesTotal: '635.00',
      movements: [],
      sales: completedSales,
      payments: [{ method: 'cash', payments: '150.00', refunds: '0.00' }],
      refunds: [],
    } as T;
  }
  if (pathname === '/products') return products as T;
  if (pathname.startsWith('/products/')) {
    const found = products.find((product) => pathname.includes(product.id));
    return (found ?? products[0]) as T;
  }
  if (pathname === '/inventory') return inventory as T;
  if (pathname === '/inventory/summary') {
    return { all: inventory.length, sellable: inventory.length, ingredient: 0, both: 0 } as T;
  }
  if (pathname === '/sales') return completedSales as T;
  if (pathname === '/sales/held' || pathname === '/sales/voided-holds') return [] as T;
  if (pathname === '/promotions' || pathname === '/pos/promotions') return [] as T;
  if (pathname === '/categories') {
    return [
      { id: 'preview-beverages', name: 'Beverages', isActive: true },
      { id: 'preview-bakery', name: 'Bakery', isActive: true },
      { id: 'preview-merchandise', name: 'Merchandise', isActive: true },
    ] as T;
  }
  if (pathname === '/brands') return [] as T;
  if (pathname === '/product-units') return [{ id: 'piece', name: 'Piece', code: 'piece', isActive: true }] as T;
  if (pathname === '/registers') return [{ id: 'preview-register', name: 'Main Counter', status: 'active' }] as T;
  if (pathname === '/customers') return [{ id: 'preview-customer', name: 'Walk-in customer', phone: '', email: '' }] as T;
  if (pathname === '/settings') {
    return {
      businessName: 'Ximo Preview Store',
      receiptFooter: 'Thank you for shopping with us!',
      currency: 'PHP',
      timezone: 'Asia/Manila',
    } as T;
  }
  return [] as T;
}
