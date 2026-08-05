import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { useQuery } from '@tanstack/react-query';
import type { RoleCode } from '@ximo/shared';
import { api } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { Button, EmptyState, ErrorState, Field, Header, LoadingState, Screen } from '@/components/ui';
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

interface PaginatedAuditLogs {
  items: AuditLogRecord[];
  page: number;
  pageSize: number;
  total: number;
}

const CATEGORY_OPTIONS = [
  { label: 'All Categories', value: 'all', icon: 'layers' },
  { label: 'Sales & Checkout', value: 'sale', icon: 'shopping-cart' },
  { label: 'Customer Refunds', value: 'return', icon: 'rotate-ccw' },
  { label: 'Register & Cash Shifts', value: 'shift', icon: 'key' },
  { label: 'Inventory & Transfers', value: 'inventory', icon: 'sliders' },
  { label: 'Staff & Security PINs', value: 'user', icon: 'users' },
  { label: 'Products & Catalogue', value: 'product', icon: 'box' },
  { label: 'Purchasing & Suppliers', value: 'purchase_order', icon: 'truck' },
  { label: 'Store Settings', value: 'organization', icon: 'settings' },
];

const ROLE_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'All Roles', value: 'all' },
  { label: 'Owner', value: 'owner' },
  { label: 'Administrator', value: 'administrator' },
  { label: 'Manager', value: 'manager' },
  { label: 'Cashier', value: 'cashier' },
  { label: 'Inventory Staff', value: 'inventory_staff' },
];

function actionLabel(action: string): { label: string; bg: string; text: string; icon: string } {
  switch (action) {
    case 'sale.created':
    case 'sale.completed':
      return { label: 'Sale Completed', bg: 'bg-emerald-100', text: 'text-emerald-800', icon: 'shopping-cart' };
    case 'return.created':
      return { label: 'Customer Refund', bg: 'bg-red-100', text: 'text-red-800', icon: 'rotate-ccw' };
    case 'shift.opened':
      return { label: 'Shift Opened', bg: 'bg-blue-100', text: 'text-blue-800', icon: 'unlock' };
    case 'shift.closed':
      return { label: 'Shift Closed', bg: 'bg-purple-100', text: 'text-purple-800', icon: 'lock' };
    case 'cash.moved':
      return { label: 'Cash Drawer Movement', bg: 'bg-amber-100', text: 'text-amber-800', icon: 'dollar-sign' };
    case 'inventory.adjusted':
    case 'inventory.opening_stock':
      return { label: 'Stock Adjusted', bg: 'bg-amber-100', text: 'text-amber-900', icon: 'sliders' };
    case 'user.created':
      return { label: 'Employee Added', bg: 'bg-teal-100', text: 'text-teal-800', icon: 'user-plus' };
    case 'user.updated':
      return { label: 'Access Updated', bg: 'bg-indigo-100', text: 'text-indigo-800', icon: 'user-check' };
    case 'user.pin_updated':
      return { label: 'Security PIN Changed', bg: 'bg-rose-100', text: 'text-rose-800', icon: 'key' };
    case 'product.created':
    case 'product_variant.created':
      return { label: 'Product Created', bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'box' };
    case 'product.updated':
      return { label: 'Product Updated', bg: 'bg-slate-100', text: 'text-slate-700', icon: 'edit-2' };
    case 'product.deleted':
      return { label: 'Product Deleted', bg: 'bg-red-50', text: 'text-red-700', icon: 'trash-2' };
    case 'organization.settings_updated':
    case 'organization.updated':
      return { label: 'Settings Updated', bg: 'bg-slate-200', text: 'text-slate-800', icon: 'settings' };
    default:
      if (action.startsWith('purchase_order')) {
        return { label: 'Supplier Order', bg: 'bg-cyan-100', text: 'text-cyan-800', icon: 'truck' };
      }
      return { label: action, bg: 'bg-slate-100', text: 'text-slate-700', icon: 'activity' };
  }
}

function formatKeyName(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();
}

function formatValue(key: string, value: any): string {
  if (value === null || value === undefined || value === '') return 'N/A';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (key.toLowerCase().includes('cost') || key.toLowerCase().includes('price') || key.toLowerCase().includes('amount')) {
    return formatMoney(value);
  }
  return String(value);
}

function formatDetailSummary(log: AuditLogRecord): string {
  const data = log.after || log.before || log.metadata || {};

  // Sales
  if (log.action === 'sale.created' || log.action === 'sale.completed') {
    const rcpt = data.receiptNumber || data.receipt_number || log.entityId.slice(0, 8);
    const amt = formatMoney(data.totalAmount || data.total_amount || '0');
    return `Receipt #${rcpt} · Total: ${amt}`;
  }

  // Returns / Refunds
  if (log.action === 'return.created') {
    const amt = formatMoney(data.refundAmount || data.refund_amount || '0');
    const reason = data.reason || 'Customer Return';
    return `Refund: ${amt} (${reason})`;
  }

  // Cash Movements
  if (log.action === 'cash.moved') {
    const typeLabel = data.type === 'cash_in' ? 'Cash In' : 'Cash Out';
    const amt = formatMoney(data.amount || '0');
    const reason = data.reason ? ` · ${data.reason}` : '';
    return `${typeLabel}: ${amt}${reason}`;
  }

  // Register Shifts
  if (log.action === 'shift.opened') {
    return `Opened shift · Starting cash: ${formatMoney(data.startingCash || '0')}`;
  }
  if (log.action === 'shift.closed') {
    const counted = formatMoney(data.actualCash || '0');
    const variance = formatMoney(data.variance || '0');
    return `Closed shift · Counted: ${counted} (Variance: ${variance})`;
  }

  // Stock Adjustments / Opening Stock
  if (log.action === 'inventory.adjusted' || log.action === 'inventory.opening_stock') {
    const prodName = data.productName || data.name || (data.productId ? `Product (${data.productId.slice(0, 8)})` : 'Stock item');
    const delta = data.quantityDelta ?? data.quantity ?? data.openedQuantity ?? 0;
    const deltaStr = delta > 0 ? `+${delta}` : `${delta}`;
    const reason = data.reason || 'Manual Adjustment';
    return `${prodName} · Quantity: ${deltaStr} · Reason: ${reason}`;
  }

  // Products
  if (log.action === 'product.created' || log.action === 'product_variant.created') {
    const name = data.name || 'New Item';
    const sku = data.sku ? ` · SKU: ${data.sku}` : '';
    const unit = data.unit ? ` · Unit: ${data.unit}` : '';
    return `Created product "${name}"${sku}${unit}`;
  }
  if (log.action === 'product.updated' || log.action === 'product_variant.updated') {
    const name = data.name || log.before?.name || 'Product';
    return `Updated product details for "${name}"`;
  }
  if (log.action === 'product.deleted') {
    const name = data.name || log.before?.name || 'Product';
    return `Removed product "${name}" from catalogue`;
  }

  // Store Settings & Organization
  if (log.action === 'organization.settings_updated' || log.action === 'organization.updated') {
    const orgName = data.name || 'Store';
    return `Updated profile & store settings for "${orgName}"`;
  }

  // Employees & Access
  if (log.action === 'user.created') {
    const name = data.displayName || data.email || 'Employee';
    const role = roleLabel(data.role || 'cashier');
    return `Added staff member "${name}" (${role})`;
  }
  if (log.action === 'user.updated') {
    const name = data.displayName || log.before?.displayName || 'Employee';
    return `Updated employee profile for "${name}"`;
  }
  if (log.action === 'user.pin_updated') {
    const name = data.displayName || log.before?.displayName || 'Employee';
    return `Updated security PIN for "${name}"`;
  }

  // Generic Human-Friendly Summary (No Raw JSON)
  if (typeof data === 'object' && data !== null) {
    const parts: string[] = [];
    if (data.name) parts.push(`Name: ${data.name}`);
    if (data.sku) parts.push(`SKU: ${data.sku}`);
    if (data.barcode) parts.push(`Barcode: ${data.barcode}`);
    if (data.unit) parts.push(`Unit: ${data.unit}`);
    if (data.cost) parts.push(`Cost: ${formatMoney(data.cost)}`);
    if (data.price) parts.push(`Price: ${formatMoney(data.price)}`);
    if (parts.length > 0) return parts.join(' · ');

    const entries = Object.entries(data)
      .filter(([k, v]) => typeof v !== 'object' && v !== null && k !== 'id')
      .slice(0, 3)
      .map(([k, v]) => `${formatKeyName(k)}: ${formatValue(k, v)}`);
    if (entries.length > 0) return entries.join(' · ');
  }

  return `Activity logged for Record #${log.entityId.slice(0, 8)}`;
}

function AuditContent() {
  const { currentUser } = useSession();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedRole, setSelectedRole] = useState('all');
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const isModuleEnabled = currentUser?.modules.includes('audit');
  const canViewAudit =
    Boolean(isModuleEnabled) &&
    (currentUser?.permissions.includes('audit:read') ||
      ['owner', 'administrator', 'manager'].includes(currentUser?.role || ''));

  // Combined search term for API backend search filter
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
        `/audit?page=${page}&pageSize=15${effectiveSearch ? `&search=${encodeURIComponent(effectiveSearch)}` : ''}`,
      ),
    enabled: canViewAudit,
  });

  if (!isModuleEnabled) {
    return (
      <Screen>
        <Header title="Audit Logs" showBack backLabel="Back" />
        <View className="flex-1 items-center justify-center p-8">
          <View className="mb-4 h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 border border-amber-200">
            <Feather name="lock" size={26} color="#B45309" />
          </View>
          <Text className="text-xl font-bold text-slate-900">Module Access Disabled</Text>
          <Text className="mt-2 max-w-xs text-center text-xs text-slate-500 leading-relaxed">
            The Audit Logs module is disabled for your organization. Contact your administrator or store owner to enable activity tracking.
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
        <Header title="Audit Logs" subtitle="Restricted Access" showBack backLabel="More" fallbackHref="/(tabs)/more" />
        <View className="flex-1 items-center justify-center p-6">
          <View className="mb-4 h-14 w-14 items-center justify-center rounded-full bg-red-100">
            <Feather name="shield-off" size={26} color="#DC2626" />
          </View>
          <Text className="mb-2 text-xl font-bold text-slate-900">Access Restricted</Text>
          <Text className="max-w-sm text-center text-sm text-slate-600">
            Audit logs contain sensitive transaction security trails. Only Store Owners, Administrators, and Managers are authorized to view audit history.
          </Text>
        </View>
      </Screen>
    );
  }

  const logs = Array.isArray(query.data)
    ? query.data
    : ((query.data as any)?.items ?? (query.data as any)?.data ?? []);
  const totalPages = Math.max(1, Math.ceil(logs.length / 15));
  const activeCategoryObj = CATEGORY_OPTIONS.find((c) => c.value === selectedCategory) ?? CATEGORY_OPTIONS[0]!;
  const activeRoleObj = ROLE_OPTIONS.find((r) => r.value === selectedRole) ?? ROLE_OPTIONS[0]!;

  return (
    <Screen>
      <Header
        title="Audit Logs"
        subtitle="Complete system transaction & activity trail across all staff roles"
        showBack
        backLabel="More"
        fallbackHref="/(tabs)/more"
      />

      <ScrollView contentContainerClassName="p-4 pb-12">
        <View className="mx-auto w-full max-w-5xl">
          {/* Dropdown Filters & Search Bar */}
          <View className="mb-4 gap-3">
            <View className="flex-row flex-wrap gap-2">
              {/* Category Dropdown Trigger */}
              <View className="flex-1 min-w-[200px]">
                <Text className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Category Filter
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setCategoryDropdownOpen(true)}
                  className="min-h-11 flex-row items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 active:bg-slate-50 shadow-xs"
                >
                  <View className="flex-row items-center gap-2">
                    <Feather name={activeCategoryObj.icon as any} size={16} color="#1A593B" />
                    <Text className="text-sm font-semibold text-slate-900">{activeCategoryObj.label}</Text>
                  </View>
                  <Feather name="chevron-down" size={16} color="#64748B" />
                </Pressable>
              </View>

              {/* Role Dropdown Trigger */}
              <View className="w-[180px]">
                <Text className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Role Filter
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setRoleDropdownOpen(true)}
                  className="min-h-11 flex-row items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 active:bg-slate-50 shadow-xs"
                >
                  <View className="flex-row items-center gap-2">
                    <Feather name="user" size={16} color="#1A593B" />
                    <Text className="text-sm font-semibold text-slate-900">{activeRoleObj.label}</Text>
                  </View>
                  <Feather name="chevron-down" size={16} color="#64748B" />
                </Pressable>
              </View>
            </View>

            {/* Search Input & Refresh Button */}
            <View className="flex-row items-center gap-3">
              <View className="flex-1">
                <Field
                  label=""
                  value={search}
                  onChangeText={(text) => {
                    setSearch(text);
                    setPage(1);
                  }}
                  placeholder="Search staff name, action, or details…"
                />
              </View>

              {(selectedCategory !== 'all' || selectedRole !== 'all' || search) ? (
                <Button
                  title="Reset"
                  variant="secondary"
                  onPress={() => {
                    setSelectedCategory('all');
                    setSelectedRole('all');
                    setSearch('');
                    setPage(1);
                  }}
                />
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Refresh audit logs"
                onPress={() => void query.refetch()}
                className="h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white active:bg-slate-100 shadow-xs"
              >
                <Feather name="refresh-cw" size={18} color="#475569" />
              </Pressable>
            </View>
          </View>

          {/* Audit Logs List Feed */}
          {query.isLoading ? (
            <View className="min-h-60 rounded-2xl bg-white p-6 shadow-sm">
              <LoadingState label="Loading audit trail records…" />
            </View>
          ) : query.isError ? (
            <View className="min-h-60 rounded-2xl bg-white p-6 shadow-sm">
              <ErrorState message={query.error.message} retry={() => void query.refetch()} />
            </View>
          ) : logs.length === 0 ? (
            <View className="min-h-60 rounded-2xl bg-white p-6 shadow-sm">
              <EmptyState
                title="No audit records found"
                message={effectiveSearch ? 'No audit records match your selected filters.' : 'System actions and transactions will be recorded here.'}
              />
            </View>
          ) : (
            <View className="gap-3">
              {logs.map((log: AuditLogRecord) => {
                const actionMeta = actionLabel(log.action);
                const isExpanded = expandedId === log.id;

                return (
                  <View key={log.id} className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setExpandedId(isExpanded ? null : log.id)}
                      className="flex-row items-start justify-between"
                    >
                      <View className="flex-1 pr-3">
                        <View className="flex-row flex-wrap items-center gap-2">
                          <View className={`flex-row items-center gap-1.5 rounded-full px-2.5 py-1 ${actionMeta.bg}`}>
                            <Feather name={actionMeta.icon as any} size={12} className={actionMeta.text} />
                            <Text className={`text-xs font-bold ${actionMeta.text}`}>{actionMeta.label}</Text>
                          </View>

                          <View className="rounded-full bg-slate-100 px-2 py-0.5">
                            <Text className="text-[11px] font-semibold text-slate-700">
                              {log.actorName} ({roleLabel(log.actorRole || 'cashier')})
                            </Text>
                          </View>

                          {log.branchName ? (
                            <Text className="text-xs font-medium text-slate-400">· {log.branchName}</Text>
                          ) : null}
                        </View>

                        <Text className="mt-2 text-sm font-semibold text-slate-900">
                          {formatDetailSummary(log)}
                        </Text>
                      </View>

                      <View className="items-end">
                        <Text className="text-xs font-medium text-slate-400">
                          {formatDate(log.createdAt)}
                        </Text>
                        <Feather
                          name={isExpanded ? 'chevron-up' : 'chevron-down'}
                          size={16}
                          color="#94A3B8"
                          className="mt-2"
                        />
                      </View>
                    </Pressable>

                    {isExpanded ? (
                      <View className="mt-3 border-t border-slate-100 pt-3">
                        <Text className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                          Transaction & Record Details
                        </Text>
                        <View className="rounded-xl bg-slate-50 p-3.5 border border-slate-200/80 gap-2">
                          <View className="flex-row items-center justify-between border-b border-slate-200/60 pb-2">
                            <Text className="text-xs font-medium text-slate-500">Performed By</Text>
                            <Text className="text-xs font-semibold text-slate-900">{log.actorName} ({roleLabel(log.actorRole || 'cashier')})</Text>
                          </View>

                          {log.branchName ? (
                            <View className="flex-row items-center justify-between border-b border-slate-200/60 pb-2">
                              <Text className="text-xs font-medium text-slate-500">Branch Location</Text>
                              <Text className="text-xs font-semibold text-slate-900">{log.branchName}</Text>
                            </View>
                          ) : null}

                          <View className="flex-row items-center justify-between border-b border-slate-200/60 pb-2">
                            <Text className="text-xs font-medium text-slate-500">Log Reference ID</Text>
                            <Text className="text-xs font-mono font-semibold text-slate-700">#{log.id.slice(0, 8)}</Text>
                          </View>

                          {Object.entries(log.after || log.before || log.metadata || {}).map(([key, val]) => {
                            if (val === null || val === undefined || val === '' || typeof val === 'object' || key === 'id') return null;
                            return (
                              <View key={key} className="flex-row items-center justify-between border-b border-slate-200/40 pb-1.5 pt-0.5 last:border-b-0">
                                <Text className="text-xs font-medium text-slate-500">{formatKeyName(key)}</Text>
                                <Text className="text-xs font-semibold text-slate-900">{formatValue(key, val)}</Text>
                              </View>
                            );
                          })}
                        </View>
                      </View>
                    ) : null}
                  </View>
                );
              })}

              {/* Pagination Bar */}
              <View className="mt-4 flex-row items-center justify-between rounded-2xl border border-slate-200 bg-white p-4">
                <Text className="text-xs font-semibold text-slate-500">
                  Page {page} of {totalPages} ({logs.length} audit logs)
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
                    disabled={page >= totalPages}
                    onPress={() => setPage((p) => Math.min(totalPages, p + 1))}
                  />
                </View>
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Category Dropdown Modal */}
      <Modal visible={categoryDropdownOpen} transparent animationType="fade">
        <Pressable
          onPress={() => setCategoryDropdownOpen(false)}
          className="flex-1 items-center justify-center bg-black/40 p-4"
        >
          <Pressable onPress={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-xl">
            <View className="mb-3 flex-row items-center justify-between border-b border-slate-100 pb-3">
              <Text className="text-base font-bold text-slate-900">Select Audit Category</Text>
              <Pressable onPress={() => setCategoryDropdownOpen(false)}>
                <Feather name="x" size={20} color="#64748B" />
              </Pressable>
            </View>
            <View className="gap-1">
              {CATEGORY_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.value}
                  accessibilityRole="button"
                  onPress={() => {
                    setSelectedCategory(opt.value);
                    setCategoryDropdownOpen(false);
                    setPage(1);
                  }}
                  className={`flex-row items-center justify-between rounded-xl px-3 py-2.5 ${
                    selectedCategory === opt.value ? 'bg-brand-50 border border-brand-200' : 'active:bg-slate-100'
                  }`}
                >
                  <View className="flex-row items-center gap-2.5">
                    <Feather name={opt.icon as any} size={17} color={selectedCategory === opt.value ? '#1A593B' : '#64748B'} />
                    <Text className={`text-sm ${selectedCategory === opt.value ? 'font-bold text-brand-900' : 'font-medium text-slate-700'}`}>
                      {opt.label}
                    </Text>
                  </View>
                  {selectedCategory === opt.value ? <Feather name="check" size={16} color="#1A593B" /> : null}
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Role Dropdown Modal */}
      <Modal visible={roleDropdownOpen} transparent animationType="fade">
        <Pressable
          onPress={() => setRoleDropdownOpen(false)}
          className="flex-1 items-center justify-center bg-black/40 p-4"
        >
          <Pressable onPress={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-xl">
            <View className="mb-3 flex-row items-center justify-between border-b border-slate-100 pb-3">
              <Text className="text-base font-bold text-slate-900">Select Staff Role</Text>
              <Pressable onPress={() => setRoleDropdownOpen(false)}>
                <Feather name="x" size={20} color="#64748B" />
              </Pressable>
            </View>
            <View className="gap-1">
              {ROLE_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.value}
                  accessibilityRole="button"
                  onPress={() => {
                    setSelectedRole(opt.value);
                    setRoleDropdownOpen(false);
                    setPage(1);
                  }}
                  className={`flex-row items-center justify-between rounded-xl px-3 py-2.5 ${
                    selectedRole === opt.value ? 'bg-brand-50 border border-brand-200' : 'active:bg-slate-100'
                  }`}
                >
                  <Text className={`text-sm ${selectedRole === opt.value ? 'font-bold text-brand-900' : 'font-medium text-slate-700'}`}>
                    {opt.label}
                  </Text>
                  {selectedRole === opt.value ? <Feather name="check" size={16} color="#1A593B" /> : null}
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
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
