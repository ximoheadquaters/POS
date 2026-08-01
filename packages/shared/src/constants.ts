export const ROLE_CODES = [
  'owner',
  'administrator',
  'manager',
  'cashier',
  'inventory_staff',
] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export const EMPLOYEE_ROLE_CODES = ['manager', 'cashier', 'inventory_staff'] as const;
export type EmployeeRoleCode = (typeof EMPLOYEE_ROLE_CODES)[number];

export const HARDWARE_MODULE_CODES = [
  'barcode_scanner',
  'receipt_printer',
  'cash_drawer',
  'payment_terminal',
  'customer_display',
] as const;
export type HardwareModuleCode = (typeof HARDWARE_MODULE_CODES)[number];

export const MODULE_CODES = [
  'dashboard',
  'pos',
  'products',
  'inventory',
  'customers',
  'returns',
  'registers',
  'reports',
  'suppliers',
  'purchasing',
  'stock_transfers',
  'expenses',
  'promotions',
  'loyalty',
  'integrations',
  'audit',
  ...HARDWARE_MODULE_CODES,
] as const;
export type ModuleCode = (typeof MODULE_CODES)[number];

export const PERMISSIONS = [
  'organization:read',
  'organization:update',
  'branches:read',
  'branches:manage',
  'users:read',
  'users:manage',
  'products:read',
  'products:manage',
  'inventory:read',
  'inventory:adjust',
  'transfers:read',
  'transfers:manage',
  'transfers:receive',
  'suppliers:read',
  'suppliers:manage',
  'purchasing:read',
  'purchasing:manage',
  'purchasing:receive',
  'purchasing:return',
  'purchasing:pay',
  'registers:read',
  'registers:manage',
  'shifts:open',
  'shifts:close',
  'cash:move',
  'sales:create',
  'sales:read_branch',
  'sales:read_all',
  'returns:create',
  'returns:manage',
  'customers:read',
  'customers:manage',
  'promotions:read',
  'promotions:manage',
  'reports:read',
  'settings:manage',
  'audit:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PAYMENT_METHODS = ['cash', 'card', 'ewallet'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PRODUCT_UNITS = [
  'piece',
  'serving',
  'box',
  'pack',
  'bottle',
  'can',
  'ml',
  'l',
  'g',
  'kg',
] as const;
export type KnownProductUnit = (typeof PRODUCT_UNITS)[number];
export type ProductUnit = string;
