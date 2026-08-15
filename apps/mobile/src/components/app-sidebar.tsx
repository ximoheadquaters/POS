import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type PropsWithChildren,
} from 'react';
import { Image, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { router, usePathname, type Href } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import type { ModuleCode, Permission } from '@ximo/shared';
import ximoIcon from '../../assets/ximo-icon-2.png';
import { useSession } from '@/providers/session';
import { useBranchStore } from '@/store/branch';

interface SidebarContextValue {
  compact: boolean;
  open: boolean;
  openMenu(): void;
  closeMenu(): void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export interface SidebarSubItem {
  title: string;
  href: Href;
  badge?: string | number;
  badgeColor?: 'emerald' | 'amber' | 'red' | 'blue' | 'gray';
  module?: ModuleCode;
  permission?: Permission;
}

export interface SidebarGroup {
  id: string;
  title: string;
  icon: ComponentProps<typeof Feather>['name'];
  href?: Href;
  children?: SidebarSubItem[];
  module?: ModuleCode;
  permission?: Permission;
}

export interface SidebarSection {
  sectionTitle?: string;
  groups: SidebarGroup[];
}

const sidebarSections: SidebarSection[] = [
  {
    sectionTitle: 'DAILY WORK',
    groups: [
      { id: 'dashboard', title: 'Dashboard', icon: 'grid', href: '/(tabs)', module: 'dashboard' },
      { id: 'pos', title: 'POS', icon: 'shopping-cart', href: '/(tabs)/pos', module: 'pos' },
      { id: 'sales', title: 'Sales & Orders', icon: 'shopping-bag', href: '/(tabs)/sales', module: 'pos' },
    ],
  },
  {
    sectionTitle: 'CATALOG',
    groups: [
      {
        id: 'products',
        title: 'Product Catalog',
        icon: 'box',
        children: [
          { title: 'Overview', href: '/products', module: 'products' },
          { title: 'Categories', href: '/catalogue', module: 'products' },
          { title: 'Selling Units & Barcodes', href: '/product-variants', module: 'products' },
        ],
      },
      { id: 'customers', title: 'Customers', icon: 'user', href: '/customers', module: 'customers' },
      { id: 'promotions', title: 'Promotions & Combos', icon: 'tag', href: '/promotions', module: 'promotions' },
    ],
  },
  {
    sectionTitle: 'INVENTORY',
    groups: [
      {
        id: 'inventory_tools',
        title: 'Stock & Restock',
        icon: 'archive',
        children: [
          { title: 'Stock Overview', href: '/(tabs)/inventory', module: 'inventory' },
          { title: 'Purchasing & Restock', href: '/purchasing', module: 'purchasing', permission: 'purchasing:read' },
          { title: 'Stock Adjustments', href: '/stock-adjustment', module: 'inventory' },
          { title: 'Branch Transfers', href: '/stock-transfers', module: 'stock_transfers' },
          { title: 'Repacking', href: '/retail/repacking', module: 'production' },
        ],
      },
    ],
  },
  {
    sectionTitle: 'STORE MANAGEMENT',
    groups: [
      {
        id: 'registers',
        title: 'Registers & Shifts',
        icon: 'credit-card',
        module: 'registers',
        children: [
          { title: 'Active Register', href: '/registers', module: 'registers' },
          { title: 'Shift History', href: '/shift-reports', module: 'registers' },
        ],
      },
      {
        id: 'reports',
        title: 'Income & Reports',
        icon: 'trending-up',
        module: 'reports',
        children: [
          { title: 'Overview', href: '/reports/overview', module: 'reports' },
          { title: 'Sales', href: '/reports/sales', module: 'reports' },
          { title: 'Products', href: '/reports/products', module: 'reports' },
          { title: 'Inventory', href: '/reports/inventory' as Href, module: 'reports' },
          { title: 'Purchasing', href: '/reports/purchasing' as Href, module: 'reports' },
          { title: 'Profit', href: '/reports/profit' as Href, module: 'reports', permission: 'reports:view_profit' },
          { title: 'Cash & shifts', href: '/reports/cash' as Href, module: 'reports' },
          { title: 'Audit', href: '/reports/audit' as Href, module: 'audit', permission: 'audit:read' },
          { title: 'Repacking', href: '/reports/repacking' as Href, module: 'reports' },
        ],
      },
      {
        id: 'analytics',
        title: 'Analytics',
        icon: 'bar-chart-2',
        href: '/analytics' as Href,
        module: 'reports',
      },
      {
        id: 'settings',
        title: 'Settings & Admin',
        icon: 'settings',
        children: [
          { title: 'Organization', href: '/organization', permission: 'organization:read' },
          { title: 'Branches', href: '/branches' as Href, permission: 'branches:read' },
          { title: 'Store Settings', href: '/settings' },
          { title: 'Staff & Roles', href: '/users', permission: 'users:manage' },
          { title: 'Audit Logs', href: '/audit', module: 'audit', permission: 'audit:read' },
          { title: 'Hardware Devices', href: '/hardware', module: 'receipt_printer' },
          { title: 'Offline Data Sync', href: '/offline-sync', module: 'offline' },
        ],
      },
    ],
  },
  {
    sectionTitle: 'FOOD SERVICE',
    groups: [
      {
        id: 'food_service',
        title: 'Food & Recipes',
        icon: 'coffee',
        children: [
          { title: 'Raw Ingredients', href: '/products?inventoryRole=ingredient', module: 'ingredients' },
          { title: 'BOM Recipes', href: '/products?preparationBehavior=cook_to_order', module: 'recipes' },
          { title: 'Batch Production', href: '/production', module: 'production' },
          { title: 'Parked / Held Sales', href: '/held-sales' as Href, module: 'held_sales' },
        ],
      },
    ],
  },
];

export function filterSectionsByProfile(user: any): SidebarSection[] {
  const profile = user?.businessProfile ?? 'retail';
  if (profile === 'retail') {
    return sidebarSections.filter((section) => section.sectionTitle !== 'FOOD SERVICE');
  }
  return sidebarSections;
}

export function isPathActive(pathname: string, href: Href): boolean {
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

function SidebarMenu({ close }: { close(): void }) {
  const pathname = usePathname();
  const { currentUser, refreshUser, signOut } = useSession();
  const branch = useBranchStore((state) => state.activeBranch);
  const branchLabel = branch?.name ?? currentUser?.branches?.[0]?.name ?? 'No branch selected';
  const [refreshing, setRefreshing] = useState(false);

  const getActiveGroupId = (currentPath: string) => {
    for (const section of sidebarSections) {
      for (const group of section.groups) {
        if (group.children) {
          const hasActiveChild = group.children.some((child) => isPathActive(currentPath, child.href));
          if (hasActiveChild) return group.id;
        }
      }
    }
    return null;
  };

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => {
    const active = getActiveGroupId(pathname);
    return active ? { [active]: true } : { products: true };
  });

  // Auto-expand active group and collapse non-active groups when route changes
  useEffect(() => {
    const active = getActiveGroupId(pathname);
    if (active) {
      setExpandedGroups({ [active]: true });
    }
  }, [pathname]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  const filterVisibleChildren = (children?: SidebarSubItem[]) => {
    if (!children) return [];
    return children.filter((item) => {
      const coreHrefs = [
        '/products',
        '/customers',
        '/purchasing',
        '/reports',
        '/settings',
        '/promotions',
        '/(tabs)/inventory',
        '/production',
        '/catalogue',
        '/product-variants',
      ];
      const isOwnerOrAdmin = currentUser?.role === 'owner' || currentUser?.role === 'administrator';
      const hasPermission = !item.permission || isOwnerOrAdmin || currentUser?.permissions.includes(item.permission);
      const hasModule = !item.module || currentUser?.modules.includes(item.module);
      return hasPermission && hasModule;
    });
  };

  const filterVisibleGroups = (groups: SidebarGroup[]) => {
    return groups.filter((group) => {
      const coreGroups = [
        'dashboard',
        'products',
        'customers',
        'pos',
        'sales',
        'purchasing',
        'promotions',
        'registers',
        'reports',
        'settings',
      ];
      if (coreGroups.includes(group.id)) return true;

      const isOwnerOrAdmin = currentUser?.role === 'owner' || currentUser?.role === 'administrator';
      const hasPermission =
        !group.permission || isOwnerOrAdmin || currentUser?.permissions.includes(group.permission);
      const hasModule =
        !group.module ||
        currentUser?.modules.includes(group.module) ||
        (group.id === 'dashboard' &&
          (currentUser?.modules.includes('dashboard') || currentUser?.modules.includes('reports')));
      return hasPermission && hasModule;
    });
  };

  const getBadgeStyle = (color?: SidebarSubItem['badgeColor']) => {
    switch (color) {
      case 'amber':
        return 'bg-amber-100 text-amber-800';
      case 'red':
        return 'bg-red-100 text-red-700';
      case 'emerald':
        return 'bg-emerald-100 text-emerald-800';
      case 'blue':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-slate-200 text-slate-700';
    }
  };

  return (
    <View className="h-full w-64 border-r border-slate-200/80 bg-[#F8F9FA] px-3 pb-4 pt-4 shadow-sm">
      {/* Brand Header */}
      <View className="mb-4 flex-row items-center px-2">
        <View className="mr-3 h-10 w-10 overflow-hidden rounded-xl bg-brand-700 shadow-sm">
          <Image
            source={ximoIcon}
            resizeMode="cover"
            style={{ width: 40, height: 40 }}
            accessibilityLabel="Ximo logo"
          />
        </View>
        <View className="flex-1">
          <Text className="text-base font-black tracking-tight text-slate-900">Ximo POS</Text>
          <Text numberOfLines={1} className="text-xs font-medium text-slate-500">
            {branchLabel}
          </Text>
        </View>
      </View>

      {/* Navigation Sections & Hierarchy */}
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="pb-6">
          {filterSectionsByProfile(currentUser).map((section, sectionIdx) => {
            const visibleGroups = filterVisibleGroups(section.groups);
            if (visibleGroups.length === 0) return null;

            return (
              <View key={section.sectionTitle ?? sectionIdx} className="mb-3">
                {section.sectionTitle ? (
                  <Text className="mb-1.5 px-3 text-[10px] font-extrabold tracking-wider text-slate-400 uppercase">
                    {section.sectionTitle}
                  </Text>
                ) : null}

                <View className="gap-1">
                  {visibleGroups.map((group) => {
                    const hasChildren = group.children && group.children.length > 0;
                    const visibleChildren = filterVisibleChildren(group.children);
                    const isExpanded = expandedGroups[group.id] ?? false;
                    const isDirectActive = group.href ? isPathActive(pathname, group.href) : false;
                    const isAnyChildActive = visibleChildren.some((child) =>
                      isPathActive(pathname, child.href),
                    );

                    if (!hasChildren && group.href) {
                      const isGroupDisabled =
                        group.id === 'dashboard'
                          ? !(
                              currentUser?.modules.includes('dashboard') ||
                              currentUser?.modules.includes('reports')
                            )
                          : Boolean(group.module && !currentUser?.modules.includes(group.module));

                      return (
                        <Pressable
                          key={group.id}
                          accessibilityRole="button"
                          accessibilityLabel={`Open ${group.title}`}
                          onPress={() => {
                            close();
                            router.push(group.href!);
                          }}
                          className={`min-h-11 flex-row items-center justify-between rounded-xl px-3 py-2.5 transition-all ${
                            isDirectActive
                              ? 'bg-white border border-slate-200/90 shadow-sm'
                              : 'active:bg-slate-200/60'
                          }`}
                        >
                          <View className="flex-row items-center flex-1 pr-2">
                            <Feather
                              name={group.icon}
                              size={19}
                              color={isDirectActive ? '#1A593B' : '#64748B'}
                            />
                            <Text
                              className={`ml-3 text-sm ${
                                isDirectActive
                                  ? 'font-bold text-slate-900'
                                  : 'font-semibold text-slate-700'
                              }`}
                            >
                              {group.title}
                            </Text>
                          </View>

                          {isGroupDisabled ? (
                            <View className="flex-row items-center gap-1 rounded-full bg-amber-100/80 px-2 py-0.5">
                              <Feather name="lock" size={10} color="#B45309" />
                              <Text className="text-[10px] font-bold text-amber-800">Locked</Text>
                            </View>
                          ) : null}
                        </Pressable>
                      );
                    }

                    return (
                      <View key={group.id} className="mb-0.5">
                        {/* Group Header Button */}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Toggle ${group.title} group`}
                          onPress={() => toggleGroup(group.id)}
                          className={`min-h-11 flex-row items-center justify-between rounded-xl px-3 py-2.5 ${
                            isAnyChildActive && !isExpanded
                              ? 'bg-slate-200/40'
                              : 'active:bg-slate-200/50'
                          }`}
                        >
                          <View className="flex-row items-center">
                            <Feather
                              name={group.icon}
                              size={19}
                              color={isAnyChildActive ? '#1A593B' : '#64748B'}
                            />
                            <Text
                              className={`ml-3 text-sm ${
                                isAnyChildActive
                                  ? 'font-bold text-slate-900'
                                  : 'font-semibold text-slate-800'
                              }`}
                            >
                              {group.title}
                            </Text>
                          </View>
                          <Feather
                            name={isExpanded ? 'chevron-up' : 'chevron-down'}
                            size={16}
                            color="#94A3B8"
                          />
                        </Pressable>

                        {/* Expanded Hierarchy Sub-Items with Tree Connectors */}
                        {isExpanded && visibleChildren.length > 0 ? (
                          <View className="ml-5 mt-1 border-l-2 border-slate-200/80 pl-3.5 gap-1.5 py-1">
                            {visibleChildren.map((subItem) => {
                              const active = isPathActive(pathname, subItem.href);
                              const isSubDisabled = Boolean(
                                subItem.module && !currentUser?.modules.includes(subItem.module),
                              );

                              return (
                                <View
                                  key={subItem.title}
                                  className="relative flex-row items-center"
                                >
                                  {/* Horizontal Curved Connector Line */}
                                  <View className="absolute -left-[15px] top-1/2 h-[2px] w-3.5 rounded-full bg-slate-200/90" />
                                  <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`Go to ${subItem.title}`}
                                    onPress={() => {
                                      close();
                                      router.push(subItem.href);
                                    }}
                                    className={`min-h-10 flex-1 flex-row items-center justify-between rounded-xl px-3.5 py-2 ${
                                      active
                                        ? 'bg-white border border-slate-200/90 shadow-sm'
                                        : 'active:bg-slate-200/40'
                                    }`}
                                  >
                                    <Text
                                      className={`text-sm ${
                                        active
                                          ? 'font-bold text-slate-950'
                                          : 'font-medium text-slate-600'
                                      }`}
                                    >
                                      {subItem.title}
                                    </Text>
                                    {isSubDisabled ? (
                                      <View className="flex-row items-center gap-1 rounded-full bg-amber-100/80 px-2 py-0.5">
                                        <Feather name="lock" size={10} color="#B45309" />
                                        <Text className="text-[10px] font-bold text-amber-800">
                                          Locked
                                        </Text>
                                      </View>
                                    ) : subItem.badge !== undefined ? (
                                      <View
                                        className={`rounded-full px-2 py-0.5 ${getBadgeStyle(
                                          subItem.badgeColor,
                                        )}`}
                                      >
                                        <Text className="text-xs font-bold">{subItem.badge}</Text>
                                      </View>
                                    ) : null}
                                  </Pressable>
                                </View>
                              );
                            })}
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* User & Branch Footer */}
      <View className="mt-auto border-t border-slate-200/80 pt-3 gap-2">
        <View className="flex-row items-center justify-between rounded-2xl border border-slate-200/60 bg-white p-3 shadow-sm">
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              close();
              if (currentUser?.id) router.push(`/user/${currentUser.id}`);
            }}
            className="flex-1 flex-row items-center pr-2"
          >
            <View className="mr-3 h-9 w-9 items-center justify-center rounded-xl bg-brand-700">
              <Text className="text-xs font-bold text-white">
                {currentUser?.displayName
                  ?.split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join('')
                  .toUpperCase() || 'U'}
              </Text>
            </View>
            <View className="flex-1">
              <Text numberOfLines={1} className="text-sm font-bold text-slate-900">
                {currentUser?.displayName || 'Cashier'}
              </Text>
              <Text numberOfLines={1} className="text-xs font-medium text-slate-500">
                {branchLabel}
              </Text>
            </View>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh modules and permissions"
            disabled={refreshing}
            onPress={() => {
              setRefreshing(true);
              void refreshUser()
                .catch(() => undefined)
                .finally(() => setRefreshing(false));
            }}
            className={`h-8 w-8 items-center justify-center rounded-xl bg-slate-100 ${
              refreshing ? 'opacity-50' : 'active:bg-slate-200'
            }`}
          >
            <Feather name="refresh-cw" size={14} color={refreshing ? '#94A3B8' : '#475569'} />
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign out of account"
          onPress={async () => {
            close();
            await signOut();
            router.replace('/(auth)/login');
          }}
          className="flex-row items-center justify-center rounded-xl border border-red-200/80 bg-red-50/80 py-2.5 px-3 active:bg-red-100"
        >
          <Feather name="log-out" size={15} color="#DC2626" />
          <Text className="ml-2 text-sm font-bold text-red-700">Sign Out</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function AppSidebarProvider({ children }: PropsWithChildren) {
  const { width } = useWindowDimensions();
  const compact = width < 1100;
  const [open, setOpen] = useState(false);
  const value = useMemo(
    () => ({
      compact,
      open,
      openMenu: () => setOpen(true),
      closeMenu: () => setOpen(false),
    }),
    [compact, open],
  );

  return (
    <SidebarContext.Provider value={value}>
      <View className="flex-1 flex-row">
        {!compact ? <SidebarMenu close={() => setOpen(false)} /> : null}
        <View className="flex-1">{children}</View>
        {compact && open ? (
          <View className="absolute inset-0 z-50 flex-row">
            <SidebarMenu close={() => setOpen(false)} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close navigation menu"
              onPress={() => setOpen(false)}
              className="flex-1 bg-black/40"
            />
          </View>
        ) : null}
      </View>
    </SidebarContext.Provider>
  );
}

export function useAppSidebar(): SidebarContextValue | null {
  return useContext(SidebarContext);
}
