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
      {
        id: 'dashboard',
        title: 'Dashboard',
        icon: 'grid',
        href: '/(tabs)',
        module: 'dashboard',
        permission: 'reports:read',
      },
      {
        id: 'pos',
        title: 'POS',
        icon: 'shopping-cart',
        href: '/(tabs)/pos',
        module: 'pos',
        permission: 'sales:create',
      },
      {
        id: 'sales',
        title: 'Sales & Orders',
        icon: 'shopping-bag',
        href: '/(tabs)/sales',
        module: 'pos',
        permission: 'sales:read_branch',
      },
    ],
  },
  {
    sectionTitle: 'CATALOG',
    groups: [
      {
        id: 'products',
        title: 'Catalog',
        icon: 'box',
        permission: 'products:read',
        children: [
          { title: 'Overview', href: '/products', module: 'products', permission: 'products:read' },
          {
            title: 'Categories',
            href: '/catalogue',
            module: 'products',
            permission: 'products:manage',
          },
          {
            title: 'Variants',
            href: '/product-variants',
            module: 'products',
            permission: 'products:manage',
          },
        ],
      },
      {
        id: 'customers',
        title: 'Customers',
        icon: 'users',
        href: '/customers',
        module: 'customers',
        permission: 'customers:read',
      },
      {
        id: 'promotions',
        title: 'Promotions & Combos',
        icon: 'tag',
        href: '/promotions',
        module: 'promotions',
        permission: 'promotions:read',
      },
    ],
  },
  {
    sectionTitle: 'INVENTORY',
    groups: [
      {
        id: 'inventory_tools',
        title: 'Inventory',
        icon: 'archive',
        permission: 'inventory:read',
        children: [
          {
            title: 'Stock Overview',
            href: '/(tabs)/inventory',
            module: 'inventory',
            permission: 'inventory:read',
          },
          {
            title: 'Purchasing & Restock',
            href: '/purchasing',
            module: 'purchasing',
            permission: 'purchasing:read',
          },
          {
            title: 'Stock Adjustments',
            href: '/stock-adjustment',
            module: 'inventory',
            permission: 'inventory:adjust',
          },
          {
            title: 'Branch Transfers',
            href: '/stock-transfers',
            module: 'stock_transfers',
            permission: 'transfers:read',
          },
          {
            title: 'Repacking',
            href: '/retail/repacking',
            module: 'production',
            permission: 'products:manage',
          },
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
        permission: 'registers:read',
        children: [
          {
            title: 'Active Register',
            href: '/registers',
            module: 'registers',
            permission: 'registers:read',
          },
          {
            title: 'Shift History',
            href: '/shift-reports',
            module: 'registers',
            permission: 'registers:read',
          },
        ],
      },
      {
        id: 'reports',
        title: 'Income & Reports',
        icon: 'trending-up',
        href: '/reports' as Href,
        module: 'reports',
        permission: 'reports:read',
      },
      {
        id: 'analytics',
        title: 'Analytics',
        icon: 'bar-chart-2',
        href: '/analytics' as Href,
        module: 'reports',
        permission: 'reports:read',
      },
      {
        id: 'settings',
        title: 'Administration',
        icon: 'settings',
        children: [
          { title: 'Organization', href: '/organization', permission: 'organization:read' },
          { title: 'Branches', href: '/branches' as Href, permission: 'branches:read' },
          { title: 'Store Settings', href: '/settings', permission: 'settings:manage' },
          { title: 'Staff & Roles', href: '/users', permission: 'users:manage' },
          { title: 'Audit Logs', href: '/audit', module: 'audit', permission: 'audit:read' },
          {
            title: 'Hardware Devices',
            href: '/hardware',
            module: 'receipt_printer',
            permission: 'settings:manage',
          },
          {
            title: 'Offline Data Sync',
            href: '/offline-sync',
            module: 'offline',
            permission: 'sales:create',
          },
        ],
      },
    ],
  },
  {
    sectionTitle: 'FOOD SERVICE',
    groups: [
      {
        id: 'food_service',
        title: 'Food service',
        icon: 'coffee',
        children: [
          {
            title: 'Raw Ingredients',
            href: '/products?inventoryRole=ingredient',
            module: 'ingredients',
            permission: 'products:read',
          },
          {
            title: 'BOM Recipes',
            href: '/products?preparationBehavior=cook_to_order',
            module: 'recipes',
            permission: 'products:read',
          },
          {
            title: 'Batch Production',
            href: '/production',
            module: 'production',
            permission: 'products:manage',
          },
          {
            title: 'Parked / Held Sales',
            href: '/held-sales' as Href,
            module: 'held_sales',
            permission: 'sales:create',
          },
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
  if (
    target === '/purchasing' &&
    (current.startsWith('/purchase/') || current.startsWith('/supplier/'))
  ) {
    return true;
  }

  return false;
}

export function useVisibleNavigation(): SidebarSection[] {
  const { currentUser } = useSession();
  const hasModuleAccess = (module?: ModuleCode, groupId?: string) => {
    if (!module) return true;
    if (groupId === 'dashboard') {
      return (
        Boolean(currentUser?.modules.includes('dashboard')) ||
        Boolean(currentUser?.modules.includes('reports'))
      );
    }
    return Boolean(currentUser?.modules.includes(module));
  };

  const hasPermissionAccess = (permission?: Permission) => {
    if (!permission) return true;
    const isOwnerOrAdmin = currentUser?.role === 'owner' || currentUser?.role === 'administrator';
    return isOwnerOrAdmin || Boolean(currentUser?.permissions.includes(permission));
  };

  const filterVisibleChildren = (children?: SidebarSubItem[]) => {
    if (!children) return [];
    return children.filter(
      (item) => hasPermissionAccess(item.permission) && hasModuleAccess(item.module),
    );
  };

  const filterVisibleGroups = (groups: SidebarGroup[]) => {
    return groups.filter((group) => {
      if (!hasPermissionAccess(group.permission)) return false;

      if (group.children && group.children.length > 0) {
        // Parent groups without their own module stay visible only when at least
        // one enabled child remains.
        if (group.module && !hasModuleAccess(group.module, group.id)) return false;
        return filterVisibleChildren(group.children).length > 0;
      }

      return hasModuleAccess(group.module, group.id);
    });
  };

  return filterSectionsByProfile(currentUser)
    .map((section) => ({
      ...section,
      groups: filterVisibleGroups(section.groups).map((group) => ({
        ...group,
        children: group.children ? filterVisibleChildren(group.children) : undefined,
      })),
    }))
    .filter((section) => section.groups.length > 0);
}

/** Arrange already-authorized destinations without changing their access checks. */
function compactNavigation(sections: SidebarSection[]): SidebarSection[] {
  return sections.map((section) => {
    if (section.sectionTitle === 'CATALOG') {
      const children = section.groups.flatMap(
        (group) => group.children ?? (group.href ? [{ title: group.title, href: group.href }] : []),
      );
      return {
        ...section,
        sectionTitle: undefined,
        groups: [{ id: 'products', title: 'Catalog', icon: 'box', children }],
      };
    }
    if (section.sectionTitle === 'STORE MANAGEMENT') {
      const reports = section.groups.filter(
        (group) => group.id === 'reports' || group.id === 'analytics',
      );
      const groups = section.groups.filter(
        (group) => group.id !== 'reports' && group.id !== 'analytics',
      );
      if (reports.length)
        groups.splice(1, 0, {
          id: 'reports',
          title: 'Reports',
          icon: 'bar-chart-2',
          children: reports.map((group) => ({
            title: group.id === 'reports' ? 'Reports overview' : group.title,
            href: group.href!,
          })),
        });
      return { ...section, sectionTitle: undefined, groups };
    }
    return { ...section, sectionTitle: undefined };
  });
}

function SidebarMenu({ close }: { close(): void }) {
  const pathname = usePathname();
  const { currentUser, refreshUser, signOut } = useSession();
  const branch = useBranchStore((state) => state.activeBranch);
  const branchLabel = branch?.name ?? currentUser?.branches?.[0]?.name ?? 'No branch selected';
  const [refreshing, setRefreshing] = useState(false);

  const visibleSections = compactNavigation(useVisibleNavigation());

  const getActiveGroupId = (currentPath: string) => {
    for (const section of visibleSections) {
      for (const group of section.groups) {
        if (group.children) {
          const hasActiveChild = group.children.some((child) =>
            isPathActive(currentPath, child.href),
          );
          if (hasActiveChild) return group.id;
        }
      }
    }
    return null;
  };

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => {
    const active = getActiveGroupId(pathname);
    return active ? { [active]: true } : {};
  });

  // Auto-expand active group and collapse non-active groups when route changes
  useEffect(() => {
    const active = getActiveGroupId(pathname);
    setExpandedGroups(active ? { [active]: true } : {});
  }, [pathname]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => ({
      [groupId]: !prev[groupId],
    }));
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
    <View className="h-full w-64 border-r border-slate-200/80 bg-[#F8F9FA] px-3 pb-4 pt-4">
      {/* Brand Header */}
      <View className="mb-4 flex-row items-center px-2">
        <View className="mr-3 h-10 w-10 overflow-hidden rounded-xl bg-brand-700">
          <Image
            source={ximoIcon}
            resizeMode="cover"
            style={{ width: 40, height: 40 }}
            accessibilityLabel="Ximo Logo"
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
          {visibleSections.map((section, sectionIdx) => {
            const visibleGroups = section.groups;
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
                    const visibleChildren = group.children ?? [];
                    const isExpanded = expandedGroups[group.id] ?? false;
                    const isDirectActive = group.href ? isPathActive(pathname, group.href) : false;
                    const isAnyChildActive = visibleChildren.some((child) =>
                      isPathActive(pathname, child.href),
                    );

                    if (!hasChildren && group.href) {
                      return (
                        <Pressable
                          key={group.id}
                          accessibilityRole="button"
                          accessibilityLabel={`Open ${group.title}`}
                          onPress={() => {
                            close();
                            router.push(group.href!);
                          }}
                          className={`min-h-11 flex-row items-center justify-between rounded-xl px-3 py-2.5 border ${
                            isDirectActive
                              ? 'bg-[#EAF2EE] border-[#DCE8E1]'
                              : 'border-transparent active:bg-[#F0F4F2]'
                          }`}
                        >
                          <View className="flex-row items-center flex-1 pr-2">
                            <Feather
                              name={group.icon}
                              size={16}
                              color={isDirectActive ? '#1A593B' : '#7B8982'}
                            />
                            <Text
                              className={`ml-3 text-sm ${
                                isDirectActive
                                  ? 'font-semibold text-[#1A593B]'
                                  : 'font-medium text-[#66766E]'
                              }`}
                            >
                              {group.title}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    }

                    if (hasChildren && visibleChildren.length === 0) return null;

                    return (
                      <View key={group.id} className="mb-0.5">
                        {/* Group Header Button */}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Toggle ${group.title} group`}
                          accessibilityState={{ expanded: isExpanded }}
                          onPress={() => toggleGroup(group.id)}
                          className={`min-h-11 flex-row items-center justify-between rounded-xl px-3 py-2.5 ${
                            isAnyChildActive && !isExpanded
                              ? 'bg-[#EAF2EE]'
                              : 'border-transparent active:bg-[#F0F4F2]'
                          }`}
                        >
                          <View className="flex-row items-center">
                            <Feather
                              name={group.icon}
                              size={16}
                              color={isAnyChildActive ? '#1A593B' : '#7B8982'}
                            />
                            <Text
                              className={`ml-3 text-sm ${
                                isAnyChildActive
                                  ? 'font-semibold text-[#1A593B]'
                                  : 'font-medium text-[#66766E]'
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
                                    accessibilityState={{ selected: active }}
                                    onPress={() => {
                                      close();
                                      router.push(subItem.href);
                                    }}
                                    className={`min-h-10 flex-1 flex-row items-center justify-between rounded-xl border px-3.5 py-2 ${
                                      active
                                        ? 'bg-[#EAF2EE] border-[#DCE8E1]'
                                        : 'border-transparent active:bg-[#F0F4F2]'
                                    }`}
                                  >
                                    <Text
                                      className={`text-sm ${
                                        active
                                          ? 'font-semibold text-[#1A593B]'
                                          : 'font-medium text-slate-600'
                                      }`}
                                    >
                                      {subItem.title}
                                    </Text>
                                    {subItem.badge !== undefined ? (
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
        <View className="flex-row items-center justify-between rounded-2xl border border-slate-200/60 bg-white p-3">
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
            accessibilityLabel="Refresh Modules And Permissions"
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
          accessibilityLabel="Sign Out Of Account"
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
  const parentSidebar = useContext(SidebarContext);
  const { width } = useWindowDimensions();
  const { session, currentUser } = useSession();
  const pathname = usePathname();
  const hasWorkspace = Boolean(session && currentUser);
  const navigationVisible =
    hasWorkspace &&
    !['/branch-select', '/login', '/accept-invitation', '/change-password'].includes(pathname);
  const compact = navigationVisible && width < 1100;
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

  // Individual screens used to provide their own sidebar. The app shell now owns it,
  // so nested wrappers must not add a second rail or a second layout container.
  if (parentSidebar) return <>{children}</>;

  return (
    <SidebarContext.Provider value={value}>
      <View className="flex-1 flex-row">
        {!compact && navigationVisible ? <SidebarMenu close={() => setOpen(false)} /> : null}
        <View className="flex-1">{children}</View>
        {compact && navigationVisible && open ? (
          <View className="absolute inset-0 z-50 flex-row">
            <SidebarMenu close={() => setOpen(false)} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close Navigation Menu"
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
