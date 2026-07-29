import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ComponentProps,
  type PropsWithChildren,
} from 'react';
import { Image, Pressable, Text, View, useWindowDimensions } from 'react-native';
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

const menuItems: Array<{
  title: string;
  icon: ComponentProps<typeof Feather>['name'];
  href: Href;
  module?: ModuleCode;
  permission?: Permission;
}> = [
  {
    title: 'Sales',
    icon: 'dollar-sign',
    href: '/(tabs)/sales',
    module: 'pos',
  },
  {
    title: 'Inventory',
    icon: 'box',
    href: '/(tabs)/inventory',
    module: 'inventory',
  },
  { title: 'Products', icon: 'shopping-bag', href: '/products', module: 'products' },
  {
    title: 'Customers',
    icon: 'users',
    href: '/customers',
    module: 'customers',
  },
  {
    title: 'Registers',
    icon: 'monitor',
    href: '/registers',
    module: 'registers',
  },
  {
    title: 'Purchasing',
    icon: 'truck',
    href: '/purchasing',
    module: 'purchasing',
    permission: 'purchasing:read',
  },
  { title: 'Reports', icon: 'bar-chart-2', href: '/reports', module: 'reports' },
  { title: 'More', icon: 'more-horizontal', href: '/(tabs)/more' },
];

function SidebarMenu({ close }: { close(): void }) {
  const pathname = usePathname();
  const { currentUser } = useSession();
  const branch = useBranchStore((state) => state.activeBranch);
  const visible = menuItems.filter(
    (item) =>
      (!item.module || currentUser?.modules.includes(item.module)) &&
      (!item.permission || currentUser?.permissions.includes(item.permission)),
  );

  return (
    <View className="h-full w-[72px] items-center border-r border-brand-100 bg-white px-2 pb-4 pt-3">
      <View className="mb-5 h-10 w-10 overflow-hidden rounded-xl bg-brand-700">
        <Image
          source={ximoIcon}
          resizeMode="cover"
          className="h-10 w-10"
          accessibilityLabel="Ximo logo"
        />
      </View>
      <View className="w-full gap-1">
        {visible.map((item) => {
          const target = String(item.href).replace('/(tabs)', '');
          const active =
            pathname === target ||
            (target !== '/more' && pathname.startsWith(`${target.replace(/\/$/, '')}/`));
          return (
            <Pressable
              key={item.title}
              accessibilityRole="button"
              accessibilityLabel={`Open ${item.title}`}
              onPress={() => {
                close();
                router.push(item.href);
              }}
              className={`min-h-14 items-center justify-center rounded-xl px-1 ${
                active ? 'bg-brand-50' : 'active:bg-brand-50'
              }`}
            >
              <Feather name={item.icon} size={21} color={active ? '#1A593B' : '#81776E'} />
              <Text
                numberOfLines={1}
                className={`mt-1 text-[9px] font-medium ${
                  active ? 'text-brand-700' : 'text-slate-500'
                }`}
              >
                {item.title}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View className="mt-auto h-10 w-10 items-center justify-center rounded-full bg-brand-700">
        <Text className="text-xs font-semibold text-white">
          {currentUser?.displayName
            ?.split(/\s+/)
            .slice(0, 2)
            .map((part) => part[0])
            .join('')
            .toUpperCase() || 'U'}
        </Text>
      </View>
      <Text numberOfLines={1} className="mt-1 w-full text-center text-[9px] text-slate-500">
        {branch?.name}
      </Text>
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
              className="flex-1 bg-black/30"
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
