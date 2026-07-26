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
  'expenses',
  'promotions',
  'loyalty',
  'integrations',
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
  'registers:read',
  'registers:manage',
  'shifts:open',
  'shifts:close',
  'cash:move',
  'sales:create',
  'sales:read_branch',
  'sales:read_all',
  'returns:create',
  'customers:read',
  'customers:manage',
  'reports:read',
  'settings:manage',
  'audit:read',
  'modules:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PAYMENT_METHODS = ['cash', 'card', 'ewallet'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
