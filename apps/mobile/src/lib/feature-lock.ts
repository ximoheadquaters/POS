import type { ModuleCode, Permission } from '@ximo/shared';

export type FeatureAvailability =
  | { state: 'available' }
  | { state: 'profile_not_applicable'; featureName: string }
  | { state: 'plan_required'; featureName: string; requiredPlan: string; canManageBilling: boolean }
  | { state: 'module_disabled'; featureName: string; module: ModuleCode; canManageModules: boolean }
  | { state: 'permission_denied'; featureName: string; permission: Permission };

export interface ResolveFeatureLockInput {
  featureName: string;
  module?: ModuleCode;
  permission?: Permission;
  proOnly?: boolean;
  applicableProfiles?: Array<'retail' | 'food_service' | 'hybrid'>;
  user: {
    businessProfile?: string;
    modules?: string[];
    permissions?: string[];
    plan?: string;
    role?: string;
  } | null;
}

export function resolveFeatureLock(input: ResolveFeatureLockInput): FeatureAvailability {
  const { user, featureName, module, permission, proOnly, applicableProfiles } = input;
  if (!user) return { state: 'available' };

  // 1. Business Profile Applicability
  if (
    applicableProfiles &&
    applicableProfiles.length > 0 &&
    user.businessProfile &&
    !applicableProfiles.includes(user.businessProfile as any)
  ) {
    return { state: 'profile_not_applicable', featureName };
  }

  const isAdmin =
    Boolean(user.permissions?.includes('organization:manage')) ||
    user.role === 'owner' ||
    Boolean(user.permissions?.includes('users:manage'));

  // 2. Subscription Plan Requirement (Pro Tier)
  if (proOnly && user.plan !== 'pro' && user.plan !== 'enterprise') {
    return {
      state: 'plan_required',
      featureName,
      requiredPlan: 'Pro',
      canManageBilling: isAdmin,
    };
  }

  // 3. Module Entitlement Check
  if (module && !user.modules?.includes(module)) {
    return {
      state: 'module_disabled',
      featureName,
      module,
      canManageModules: isAdmin,
    };
  }

  // 4. Current User Permission Check
  if (permission && !user.permissions?.includes(permission)) {
    return {
      state: 'permission_denied',
      featureName,
      permission,
    };
  }

  // 5. Available
  return { state: 'available' };
}

export interface SidebarSectionDef {
  sectionTitle: string;
  groups: Array<{
    id: string;
    title: string;
    items?: Array<{ title: string; href: string }>;
  }>;
}

export const RETAIL_SIDEBAR_SECTIONS: SidebarSectionDef[] = [
  {
    sectionTitle: 'DAILY WORK',
    groups: [
      { id: 'dashboard', title: 'Dashboard' },
      { id: 'pos', title: 'POS' },
      { id: 'sales', title: 'Sales & Orders' },
    ],
  },
  {
    sectionTitle: 'CATALOG',
    groups: [
      {
        id: 'products',
        title: 'Product Catalogue',
        items: [
          { title: 'Overview', href: '/products' },
          { title: 'Categories', href: '/catalogue' },
          { title: 'Variants', href: '/product-variants' },
        ],
      },
      { id: 'customers', title: 'Customers' },
      { id: 'promotions', title: 'Promotions & Combos' },
    ],
  },
  {
    sectionTitle: 'INVENTORY',
    groups: [
      {
        id: 'inventory_tools',
        title: 'Stock & Restock',
        items: [
          { title: 'Stock Overview', href: '/(tabs)/inventory' },
          { title: 'Purchasing & Restock', href: '/purchasing' },
          { title: 'Stock Adjustments', href: '/stock-adjustment' },
          { title: 'Branch Transfers', href: '/stock-transfers' },
          { title: 'Repacking', href: '/retail/repacking' },
        ],
      },
    ],
  },
  {
    sectionTitle: 'STORE MANAGEMENT',
    groups: [
      { id: 'registers', title: 'Registers & Shifts' },
      { id: 'reports', title: 'Income & Reports' },
      { id: 'settings', title: 'Settings & Admin' },
    ],
  },
];

export function filterSectionsByProfile(user: { businessProfile?: string } | null): SidebarSectionDef[] {
  const profile = user?.businessProfile ?? 'retail';
  if (profile === 'retail') {
    return RETAIL_SIDEBAR_SECTIONS;
  }
  return [
    ...RETAIL_SIDEBAR_SECTIONS,
    {
      sectionTitle: 'FOOD SERVICE',
      groups: [
        {
          id: 'food_service',
          title: 'Food & Recipes',
        },
      ],
    },
  ];
}
export function isPathActive(pathname: string, href: string): boolean {
  const current = (pathname || '').split('?')[0].replace(/\/$/, '') || '/';
  const target = String(href).split('?')[0].replace('/(tabs)', '').replace(/\/$/, '') || '/';

  // Exact match
  if (current === target) return true;

  // Dashboard / root only matches exact root
  if (target === '/' || current === '/') return false;

  // Sub-routes must match with slash delimiter (e.g. /products/new matches /products, but NOT /product-variants or /production)
  if (current.startsWith(`${target}/`)) return true;

  // Specific alias routes where details pages belong exclusively to a parent group
  if (target === '/purchasing' && (current.startsWith('/purchase/') || current.startsWith('/supplier/'))) {
    return true;
  }

  return false;
}
