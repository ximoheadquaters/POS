import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { router, type Href, usePathname } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { useEffect, type ComponentProps } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isPathActive, useVisibleNavigation } from './app-sidebar';

const destinations: Array<{
  href: Href;
  label: string;
  shortLabel: string;
  icon: ComponentProps<typeof Feather>['name'];
}> = [
  { href: '/(tabs)/pos', label: 'New sale', shortLabel: 'Sale', icon: 'shopping-cart' },
  { href: '/(tabs)/sales', label: 'Sales & orders', shortLabel: 'Orders', icon: 'shopping-bag' },
  { href: '/products', label: 'Products', shortLabel: 'Items', icon: 'box' },
  { href: '/(tabs)/inventory', label: 'Stock', shortLabel: 'Stock', icon: 'archive' },
  { href: '/registers', label: 'Register / shift', shortLabel: 'Shift', icon: 'credit-card' },
  { href: '/customers', label: 'Customers', shortLabel: 'People', icon: 'users' },
  { href: '/purchasing', label: 'Purchasing', shortLabel: 'Purchasing', icon: 'truck' },
  { href: '/reports', label: 'Reports', shortLabel: 'Reports', icon: 'bar-chart-2' },
  { href: '/stock-adjustment', label: 'Stock adjustment', shortLabel: 'Adjust', icon: 'sliders' },
  { href: '/stock-transfers', label: 'Stock transfers', shortLabel: 'Transfer', icon: 'shuffle' },
  { href: '/retail/repacking', label: 'Repacking', shortLabel: 'Repack', icon: 'repeat' },
  { href: '/catalogue', label: 'Categories', shortLabel: 'Categories', icon: 'folder' },
  { href: '/product-variants', label: 'Variants', shortLabel: 'Variants', icon: 'layers' },
];

// Keep the persistent bar focused on the five day-to-day actions. Customers
// remains available in the sidebar and More area, without taking a quick key.
const quickKeyDestinations = destinations.filter((item) => item.href !== '/customers').slice(0, 5);

export function QuickAccess({
  routes,
  title = 'Quick actions',
  minimum = 2,
}: {
  routes?: string[];
  title?: string;
  minimum?: number;
}) {
  const sections = useVisibleNavigation();
  const { width } = useWindowDimensions();
  const allowed = new Set(
    sections.flatMap((section) =>
      section.groups.flatMap((group) =>
        group.children ? group.children.map((child) => String(child.href)) : [String(group.href)],
      ),
    ),
  );
  const ordered = routes
    ? routes.flatMap((href) => destinations.filter((item) => item.href === href))
    : destinations;
  const items = ordered.filter((item) => allowed.has(String(item.href))).slice(0, 6);
  if (items.length < minimum) return null;
  return (
    <View className="mb-4 gap-2">
      {title ? <Text className="text-sm font-semibold text-slate-700">{title}</Text> : null}
      <View className="flex-row flex-wrap gap-2">
        {items.map((item) => (
          <Pressable
            key={String(item.href)}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            onPress={() => router.push(item.href)}
            style={{ flexBasis: width < 600 ? '48%' : 164, flexGrow: 0 }}
            className="min-h-11 flex-row items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 hover:border-slate-300 hover:bg-slate-50 active:bg-brand-50"
          >
            <View className="h-7 w-7 items-center justify-center rounded-lg bg-slate-100">
              <Feather name={item.icon} size={15} color="#637169" />
            </View>
            <Text className="flex-1 text-sm font-medium text-slate-800">{item.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** Persistent, permission-aware actions for the compact navigation bar. */
export function QuickActionBar() {
  const sections = useVisibleNavigation();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const allowed = new Set(
    sections.flatMap((section) =>
      section.groups.flatMap((group) =>
        group.children ? group.children.map((child) => String(child.href)) : [String(group.href)],
      ),
    ),
  );
  const items = quickKeyDestinations.filter((item) => allowed.has(String(item.href)));
  const phone = width < 640;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.defaultPrevented) return;
      const shortcutIndex = Number(event.key) - 1;
      const destination = items[shortcutIndex];
      if (
        !Number.isInteger(shortcutIndex) ||
        shortcutIndex < 0 ||
        shortcutIndex >= items.length ||
        !destination
      ) {
        return;
      }
      // Ctrl+number normally changes browser tabs; the POS actions take priority while in the app.
      event.preventDefault();
      if (String(destination.href) === '/(tabs)/pos') {
        const focused = document.activeElement;
        if (focused instanceof HTMLElement) focused.blur();
      }
      router.push(destination.href);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [items, pathname]);

  if (!items.length) return null;
  return (
    <View
      className="border-t border-slate-200 bg-white px-3 pt-2"
      style={{ paddingBottom: Math.max(8, insets.bottom) }}
    >
      <View className="flex-row w-full gap-1">
        {items.map((item, index) => {
          const active = isPathActive(pathname, item.href);
          const shortcut = `Ctrl ${index + 1}`;
          return (
            <Pressable
              key={String(item.href)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={item.label}
              accessibilityHint={shortcut ? `Keyboard shortcut: ${shortcut}` : undefined}
              onPress={() => router.push(item.href)}
              className={`min-h-12 items-center justify-center gap-1 rounded-xl border px-2 py-1.5 ${
                active
                  ? 'border-brand-200 bg-brand-50'
                  : 'border-transparent bg-white active:border-slate-200 active:bg-slate-50'
              }`}
              style={{
                flexBasis: 0,
                flexGrow: 1,
                flexShrink: 1,
                minWidth: 0,
              }}
            >
              <Feather name={item.icon} size={17} color={active ? '#1A593B' : '#637169'} />
              <Text
                numberOfLines={1}
                className={`${phone ? 'text-[10px]' : 'text-[11px]'} font-semibold ${active ? 'text-brand-800' : 'text-slate-600'}`}
              >
                {phone ? item.shortLabel : item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
