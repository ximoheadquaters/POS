import type { Permission, RoleCode } from '@ximo/shared';

export interface RoleAccess {
  id: string;
  code: RoleCode;
  name: string;
  isSystem: boolean;
  userCount: number;
  permissions: Permission[];
  editable: boolean;
  assignable: boolean;
}

export interface PermissionInfo {
  code: Permission;
  description: string;
}

export interface AccessMatrix {
  roles: RoleAccess[];
  permissions: PermissionInfo[];
}

export const PERMISSION_GROUPS: Array<{
  title: string;
  description: string;
  permissions: Permission[];
}> = [
  {
    title: 'Business administration',
    description: 'Organization, branches, settings, and audit records.',
    permissions: [
      'organization:read',
      'organization:update',
      'branches:read',
      'branches:manage',
      'settings:manage',
      'audit:read',
    ],
  },
  {
    title: 'Users and access',
    description: 'View employees or manage their roles and branch assignments.',
    permissions: ['users:read', 'users:manage'],
  },
  {
    title: 'Products, inventory, and transfers',
    description: 'Catalogue maintenance, stock visibility, adjustments, and branch transfers.',
    permissions: [
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
    ],
  },
  {
    title: 'Registers, sales, and returns',
    description: 'Registers, shifts, cash movement, checkout, sales history, and refund approvals.',
    permissions: [
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
    ],
  },
  {
    title: 'Promotions, customers, and reports',
    description: 'Deals & combos, customer records, and business reporting.',
    permissions: [
      'promotions:read',
      'promotions:manage',
      'customers:read',
      'customers:manage',
      'reports:read',
      'reports:view_cost',
      'reports:view_profit',
      'reports:view_all_branches',
      'reports:export',
      'reports:manage_saved_views',
      'reports:view_staff',
      'reports:view_tax',
      'reports:view_platform',
    ],
  },
];

const permissionDependencies: Partial<Record<Permission, Permission>> = {
  'organization:update': 'organization:read',
  'branches:manage': 'branches:read',
  'users:manage': 'users:read',
  'products:manage': 'products:read',
  'inventory:adjust': 'inventory:read',
  'transfers:manage': 'transfers:read',
  'transfers:receive': 'transfers:read',
  'suppliers:manage': 'suppliers:read',
  'purchasing:manage': 'purchasing:read',
  'purchasing:receive': 'purchasing:read',
  'purchasing:return': 'purchasing:read',
  'purchasing:pay': 'purchasing:read',
  'registers:manage': 'registers:read',
  'returns:manage': 'returns:create',
  'promotions:manage': 'promotions:read',
  'customers:manage': 'customers:read',
  'sales:read_all': 'sales:read_branch',
};

export function togglePermission(selected: Permission[], permission: Permission): Permission[] {
  const next = new Set(selected);
  if (next.has(permission)) {
    next.delete(permission);
    for (const [dependent, requirement] of Object.entries(permissionDependencies) as Array<
      [Permission, Permission]
    >) {
      if (requirement === permission) next.delete(dependent);
    }
  } else {
    next.add(permission);
    const requirement = permissionDependencies[permission];
    if (requirement) next.add(requirement);
  }
  return [...next];
}

export function roleDescription(code: RoleCode): string {
  switch (code) {
    case 'owner':
      return 'Business owner with permanent full access.';
    case 'administrator':
      return 'Full operational and configuration access.';
    case 'manager':
      return 'Runs daily operations and supervises employees.';
    case 'cashier':
      return 'Handles checkout, drawer shifts, and branch sales.';
    case 'inventory_staff':
      return 'Maintains the product catalogue and stock.';
  }
}

export function roleLabel(code: RoleCode): string {
  return code
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
