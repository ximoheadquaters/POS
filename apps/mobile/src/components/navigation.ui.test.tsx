import { renderHook, render, fireEvent } from '@testing-library/react-native';
import { TextInput } from 'react-native';
import { useVisibleNavigation, AppSidebarProvider } from './app-sidebar';
import { ExpandableSection, Header } from './ui';
import { QuickAccess } from './quick-access';

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
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, usePathname: () => '/products' }));
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
