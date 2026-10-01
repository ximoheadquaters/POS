import { renderHook, render, fireEvent } from '@testing-library/react-native';
import { TextInput } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useVisibleNavigation, AppSidebarProvider } from './app-sidebar';
import { ExpandableSection, Header } from './ui';
import { QuickAccess, QuickActionBar } from './quick-access';
import { navigateOnce } from '@/lib/navigation';
import { router } from 'expo-router';

let mockUser: any;
jest.mock(
  '@/providers/session',
  () => ({ useSession: () => ({ session: { access_token: 'test' }, currentUser: mockUser }) }),
  {
  virtual: true,
  },
);
jest.mock(
  '@/store/branch',
  () => ({
    useBranchStore: (selector: any) => selector({ activeBranch: { name: 'Test branch' } }),
  }),
  { virtual: true },
);
jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn() }, usePathname: () => '/products' }));
jest.mock('@expo/vector-icons/Feather', () => 'Feather');

const destinations = (sections: ReturnType<typeof useVisibleNavigation>) =>
  sections.flatMap((section) =>
    section.groups.flatMap((group) => group.children?.map((child) => child.href) ?? [group.href]),
  );

beforeEach(() => {
  mockUser = {
    role: 'cashier',
    businessProfile: 'retail',
    modules: ['pos'],
    permissions: ['sales:create'],
    branches: [],
  };
});

it('keeps module checks for owners and preserves parent permission checks', async () => {
  mockUser = { ...mockUser, role: 'owner', modules: [] };
  const hook = await renderHook(() => useVisibleNavigation());
  expect(destinations(hook.result.current)).not.toContain('/(tabs)/pos');
  mockUser = {
    ...mockUser,
    role: 'cashier',
    modules: ['purchasing'],
    permissions: ['purchasing:read'],
  };
  await hook.rerender({});
  expect(destinations(hook.result.current)).not.toContain('/purchasing');
});

it('hides quick access with only one allowed route', async () => {
  const screen = await render(<QuickAccess />);
  expect(screen.queryByText('Quick access')).toBeNull();
});

it('shows only permitted quick links and caps them at six', async () => {
  mockUser = {
    ...mockUser,
    role: 'owner',
    modules: ['pos', 'products', 'inventory', 'registers', 'customers', 'purchasing', 'reports'],
  };
  const screen = await render(<QuickAccess />);
  expect(screen.getAllByRole('button')).toHaveLength(6);
  expect(screen.getByText('New sale')).toBeTruthy();
  expect(screen.queryByText('Purchasing')).toBeNull();
});

it('ignores repeat navigation taps during a screen transition', () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(10_000);
  const navigate = router.navigate as jest.Mock;
  navigate.mockClear();
  navigateOnce('/payment');
  navigateOnce('/payment');
  expect(navigate).toHaveBeenCalledTimes(1);
  now.mockReturnValue(11_000);
  navigateOnce('/payment');
  expect(navigate).toHaveBeenCalledTimes(2);
  now.mockRestore();
});

it('mounts the quick-action bar on Android without browser keyboard events', async () => {
  mockUser = { ...mockUser, role: 'owner', modules: ['pos', 'products'] };
  const addEventListener = window.addEventListener;
  Object.defineProperty(window, 'addEventListener', { configurable: true, value: undefined });
  try {
    const screen = await render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 400, height: 800 }, insets: { top: 0, right: 0, bottom: 0, left: 0 } }}>
        <QuickActionBar />
      </SafeAreaProvider>,
    );
    expect(screen.getByText('New sale')).toBeTruthy();
  } finally {
    Object.defineProperty(window, 'addEventListener', {
      configurable: true,
      value: addEventListener,
    });
  }
});

it('keeps input state mounted when a section collapses', async () => {
  const screen = await render(
    <ExpandableSection title="Options" defaultExpanded>
      <TextInput testID="draft" defaultValue="Unsaved draft" />
    </ExpandableSection>,
  );
  await fireEvent.press(screen.getByRole('button', { name: /Options/ }));
  expect(screen.getByTestId('draft', { includeHiddenElements: true }).props.defaultValue).toBe(
    'Unsaved draft',
  );
  expect(screen.queryByTestId('draft')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: /Options/ }));
  expect(screen.getByTestId('draft')).toBeTruthy();
});

it('expands the active catalog and closes it when inventory opens', async () => {
  mockUser = { ...mockUser, role: 'owner', modules: ['products', 'inventory'] };
  const screen = await render(
    <AppSidebarProvider>
      <Header title="Products" />
    </AppSidebarProvider>,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Open Navigation Menu' }));
  expect(screen.getByRole('button', { name: 'Go to Categories' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Toggle Inventory group' }));
  expect(screen.queryByRole('button', { name: 'Go to Categories' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Go to Stock Overview' })).toBeTruthy();
});

it('opens the reports overview from the compact sidebar', async () => {
  mockUser = { ...mockUser, role: 'owner', modules: ['reports'] };
  const navigate = router.navigate as jest.Mock;
  navigate.mockClear();
  const screen = await render(
    <AppSidebarProvider>
      <Header title="Reports" />
    </AppSidebarProvider>,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Open Navigation Menu' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Toggle Reports group' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Go to Reports overview' }));
  expect(navigate).toHaveBeenCalledWith('/reports/overview');
});
