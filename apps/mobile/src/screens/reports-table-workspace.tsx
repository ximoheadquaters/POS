import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { REPORT_PERMISSION_MATRIX, type ReportAccessLevel } from '@ximo/shared';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { DateRangeCalendar } from '@/components/date-range-calendar';
import { Button, ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { buildReportsCsv, buildReportsExcel, buildReportsPdf } from '@/lib/report-export';
import {
  buildReportDocument,
  reportDocumentRowCount,
  type ReportCell,
  type ReportSectionId,
  type ReportTableDefinition,
} from '@/lib/report-table-model';
import type { ReportsWorkspace } from '@/lib/report-types';
import { saveReportExport, type ReportExportFormat } from '@/lib/save-report-export';
import { useIosAlert } from '@/providers/ios-alert';
import { useSession } from '@/providers/session';
import { useBranchStore } from '@/store/branch';

type Period = 'today' | 'yesterday' | '7d' | '30d' | 'custom';
type Comparison = 'none' | 'previous_period' | 'previous_month' | 'previous_year';

const REPORTS: Array<{
  id: ReportSectionId;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  matrix: string;
}> = [
  { id: 'overview', label: 'Overview', icon: 'file-text', matrix: 'overview' },
  { id: 'sales', label: 'Sales', icon: 'shopping-cart', matrix: 'sales' },
  { id: 'products', label: 'Products', icon: 'tag', matrix: 'products' },
  { id: 'inventory', label: 'Inventory', icon: 'box', matrix: 'inventory' },
  { id: 'purchasing', label: 'Purchasing', icon: 'truck', matrix: 'purchasing' },
  { id: 'profit', label: 'Profit', icon: 'trending-up', matrix: 'financial' },
  { id: 'cash', label: 'Cash & shifts', icon: 'credit-card', matrix: 'cash' },
  { id: 'audit', label: 'Audit', icon: 'shield', matrix: 'audit' },
  { id: 'repacking', label: 'Repacking', icon: 'repeat', matrix: 'repacking' },
];

function localDate(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function rangeFor(
  period: Period,
  custom: { from: string; to: string },
): { from: string; to: string } {
  const end = new Date();
  const start = new Date(end);
  if (period === 'custom') return custom;
  if (period === 'yesterday') {
    end.setDate(end.getDate() - 1);
    start.setDate(start.getDate() - 1);
  } else if (period === '7d') {
    start.setDate(start.getDate() - 6);
  } else if (period === '30d') {
    start.setDate(start.getDate() - 29);
  }
  return { from: localDate(start), to: localDate(end) };
}

function isoRange(range: { from: string; to: string }): { from: string; to: string } {
  const from = new Date(`${range.from}T00:00:00`);
  const to = new Date(`${range.to}T00:00:00`);
  to.setDate(to.getDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

function comparisonRange(
  current: { from: string; to: string },
  comparison: Comparison,
): { from: string; to: string } | null {
  if (comparison === 'none') return null;
  const start = new Date(`${current.from}T00:00:00`);
  const end = new Date(`${current.to}T00:00:00`);
  if (comparison === 'previous_year') {
    start.setFullYear(start.getFullYear() - 1);
    end.setFullYear(end.getFullYear() - 1);
  } else if (comparison === 'previous_month') {
    start.setMonth(start.getMonth() - 1);
    end.setMonth(end.getMonth() - 1);
  } else {
    const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
    start.setDate(start.getDate() - days);
    end.setDate(end.getDate() - days);
  }
  return { from: localDate(start), to: localDate(end) };
}

function displayRange(range: { from: string; to: string }): string {
  const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };
  const from = new Date(`${range.from}T00:00:00`).toLocaleDateString('en-PH', options);
  const to = new Date(`${range.to}T00:00:00`).toLocaleDateString('en-PH', options);
  return from === to ? from : `${from} – ${to}`;
}

function roleAccess(role: string, matrix: string): ReportAccessLevel {
  const normalized = role === 'administrator' ? 'administrator' : role;
  return REPORT_PERMISSION_MATRIX[matrix]?.[normalized] ?? 'none';
}

function cellText(cell: ReportCell): string {
  if (cell === null || cell === undefined || cell === '') return '—';
  return String(cell);
}

const NUMERIC_COLUMN_PATTERN =
  /amount|total|sales|cost|profit|value|quantity|transactions|orders|products|events|available|level|paid|balance|variance|cash|yield|loss|margin|records|counted|expected|cogs|stock|output|input/i;

function isNumericColumn(column: string): boolean {
  return NUMERIC_COLUMN_PATTERN.test(column);
}

function isStatusColumn(column: string): boolean {
  return /status/i.test(column);
}

function statusTone(value: ReportCell): {
  kind: 'success' | 'danger' | 'warning' | 'neutral';
  icon: keyof typeof Feather.glyphMap;
  iconBg: string;
  iconColor: string;
  textClass: string;
} {
  const normalized = cellText(value).toLowerCase();
  if (/failed|cancelled|canceled|voided|overdue|out of stock|flagged|denied|error/.test(normalized)) {
    return {
      kind: 'danger',
      icon: 'x',
      iconBg: 'bg-red-100',
      iconColor: '#B91C1C',
      textClass: 'text-red-700',
    };
  }
  if (/attention|open|pending|partial|low|draft|in transit/.test(normalized)) {
    return {
      kind: 'warning',
      icon: 'alert-triangle',
      iconBg: 'bg-amber-100',
      iconColor: '#D97706',
      textClass: 'text-amber-800',
    };
  }
  if (
    /completed|active|clear|closed|paid|ready|fulfilled|success|in stock|received|recorded|approved/.test(
      normalized,
    )
  ) {
    return {
      kind: 'success',
      icon: 'check',
      iconBg: 'bg-brand-100',
      iconColor: '#1A593B',
      textClass: 'text-brand-800',
    };
  }
  return {
    kind: 'neutral',
    icon: 'minus',
    iconBg: 'bg-slate-100',
    iconColor: '#64748B',
    textClass: 'text-slate-600',
  };
}

function ReportCellValue({
  value,
  column,
  primary = false,
}: {
  value: ReportCell;
  column: string;
  primary?: boolean;
}) {
  if (isStatusColumn(column)) {
    const tone = statusTone(value);
    return (
      <View className="flex-row items-center gap-1.5">
        <View className={`h-5 w-5 items-center justify-center rounded-full ${tone.iconBg}`}>
          <Feather name={tone.icon} size={12} color={tone.iconColor} />
        </View>
        <Text selectable className={`text-sm font-medium ${tone.textClass}`}>
          {cellText(value)}
        </Text>
      </View>
    );
  }

  return (
    <Text
      selectable
      numberOfLines={2}
      className={`${
        primary ? 'text-sm font-semibold text-slate-900' : 'text-sm text-slate-600'
      } leading-5`}
    >
      {cellText(value)}
    </Text>
  );
}

function CompactReportTable({ table }: { table: ReportTableDefinition }) {
  return (
    <View className="gap-2 px-3 pb-3">
      {table.rows.map((row, rowIndex) => (
        <View
          key={`${table.id}-compact-${rowIndex}`}
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
        >
          <View className="border-b border-slate-100 bg-slate-50 px-3 py-3">
            <Text className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {table.columns[0]}
            </Text>
            <ReportCellValue value={row[0]} column={table.columns[0] ?? ''} primary />
          </View>
          {table.columns.slice(1).map((column, columnOffset) => {
            const columnIndex = columnOffset + 1;
            return (
              <View
                key={`${table.id}-compact-${rowIndex}-${column}`}
                className="flex-row items-start justify-between gap-4 border-t border-slate-100 px-3 py-3"
              >
                <Text className="max-w-[44%] text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {column}
                </Text>
                <View className="max-w-[56%] items-end">
                  <ReportCellValue value={row[columnIndex]} column={column} />
                </View>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function ReportTable({ table, compact }: { table: ReportTableDefinition; compact: boolean }) {
  const minWidth = Math.max(760, table.columns.length * 156);
  const recordLabel = `${table.rows.length.toLocaleString('en-PH')} ${table.rows.length === 1 ? 'record' : 'records'}`;
  return (
    <View className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <View className="flex-row items-start justify-between gap-3 border-b border-slate-100 px-4 py-3.5">
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] font-semibold text-slate-900">{table.title}</Text>
          {table.description ? (
            <Text className="mt-1 text-xs leading-5 text-slate-500">{table.description}</Text>
          ) : null}
        </View>
        <View className="rounded-full bg-slate-100 px-2.5 py-1">
          <Text className="text-[10px] font-medium text-slate-500">{recordLabel}</Text>
        </View>
      </View>
      {table.rows.length === 0 ? (
        <View className="items-center px-4 py-10">
          <View className="mb-3 h-10 w-10 items-center justify-center rounded-full bg-slate-100">
            <Feather name="inbox" size={17} color="#94A3B8" />
          </View>
          <Text className="max-w-[360px] text-center text-sm leading-5 text-slate-500">
            {table.emptyMessage}
          </Text>
        </View>
      ) : compact ? (
        <CompactReportTable table={table} />
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          contentContainerStyle={{ flexGrow: 1 }}
        >
          <View style={{ minWidth, width: '100%' }}>
            <View className="flex-row items-center border-b border-slate-100 bg-slate-50 px-4 py-2.5">
              {table.columns.map((column, columnIndex) => (
                <View
                  key={column}
                  className={`min-w-[140px] ${columnIndex === 0 ? 'flex-[1.35]' : 'flex-1'} ${isNumericColumn(column) ? 'items-end' : ''}`}
                >
                  <Text
                    className={`text-[11px] font-semibold uppercase tracking-wide text-slate-400 ${isNumericColumn(column) ? 'text-right' : ''}`}
                  >
                    {column}
                  </Text>
                </View>
              ))}
            </View>
            {table.rows.map((row, rowIndex) => (
              <View
                key={`${table.id}-${rowIndex}`}
                className={`flex-row items-center px-4 py-3.5 ${
                  rowIndex > 0 ? 'border-t border-slate-100' : ''
                }`}
              >
                {table.columns.map((column, columnIndex) => (
                  <View
                    key={`${table.id}-${rowIndex}-${columnIndex}`}
                    className={`min-w-[140px] justify-center ${columnIndex === 0 ? 'flex-[1.35] pr-3' : 'flex-1 pr-3'} ${isNumericColumn(column) ? 'items-end' : ''}`}
                  >
                    <View className={isNumericColumn(column) ? 'items-end' : ''}>
                      <ReportCellValue
                        value={row[columnIndex]}
                        column={column}
                        primary={columnIndex === 0}
                      />
                    </View>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function ReportsTableContent({ initialSection }: { initialSection: ReportSectionId }) {
  const { width } = useWindowDimensions();
  const phone = width < 640;
  const branch = useBranchStore((state) => state.activeBranch);
  const { currentUser, session, loading: sessionLoading } = useSession();
  const { showAlert } = useIosAlert();
  const [period, setPeriod] = useState<Period>('30d');
  const [customRange, setCustomRange] = useState(() => rangeFor('30d', { from: '', to: '' }));
  const [customVisible, setCustomVisible] = useState(false);
  const [draftRange, setDraftRange] = useState(customRange);
  const [calendarSession, setCalendarSession] = useState(0);
  const [comparison, setComparison] = useState<Comparison>('none');
  const [exportVisible, setExportVisible] = useState(false);
  const [exporting, setExporting] = useState(false);

  const permissions = currentUser?.permissions ?? [];
  const modules = currentUser?.modules ?? [];
  const role = String(currentUser?.role ?? 'cashier');
  const visibleReports = useMemo(
    () =>
      REPORTS.filter((item) => {
        if (roleAccess(role, item.matrix) === 'none') return false;
        if (item.id === 'profit' && !permissions.includes('reports:view_profit')) return false;
        if (item.id === 'purchasing' && !modules.includes('purchasing')) return false;
        if (
          item.id === 'audit' &&
          (!modules.includes('audit') || !permissions.includes('audit:read'))
        )
          return false;
        if (
          item.id === 'repacking' &&
          !modules.some((module) => module === 'production' || module === 'recipes')
        )
          return false;
        return true;
      }),
    [modules, permissions, role],
  );
  const section = visibleReports.some((item) => item.id === initialSection)
    ? initialSection
    : (visibleReports[0]?.id ?? 'overview');
  const dateRange = useMemo(() => rangeFor(period, customRange), [customRange, period]);
  const previousDateRange = useMemo(
    () => comparisonRange(dateRange, comparison),
    [comparison, dateRange],
  );
  const enabled = !sessionLoading && Boolean(session?.access_token) && Boolean(branch?.id);
  const path = branch?.id
    ? `/reports/workspace?from=${encodeURIComponent(dateRange.from)}&to=${encodeURIComponent(dateRange.to)}&branchId=${branch.id}`
    : '';

  const query = useQuery({
    queryKey: ['table-report', branch?.id, dateRange.from, dateRange.to, session?.user.id],
    enabled,
    queryFn: () => api<ReportsWorkspace>(path),
    refetchInterval: section === 'purchasing' ? 300_000 : section === 'profit' ? false : 60_000,
  });
  const previousQuery = useQuery({
    queryKey: [
      'table-report-comparison',
      branch?.id,
      previousDateRange?.from,
      previousDateRange?.to,
      session?.user.id,
    ],
    enabled: enabled && Boolean(previousDateRange),
    queryFn: () =>
      api<ReportsWorkspace>(
        `/reports/workspace?from=${encodeURIComponent(previousDateRange!.from)}&to=${encodeURIComponent(previousDateRange!.to)}&branchId=${branch!.id}`,
      ),
    staleTime: 60_000,
  });
  const document = query.data ? buildReportDocument(query.data, section, previousQuery.data) : null;
  const metadata = {
    organizationName: currentUser?.organization.name ?? 'Ximo POS',
    branchName: branch?.name ?? 'Current branch',
    rangeLabel: displayRange(dateRange),
    from: query.data?.range?.from ?? isoRange(dateRange).from,
    to: query.data?.range?.to ?? isoRange(dateRange).to,
    generatedAt: new Date(),
  };

  const exportReport = async (format: ReportExportFormat) => {
    if (!query.data || !document || exporting) return;
    if (reportDocumentRowCount(document) > 10_000) {
      showAlert({
        type: 'info',
        title: 'Export queued',
        message: 'This report is larger than 10,000 rows. You will be notified when it is ready.',
      });
      setExportVisible(false);
      return;
    }
    setExporting(true);
    try {
      const output =
        format === 'csv'
          ? buildReportsCsv(query.data, metadata, section)
          : format === 'xlsx'
            ? buildReportsExcel(query.data, metadata, section)
            : await buildReportsPdf(query.data, metadata, section);
      await saveReportExport(output.bytes, output.fileName, format);
      setExportVisible(false);
      showAlert({ type: 'success', title: 'Report exported', message: output.fileName });
    } catch (error) {
      showAlert({
        type: 'error',
        title: 'Export failed',
        message: error instanceof Error ? error.message : 'The report could not be exported.',
      });
    } finally {
      setExporting(false);
    }
  };

  const errorMessage =
    query.error instanceof ApiError
      ? query.error.message
      : query.error instanceof Error
        ? query.error.message
        : 'The report could not be loaded.';

  return (
    <Screen>
      <Header
        title="Reports"
        subtitle={branch?.name ?? 'Select a branch'}
        showBack={!phone}
        backLabel="More"
        fallbackHref="/(tabs)/more"
      />
      <ScrollView className="flex-1" contentContainerClassName="px-3 py-4 md:px-5 md:py-5 pb-12">
        <View className="w-full max-w-[1240px] self-center gap-4">
          <View className="flex-row flex-wrap items-start justify-between gap-3">
            <View className="min-w-[220px] flex-1">
              <Text className="text-2xl font-semibold text-slate-900">
                {document?.title ??
                  visibleReports.find((item) => item.id === section)?.label ??
                  'Report'}
              </Text>
              <Text className="mt-1 text-sm leading-5 text-slate-500">
                {document?.purpose ?? `Branch report for ${branch?.name ?? 'the selected branch'}.`}
              </Text>
              <Text className="mt-1 text-xs text-slate-400">
                {displayRange(dateRange)} · {branch?.name ?? 'Current branch'}
              </Text>
            </View>
            <View className="flex-row gap-2">
              <Pressable
                accessibilityRole="button"
                onPress={() => void query.refetch()}
                className="h-10 flex-row items-center rounded-xl border border-slate-200 bg-white px-3"
              >
                <Feather name="refresh-cw" size={14} color="#1A593B" />
                <Text className="ml-2 text-xs font-medium text-slate-700">Refresh</Text>
              </Pressable>
              {permissions.includes('reports:export') ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={!query.data}
                  onPress={() => setExportVisible(true)}
                  className="h-10 flex-row items-center rounded-xl bg-brand-700 px-3 disabled:opacity-40"
                >
                  <Feather name="download" size={14} color="#FFFFFF" />
                  <Text className="ml-2 text-xs font-medium text-white">Export</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          <View className="rounded-2xl border border-slate-200 bg-white p-2">
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row gap-1">
                {visibleReports.map((item) => {
                  const selected = item.id === section;
                  return (
                    <Pressable
                      key={item.id}
                      accessibilityRole="tab"
                      accessibilityState={{ selected }}
                      onPress={() => router.replace(`/reports/${item.id}` as never)}
                      className={`min-h-10 flex-row items-center rounded-xl px-3 ${selected ? 'bg-brand-700' : 'bg-white'}`}
                    >
                      <Feather
                        name={item.icon}
                        size={14}
                        color={selected ? '#FFFFFF' : '#64748B'}
                      />
                      <Text
                        className={`ml-2 text-xs font-medium ${selected ? 'text-white' : 'text-slate-600'}`}
                      >
                        {item.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          </View>

          <View className="rounded-2xl border border-slate-200 bg-white p-2">
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row items-center gap-1">
                {(
                  [
                    ['today', 'Today'],
                    ['yesterday', 'Yesterday'],
                    ['7d', 'Last 7 days'],
                    ['30d', 'Last 30 days'],
                  ] as Array<[Period, string]>
                ).map(([id, label]) => (
                  <Pressable
                    key={id}
                    onPress={() => setPeriod(id)}
                    className={`min-h-9 justify-center rounded-lg px-3 ${period === id ? 'bg-[#E8F5EE]' : 'bg-white'}`}
                  >
                    <Text
                      className={`text-xs font-medium ${period === id ? 'text-brand-800' : 'text-slate-500'}`}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
                <Pressable
                  onPress={() => {
                    setDraftRange(customRange);
                    setCalendarSession((value) => value + 1);
                    setCustomVisible(true);
                  }}
                  className={`min-h-9 flex-row items-center justify-center rounded-lg px-3 ${period === 'custom' ? 'bg-[#E8F5EE]' : 'bg-white'}`}
                >
                  <Feather name="calendar" size={13} color="#1A593B" />
                  <Text className="ml-2 text-xs font-medium text-slate-600">Custom</Text>
                </Pressable>
                <View className="mx-2 h-6 w-px bg-slate-200" />
                <Text className="px-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Compare
                </Text>
                {(
                  [
                    ['none', 'Off'],
                    ['previous_period', 'Previous period'],
                    ['previous_month', 'Previous month'],
                    ['previous_year', 'Previous year'],
                  ] as Array<[Comparison, string]>
                ).map(([id, label]) => (
                  <Pressable
                    key={id}
                    onPress={() => setComparison(id)}
                    className={`min-h-9 justify-center rounded-lg px-3 ${comparison === id ? 'bg-[#E8F5EE]' : 'bg-white'}`}
                  >
                    <Text
                      className={`text-xs font-medium ${comparison === id ? 'text-brand-800' : 'text-slate-500'}`}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </View>

          {query.data ? (
            <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-slate-50 px-3 py-2">
              <Text className="text-[11px] text-slate-500">
                Status: {query.isFetching ? 'Refreshing' : (query.data.metadata?.status ?? 'Ready')}
              </Text>
              <Text className="text-[11px] text-slate-500">
                Last updated:{' '}
                {new Date(query.data.metadata?.generatedAt ?? query.dataUpdatedAt).toLocaleString(
                  'en-PH',
                )}
              </Text>
              <Text className="text-[11px] text-slate-500">
                Timezone:{' '}
                {query.data.metadata?.timezone ??
                  currentUser?.organization.timezone ??
                  'Asia/Manila'}
              </Text>
              <Text className="text-[11px] text-slate-500">
                Currency:{' '}
                {query.data.metadata?.currency ?? currentUser?.organization.currency ?? 'PHP'}
              </Text>
            </View>
          ) : null}

          {!branch ? (
            <View className="min-h-72 rounded-2xl bg-white">
              <ErrorState
                message="Select a branch before opening reports."
                retry={() => router.push('/branches' as never)}
              />
            </View>
          ) : query.isLoading ? (
            <View className="min-h-72 rounded-2xl bg-white">
              <LoadingState label="Preparing report…" />
            </View>
          ) : query.isError ? (
            <View className="min-h-72 rounded-2xl bg-white">
              <ErrorState message={errorMessage} retry={() => void query.refetch()} />
            </View>
          ) : document ? (
            <View className="gap-4">
              {document.tables.map((table) => (
                <ReportTable key={table.id} table={table} compact={phone} />
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>

      <Modal
        visible={customVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCustomVisible(false)}
      >
        <View className="flex-1 items-center justify-center bg-black/40 p-3 md:p-6">
          <Pressable className="absolute inset-0" onPress={() => setCustomVisible(false)} />
          <View className="max-h-[92%] w-full max-w-[440px] overflow-hidden rounded-2xl bg-white">
            <ScrollView
              contentContainerClassName="p-4 md:p-5"
              showsVerticalScrollIndicator={false}
            >
              <View className="flex-row items-start justify-between gap-3">
                <View className="min-w-0 flex-1">
                  <Text className="text-lg font-semibold text-slate-900">Select date range</Text>
                  <Text className="mt-1 text-xs leading-5 text-slate-500">
                    Tap a start date, then tap an end date. The range uses the store timezone.
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close calendar"
                  onPress={() => setCustomVisible(false)}
                  className="h-9 w-9 items-center justify-center rounded-full bg-slate-100"
                >
                  <Feather name="x" size={16} color="#64748B" />
                </Pressable>
              </View>

              <View className="mt-5">
                <DateRangeCalendar
                  key={calendarSession}
                  from={draftRange.from}
                  to={draftRange.to}
                  onChange={setDraftRange}
                />
              </View>

              <View className="mt-5 flex-row gap-2">
                <View className="flex-1">
                  <Button
                    title="Cancel"
                    variant="secondary"
                    onPress={() => setCustomVisible(false)}
                  />
                </View>
                <View className="flex-1">
                  <Button
                    title="Apply range"
                    onPress={() => {
                      if (
                        !/^\d{4}-\d{2}-\d{2}$/.test(draftRange.from) ||
                        !/^\d{4}-\d{2}-\d{2}$/.test(draftRange.to) ||
                        draftRange.from > draftRange.to
                      ) {
                        showAlert({
                          type: 'warning',
                          title: 'Invalid date range',
                          message: 'Select a valid start and end date from the calendar.',
                        });
                        return;
                      }
                      setCustomRange(draftRange);
                      setPeriod('custom');
                      setCustomVisible(false);
                    }}
                  />
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={exportVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setExportVisible(false)}
      >
        <View className="flex-1 items-center justify-center bg-black/40 p-4">
          <Pressable className="absolute inset-0" onPress={() => setExportVisible(false)} />
          <View className="w-full max-w-[400px] rounded-2xl bg-white p-5">
            <Text className="text-lg font-semibold text-slate-900">Export this report</Text>
            <Text className="mt-1 text-xs leading-5 text-slate-500">
              Only {document?.title ?? 'the current report'} will be exported for{' '}
              {displayRange(dateRange)}.
            </Text>
            <View className="mt-4 gap-2">
              {(['csv', 'xlsx', 'pdf'] as ReportExportFormat[]).map((format) => (
                <Pressable
                  key={format}
                  disabled={exporting}
                  onPress={() => void exportReport(format)}
                  className="min-h-12 flex-row items-center rounded-xl border border-slate-200 px-4"
                >
                  <Feather name="file-text" size={16} color="#1A593B" />
                  <Text className="ml-3 flex-1 text-sm font-medium text-slate-800">
                    {format === 'csv'
                      ? 'CSV data'
                      : format === 'xlsx'
                        ? 'Excel workbook'
                        : 'PDF document'}
                  </Text>
                  <Text className="text-xs font-semibold uppercase text-brand-700">{format}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

export function ReportsTableWorkspaceScreen({
  initialSection = 'overview',
}: {
  initialSection?: ReportSectionId;
}) {
  return (
    <AppSidebarProvider>
      <ReportsTableContent initialSection={initialSection} />
    </AppSidebarProvider>
  );
}
