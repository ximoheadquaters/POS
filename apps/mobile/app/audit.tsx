import { useMemo, useState, type ComponentProps } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { router } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { useQuery } from '@tanstack/react-query';
import type { RoleCode } from '@ximo/shared';
import { api } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { Button, EmptyState, ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import { useSession } from '@/providers/session';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { roleLabel } from '@/lib/access-control';

interface AuditLogRecord {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  before: any;
  after: any;
  metadata: any;
  createdAt: string;
  actorName: string;
  actorRole?: RoleCode;
  branchName?: string;
}

type FeatherName = ComponentProps<typeof Feather>['name'];

interface DetailRow {
  label: string;
  value: string;
}

const CATEGORY_OPTIONS: Array<{ label: string; value: string; icon: FeatherName }> = [
  { label: 'All categories', value: 'all', icon: 'layers' },
  { label: 'Sales', value: 'sale', icon: 'shopping-cart' },
  { label: 'Refunds', value: 'return', icon: 'rotate-ccw' },
  { label: 'Shifts & cash', value: 'shift', icon: 'key' },
  { label: 'Inventory', value: 'inventory', icon: 'sliders' },
  { label: 'Staff', value: 'user', icon: 'users' },
  { label: 'Products', value: 'product', icon: 'box' },
  { label: 'Purchasing', value: 'purchase_order', icon: 'truck' },
  { label: 'Settings', value: 'organization', icon: 'settings' },
];

const ROLE_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'All roles', value: 'all' },
  { label: 'Owner', value: 'owner' },
  { label: 'Administrator', value: 'administrator' },
  { label: 'Manager', value: 'manager' },
  { label: 'Cashier', value: 'cashier' },
  { label: 'Inventory staff', value: 'inventory_staff' },
];

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return formatDate(isoString);
}

function actionLabel(action: string): string {
  switch (action) {
    case 'sale.created':
    case 'sale.completed':
      return 'Sale completed';
    case 'return.created':
      return 'Customer refund';
    case 'shift.opened':
      return 'Shift opened';
    case 'shift.closed':
      return 'Shift closed';
    case 'cash.moved':
      return 'Cash movement';
    case 'inventory.adjusted':
    case 'inventory.opening_stock':
      return 'Stock adjusted';
    case 'user.created':
      return 'Employee added';
    case 'user.updated':
      return 'Access updated';
    case 'user.pin_updated':
      return 'PIN changed';
    case 'product.created':
    case 'product_variant.created':
      return 'Product created';
    case 'product.updated':
      return 'Product updated';
    case 'product.deleted':
      return 'Product deleted';
    case 'organization.settings_updated':
    case 'organization.updated':
      return 'Settings updated';
    default:
      if (action.startsWith('purchase_order')) return 'Supplier order';
      return action.replace(/[._]/g, ' ');
  }
}

function isNegativeAction(action: string): boolean {
  return (
    action === 'return.created' ||
    action === 'product.deleted' ||
    action === 'user.pin_updated'
  );
}

function formatKeyName(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();
}

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const lower = key.toLowerCase();
  if (
    lower.includes('cost') ||
    lower.includes('price') ||
    lower.includes('amount') ||
    lower.includes('cash') ||
    lower.includes('total') ||
    lower.includes('variance')
  ) {
    return formatMoney(value as string | number);
  }
  return String(value);
}

function getTargetSummary(log: AuditLogRecord): string {
  const data = log.after || log.before || log.metadata || {};

  if (log.action === 'sale.created' || log.action === 'sale.completed') {
    const rcpt = data.receiptNumber || data.receipt_number || log.entityId.slice(0, 8);
    const total = data.total ?? data.totalAmount ?? data.total_amount ?? '0';
    return `${rcpt} · ${formatMoney(total)}`;
  }
  if (log.action === 'return.created') {
    return formatMoney(data.refundAmount || data.refund_amount || '0');
  }
  if (log.action === 'cash.moved') {
    const typeLabel = data.type === 'cash_in' ? 'Cash in' : 'Cash out';
    return `${typeLabel} · ${formatMoney(data.amount || '0')}`;
  }
  if (log.action === 'shift.opened') {
    return `Start ${formatMoney(data.startingCash || '0')}`;
  }
  if (log.action === 'shift.closed') {
    return `Counted ${formatMoney(data.actualCash || '0')}`;
  }
  if (log.action === 'inventory.adjusted' || log.action === 'inventory.opening_stock') {
    const prodName =
      data.productName ||
      data.name ||
      (data.productId ? `Product ${String(data.productId).slice(0, 8)}` : 'Stock item');
    const delta = Number(data.quantityDelta ?? data.quantity ?? data.openedQuantity ?? 0);
    const deltaStr = Number.isFinite(delta) ? (delta > 0 ? `+${delta}` : `${delta}`) : '0';
    return `${prodName} · ${deltaStr}`;
  }
  if (
    log.action.startsWith('product') ||
    log.action === 'user.created' ||
    log.action === 'user.updated' ||
    log.action === 'user.pin_updated'
  ) {
    return String(data.name || data.displayName || data.email || log.branchName || '—');
  }
  if (log.branchName) return log.branchName;
  return `#${log.entityId.slice(0, 8)}`;
}

function getDetailRows(log: AuditLogRecord): DetailRow[] {
  const data = log.after || log.before || log.metadata || {};
  const rows: DetailRow[] = [
    { label: 'When', value: formatDate(log.createdAt) },
    { label: 'Staff', value: `${log.actorName} (${roleLabel(log.actorRole || 'cashier')})` },
  ];
  if (log.branchName) rows.push({ label: 'Branch', value: log.branchName });
  rows.push({ label: 'Log ID', value: `#${log.id.slice(0, 8)}` });

  for (const [key, val] of Object.entries(data)) {
    if (val === null || val === undefined || val === '' || typeof val === 'object' || key === 'id') {
      continue;
    }
    rows.push({ label: formatKeyName(key), value: formatValue(key, val) });
  }
  return rows;
}

function AuditContent() {
  const { width } = useWindowDimensions();
  const isWide = width >= 960;
  const { currentUser } = useSession();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedRole, setSelectedRole] = useState('all');
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AuditLogRecord | null>(null);

  const isModuleEnabled = currentUser?.modules.includes('audit');
  const canViewAudit =
    Boolean(isModuleEnabled) &&
    (currentUser?.permissions.includes('audit:read') ||
      ['owner', 'administrator', 'manager'].includes(currentUser?.role || ''));

  const effectiveSearch = [
    selectedCategory !== 'all' ? selectedCategory : '',
    selectedRole !== 'all' ? selectedRole : '',
    search.trim(),
  ]
    .filter(Boolean)
    .join(' ');

  const query = useQuery({
    queryKey: ['audit-logs', page, effectiveSearch],
    queryFn: () =>
      api<AuditLogRecord[]>(
        `/audit?page=${page}&pageSize=15${
          effectiveSearch ? `&search=${encodeURIComponent(effectiveSearch)}` : ''
        }`,
      ),
    enabled: canViewAudit,
  });

  const logs = useMemo(() => {
    if (Array.isArray(query.data)) return query.data;
    return ((query.data as any)?.items ?? (query.data as any)?.data ?? []) as AuditLogRecord[];
  }, [query.data]);

  const activeCategory =
    CATEGORY_OPTIONS.find((c) => c.value === selectedCategory) ?? CATEGORY_OPTIONS[0]!;
  const activeRole = ROLE_OPTIONS.find((r) => r.value === selectedRole) ?? ROLE_OPTIONS[0]!;
  const hasFilters = selectedCategory !== 'all' || selectedRole !== 'all' || Boolean(search.trim());

  if (!isModuleEnabled) {
    return (
      <Screen>
        <Header title="Audit Logs" showBack backLabel="Back" />
        <View className="flex-1 items-center justify-center p-8">
          <View className="mb-4 h-14 w-14 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50">
            <Feather name="lock" size={26} color="#B45309" />
          </View>
          <Text className="text-xl font-bold text-slate-900">Module Access Disabled</Text>
          <Text className="mt-2 max-w-xs text-center text-xs leading-relaxed text-slate-500">
            The Audit Logs module is disabled for your organization.
          </Text>
          <View className="mt-6 w-full max-w-xs">
            <Button title="Return to POS" onPress={() => router.push('/(tabs)/pos')} />
          </View>
        </View>
      </Screen>
    );
  }

  if (!canViewAudit) {
    return (
      <Screen>
        <Header
          title="Audit Logs"
          subtitle="Restricted access"
          showBack
          backLabel="More"
          fallbackHref="/(tabs)/more"
        />
        <View className="flex-1 items-center justify-center p-6">
          <View className="mb-4 h-14 w-14 items-center justify-center rounded-full bg-red-100">
            <Feather name="shield-off" size={26} color="#DC2626" />
          </View>
          <Text className="mb-2 text-xl font-bold text-slate-900">Access Restricted</Text>
          <Text className="max-w-sm text-center text-sm text-slate-600">
            Only owners, administrators, and managers can view audit history.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Header
        title="Audit Logs"
        subtitle="Staff actions and system activity"
        showBack
        backLabel="More"
        fallbackHref="/(tabs)/more"
      />

      <View className="gap-2 border-b border-slate-100 bg-white px-4 py-3">
        <View className="min-h-11 flex-row items-center rounded-xl border border-slate-200 bg-slate-100 px-3">
          <Feather name="search" size={17} color="#81776E" />
          <TextInput
            value={search}
            onChangeText={(text) => {
              setSearch(text);
              setPage(1);
            }}
            placeholder="Search staff, action, or details"
            placeholderTextColor="#81776E"
            selectionColor="#1A593B"
            style={{ outline: 'none' } as object}
            className="ml-2 min-h-11 flex-1 bg-transparent text-sm text-slate-900"
          />
          {search ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => {
                setSearch('');
                setPage(1);
              }}
            >
              <Feather name="x" size={16} color="#81776E" />
            </Pressable>
          ) : null}
        </View>

        <View className="flex-row items-center gap-2">
          <Pressable
            accessibilityRole="button"
            onPress={() => setCategoryDropdownOpen(true)}
            className="min-h-11 min-w-0 flex-1 flex-row items-center justify-between rounded-xl border border-slate-200 bg-white px-3 active:bg-slate-50"
          >
            <View className="mr-2 min-w-0 flex-1 flex-row items-center gap-2">
              <Feather name={activeCategory.icon} size={15} color="#1A593B" />
              <Text numberOfLines={1} className="flex-1 text-sm font-semibold text-slate-900">
                {activeCategory.label}
              </Text>
            </View>
            <Feather name="chevron-down" size={16} color="#64748B" />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => setRoleDropdownOpen(true)}
            className="min-h-11 min-w-0 flex-1 flex-row items-center justify-between rounded-xl border border-slate-200 bg-white px-3 active:bg-slate-50"
          >
            <View className="mr-2 min-w-0 flex-1 flex-row items-center gap-2">
              <Feather name="user" size={15} color="#1A593B" />
              <Text numberOfLines={1} className="flex-1 text-sm font-semibold text-slate-900">
                {activeRole.label}
              </Text>
            </View>
            <Feather name="chevron-down" size={16} color="#64748B" />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh audit logs"
            onPress={() => void query.refetch()}
            className="h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white active:bg-slate-50"
          >
            <Feather name="refresh-cw" size={16} color="#475569" />
          </Pressable>
        </View>

        {hasFilters ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setSelectedCategory('all');
              setSelectedRole('all');
              setSearch('');
              setPage(1);
            }}
            className="self-start"
          >
            <Text className="text-xs font-semibold text-brand-800">Clear filters</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView className="flex-1 bg-[#F8F9FA]" contentContainerClassName="grow px-3 py-3 sm:px-4 sm:py-4">
        <View className="mx-auto w-full max-w-6xl">
          {query.isLoading ? (
            <LoadingState label="Loading activity…" />
          ) : query.isError ? (
            <ErrorState message={query.error.message} retry={() => void query.refetch()} />
          ) : logs.length === 0 ? (
            <EmptyState
              title="No activity found"
              message={
                hasFilters
                  ? 'Nothing matches your filters. Try clearing them.'
                  : 'Staff actions and transactions will show up here.'
              }
            />
          ) : isWide ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="min-w-[980px] w-full">
                <View className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <View className="flex-row items-center border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                    <Text className="w-[110px] text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      When
                    </Text>
                    <Text className="w-[140px] text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Staff
                    </Text>
                    <Text className="min-w-0 flex-[1.1] text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Action
                    </Text>
                    <Text className="min-w-0 flex-[1.3] text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Details
                    </Text>
                    <Text className="w-[110px] text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Status
                    </Text>
                    <View className="w-[88px]" />
                  </View>

                  {logs.map((log, index) => {
                    const negative = isNegativeAction(log.action);
                    const target = getTargetSummary(log);
                    return (
                      <Pressable
                        key={log.id}
                        accessibilityRole="button"
                        accessibilityLabel={`View ${actionLabel(log.action)}`}
                        onPress={() => setSelectedLog(log)}
                        className={`flex-row items-center px-4 py-3.5 active:bg-brand-50/60 ${
                          index > 0 ? 'border-t border-slate-100' : ''
                        }`}
                      >
                        <Text className="w-[110px] text-sm text-slate-500">
                          {formatRelativeTime(log.createdAt)}
                        </Text>
                        <View className="w-[140px] pr-2">
                          <Text numberOfLines={1} className="text-sm font-medium text-slate-900">
                            {log.actorName}
                          </Text>
                          <Text numberOfLines={1} className="text-[11px] text-slate-400">
                            {roleLabel(log.actorRole || 'cashier')}
                          </Text>
                        </View>
                        <Text
                          numberOfLines={1}
                          className="min-w-0 flex-[1.1] pr-3 text-sm font-semibold text-slate-900"
                        >
                          {actionLabel(log.action)}
                        </Text>
                        <Text
                          numberOfLines={1}
                          className="min-w-0 flex-[1.3] pr-3 text-sm text-slate-600"
                        >
                          {target}
                        </Text>
                        <View className="w-[110px] flex-row items-center gap-1.5">
                          <View
                            className={`h-5 w-5 items-center justify-center rounded-full ${
                              negative ? 'bg-red-100' : 'bg-brand-100'
                            }`}
                          >
                            <Feather
                              name={negative ? 'x' : 'check'}
                              size={12}
                              color={negative ? '#B91C1C' : '#1A593B'}
                            />
                          </View>
                          <Text
                            className={`text-sm font-medium ${
                              negative ? 'text-red-700' : 'text-brand-800'
                            }`}
                          >
                            {negative ? 'Flagged' : 'Success'}
                          </Text>
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="View log details"
                          onPress={() => setSelectedLog(log)}
                          className="min-h-9 w-[88px] flex-row items-center justify-center gap-1 rounded-lg border border-brand-300 bg-white px-2 active:bg-brand-50"
                        >
                          <Text className="text-xs font-semibold text-brand-800">View</Text>
                          <Feather name="arrow-right" size={13} color="#1A593B" />
                        </Pressable>
                      </Pressable>
                    );
                  })}

                  <View className="flex-row items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3">
                    <Text className="text-xs font-medium text-slate-500">
                      Page {page} · {logs.length} shown
                    </Text>
                    <View className="flex-row gap-2">
                      <Button
                        title="Previous"
                        variant="secondary"
                        disabled={page <= 1}
                        onPress={() => setPage((p) => Math.max(1, p - 1))}
                      />
                      <Button
                        title="Next"
                        variant="secondary"
                        disabled={logs.length < 15}
                        onPress={() => setPage((p) => p + 1)}
                      />
                    </View>
                  </View>
                </View>
              </View>
            </ScrollView>
          ) : (
            <View className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              {logs.map((log, index) => {
                const negative = isNegativeAction(log.action);
                const target = getTargetSummary(log);
                return (
                  <Pressable
                    key={log.id}
                    accessibilityRole="button"
                    accessibilityLabel={`View ${actionLabel(log.action)}`}
                    onPress={() => setSelectedLog(log)}
                    className={`gap-2 px-3.5 py-3.5 active:bg-brand-50/60 ${
                      index > 0 ? 'border-t border-slate-100' : ''
                    }`}
                  >
                    <View className="flex-row items-start justify-between gap-2">
                      <View className="min-w-0 flex-1">
                        <Text className="text-sm font-semibold text-slate-900">
                          {actionLabel(log.action)}
                        </Text>
                        <Text className="mt-0.5 text-xs text-slate-500" numberOfLines={1}>
                          {log.actorName} · {formatRelativeTime(log.createdAt)}
                        </Text>
                      </View>
                      <View className="flex-row items-center gap-1">
                        <View
                          className={`h-5 w-5 items-center justify-center rounded-full ${
                            negative ? 'bg-red-100' : 'bg-brand-100'
                          }`}
                        >
                          <Feather
                            name={negative ? 'x' : 'check'}
                            size={12}
                            color={negative ? '#B91C1C' : '#1A593B'}
                          />
                        </View>
                        <Text
                          className={`text-xs font-semibold ${
                            negative ? 'text-red-700' : 'text-brand-800'
                          }`}
                        >
                          {negative ? 'Flagged' : 'Success'}
                        </Text>
                      </View>
                    </View>
                    <Text className="text-sm text-slate-600" numberOfLines={2}>
                      {target}
                    </Text>
                    <View className="flex-row items-center justify-between">
                      <Text className="text-xs text-slate-400" numberOfLines={1}>
                        {log.branchName || '—'}
                      </Text>
                      <View className="flex-row items-center gap-1 rounded-lg border border-brand-300 px-2.5 py-1.5">
                        <Text className="text-xs font-semibold text-brand-800">View</Text>
                        <Feather name="arrow-right" size={12} color="#1A593B" />
                      </View>
                    </View>
                  </Pressable>
                );
              })}

              <View className="flex-row items-center justify-between border-t border-slate-200 bg-slate-50 px-3.5 py-3">
                <Text className="text-xs font-medium text-slate-500">
                  Page {page} · {logs.length} shown
                </Text>
                <View className="flex-row gap-2">
                  <Button
                    title="Previous"
                    variant="secondary"
                    disabled={page <= 1}
                    onPress={() => setPage((p) => Math.max(1, p - 1))}
                  />
                  <Button
                    title="Next"
                    variant="secondary"
                    disabled={logs.length < 15}
                    onPress={() => setPage((p) => p + 1)}
                  />
                </View>
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      <Modal
        visible={Boolean(selectedLog)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedLog(null)}
      >
        <View className="flex-1 items-center justify-end bg-black/40 sm:justify-center sm:p-6">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close details"
            onPress={() => setSelectedLog(null)}
            className="absolute inset-0"
          />
          <View className="z-10 max-h-[85%] w-full max-w-lg overflow-hidden rounded-t-3xl bg-white sm:rounded-3xl">
            {selectedLog ? (
              <>
                <View className="flex-row items-start justify-between border-b border-slate-100 px-5 py-4">
                  <View className="min-w-0 flex-1 pr-3">
                    <Text className="text-lg font-bold text-slate-900">
                      {actionLabel(selectedLog.action)}
                    </Text>
                    <Text className="mt-1 text-xs text-slate-500">
                      {formatDate(selectedLog.createdAt)}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setSelectedLog(null)}
                    className="h-9 w-9 items-center justify-center rounded-xl bg-slate-100"
                  >
                    <Feather name="x" size={18} color="#475569" />
                  </Pressable>
                </View>
                <ScrollView contentContainerClassName="gap-0 px-5 py-3 pb-6">
                  {getDetailRows(selectedLog).map((row) => (
                    <View
                      key={`${selectedLog.id}-${row.label}`}
                      className="flex-row items-start justify-between gap-4 border-b border-slate-50 py-2.5"
                    >
                      <Text className="w-[120px] shrink-0 text-xs font-medium text-slate-500">
                        {row.label}
                      </Text>
                      <Text className="min-w-0 flex-1 text-right text-sm font-semibold text-slate-900">
                        {row.value}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              </>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal
        visible={categoryDropdownOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCategoryDropdownOpen(false)}
      >
        <View className="flex-1 items-center justify-center p-4">
          <Pressable
            className="absolute inset-0 bg-black/40"
            onPress={() => setCategoryDropdownOpen(false)}
          />
          <View className="z-10 w-full max-w-sm rounded-3xl bg-white p-5 shadow-xl">
            <View className="mb-3 flex-row items-center justify-between border-b border-slate-100 pb-3">
              <Text className="text-base font-bold text-slate-900">Category</Text>
              <Pressable onPress={() => setCategoryDropdownOpen(false)}>
                <Feather name="x" size={20} color="#64748B" />
              </Pressable>
            </View>
            <View className="gap-1">
              {CATEGORY_OPTIONS.map((opt) => {
                const selected = selectedCategory === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => {
                      setSelectedCategory(opt.value);
                      setCategoryDropdownOpen(false);
                      setPage(1);
                    }}
                    className={`flex-row items-center justify-between rounded-xl px-3 py-2.5 ${
                      selected ? 'border border-brand-200 bg-brand-50' : 'active:bg-slate-100'
                    }`}
                  >
                    <View className="flex-row items-center gap-2.5">
                      <Feather
                        name={opt.icon}
                        size={17}
                        color={selected ? '#1A593B' : '#64748B'}
                      />
                      <Text
                        className={`text-sm ${
                          selected ? 'font-bold text-brand-900' : 'font-medium text-slate-700'
                        }`}
                      >
                        {opt.label}
                      </Text>
                    </View>
                    {selected ? <Feather name="check" size={16} color="#1A593B" /> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={roleDropdownOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setRoleDropdownOpen(false)}
      >
        <View className="flex-1 items-center justify-center p-4">
          <Pressable
            className="absolute inset-0 bg-black/40"
            onPress={() => setRoleDropdownOpen(false)}
          />
          <View className="z-10 w-full max-w-sm rounded-3xl bg-white p-5 shadow-xl">
            <View className="mb-3 flex-row items-center justify-between border-b border-slate-100 pb-3">
              <Text className="text-base font-bold text-slate-900">Staff role</Text>
              <Pressable onPress={() => setRoleDropdownOpen(false)}>
                <Feather name="x" size={20} color="#64748B" />
              </Pressable>
            </View>
            <View className="gap-1">
              {ROLE_OPTIONS.map((opt) => {
                const selected = selectedRole === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => {
                      setSelectedRole(opt.value);
                      setRoleDropdownOpen(false);
                      setPage(1);
                    }}
                    className={`flex-row items-center justify-between rounded-xl px-3 py-2.5 ${
                      selected ? 'border border-brand-200 bg-brand-50' : 'active:bg-slate-100'
                    }`}
                  >
                    <Text
                      className={`text-sm ${
                        selected ? 'font-bold text-brand-900' : 'font-medium text-slate-700'
                      }`}
                    >
                      {opt.label}
                    </Text>
                    {selected ? <Feather name="check" size={16} color="#1A593B" /> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

export default function AuditLogsScreen() {
  return (
    <AppSidebarProvider>
      <AuditContent />
    </AppSidebarProvider>
  );
}
