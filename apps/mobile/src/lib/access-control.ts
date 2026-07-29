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
    description: 'Organization, branches, settings, modules, and audit records.',
    permissions: [
      'organization:read',
      'organization:update',
      'branches:read',
      'branches:manage',
      'settings:manage',
      'modules:manage',
      'audit:read',
    ],
  },
  {
    title: 'Users and access',
    description: 'View employees or manage their roles and branch assignments.',
    permissions: ['users:read', 'users:manage'],
  },
  {
    title: 'Products and inventory',
    description: 'Catalogue maintenance, stock visibility, and stock adjustments.',
    permissions: [
      'products:read',
      'products:manage',
      'inventory:read',
      'inventory:adjust',
      'suppliers:read',
      'suppliers:manage',
      'purchasing:read',
      'purchasing:manage',
      'purchasing:receive',
      'purchasing:return',
    ],
  },
  {
    title: 'Registers and sales',
    description: 'Registers, shifts, cash movement, checkout, and sales history.',
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
    ],
  },
  {
    title: 'Customers and reports',
    description: 'Customer records and business reporting.',
    permissions: ['customers:read', 'customers:manage', 'reports:read'],
  },
];

const permissionDependencies: Partial<Record<Permission, Permission>> = {
  'organization:update': 'organization:read',
  'branches:manage': 'branches:read',
  'users:manage': 'users:read',
  'products:manage': 'products:read',
  'inventory:adjust': 'inventory:read',
  'suppliers:manage': 'suppliers:read',
  'purchasing:manage': 'purchasing:read',
  'purchasing:receive': 'purchasing:read',
  'purchasing:return': 'purchasing:read',
  'registers:manage': 'registers:read',
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
