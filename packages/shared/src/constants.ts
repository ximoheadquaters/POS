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

export const BUSINESS_PROFILES = ['retail', 'food_service', 'hybrid'] as const;
export type BusinessProfile = (typeof BUSINESS_PROFILES)[number];

export const PREPARATION_BEHAVIORS = ['standard', 'cook_to_order', 'preproduced'] as const;
export type PreparationBehavior = (typeof PREPARATION_BEHAVIORS)[number];

export const HARDWARE_MODULE_CODES = [
  'barcode_scanner',
  'receipt_printer',
  'cash_drawer',
  'payment_terminal',
  'customer_display',
] as const;
export type HardwareModuleCode = (typeof HARDWARE_MODULE_CODES)[number];

export const FOOD_SERVICE_MODULE_CODES = [
  'ingredients',
  'recipes',
  'prepared_food',
  'production',
  'held_sales',
] as const;
export type FoodServiceModuleCode = (typeof FOOD_SERVICE_MODULE_CODES)[number];

export const PLANNED_MODULE_CODES = [
  'food_waste',
  'order_types',
  'tables',
  'menu_modifiers',
  'kitchen_tickets',
  'kitchen_display',
  'order_status',
  'waiter_assignment',
  'split_bill',
  'service_charge',
  'delivery_orders',
] as const;
export type PlannedModuleCode = (typeof PLANNED_MODULE_CODES)[number];

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
  'offline',
  ...HARDWARE_MODULE_CODES,
  ...FOOD_SERVICE_MODULE_CODES,
  ...PLANNED_MODULE_CODES,
] as const;
export type ModuleCode = (typeof MODULE_CODES)[number];

export const MODULE_DEPENDENCIES: Partial<Record<ModuleCode, readonly ModuleCode[]>> = {
  ingredients: ['products', 'inventory'],
  recipes: ['ingredients', 'products', 'inventory'],
  prepared_food: ['recipes'],
  production: ['inventory'],
  held_sales: ['pos'],
  purchasing: ['suppliers', 'inventory'],
  stock_transfers: ['inventory'],
  offline: ['pos'],
} as const;

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
  'reports:view_cost',
  'reports:view_profit',
  'reports:view_all_branches',
  'reports:export',
  'reports:manage_saved_views',
  'reports:view_staff',
  'reports:view_tax',
  'reports:view_platform',
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
  'sack',
  'bottle',
  'can',
  'ml',
  'l',
  'g',
  'kg',
] as const;
export type KnownProductUnit = (typeof PRODUCT_UNITS)[number];
export type ProductUnit = string;
