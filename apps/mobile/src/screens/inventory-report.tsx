import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { router } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { useQuery } from '@tanstack/react-query';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { DateRangeCalendar } from '@/components/date-range-calendar';
import { Button, ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import type { InventoryReportResponse } from '@/lib/report-types';
import { useSession } from '@/providers/session';
import { useBranchStore } from '@/store/branch';

type ReportPeriod = 'today' | 'yesterday' | '7d' | '30d' | 'custom';
type InventoryStockStatus = 'all' | 'in_stock' | 'low_stock' | 'out_of_stock';

function localDateInput(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function dateAtLocalMidnight(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

function isValidDateInput(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = dateAtLocalMidnight(value);
  return !Number.isNaN(date.getTime()) && localDateInput(date) === value;
}

function readableDateRange(fromIso: string, toIso: string): string {
  const from = new Date(fromIso);
  const toExclusive = new Date(toIso);
  toExclusive.setUTCDate(toExclusive.getUTCDate() - 1);
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const start = fmt(from);
  const end = fmt(toExclusive);
  return start === end ? start : `${start} – ${end}`;
}

const PERIOD_PRESETS: Array<{
  key: ReportPeriod;
  label: string;
  getRange: () => { from: string; to: string };
}> = [
  {
    key: 'today',
    label: 'Today',
    getRange: () => {
      const d = localDateInput(new Date());
      return { from: d, to: d };
    },
  },
  {
    key: 'yesterday',
    label: 'Yesterday',
    getRange: () => {
      const prev = new Date();
      prev.setDate(prev.getDate() - 1);
      const d = localDateInput(prev);
      return { from: d, to: d };
    },
  },
  {
    key: '7d',
    label: 'Last 7 days',
    getRange: () => {
      const to = new Date();
      const from = new Date(to);
      from.setDate(from.getDate() - 6);
      return { from: localDateInput(from), to: localDateInput(to) };
    },
  },
  {
    key: '30d',
    label: 'Last 30 days',
    getRange: () => {
      const to = new Date();
      const from = new Date(to);
      from.setDate(from.getDate() - 29);
      return { from: localDateInput(from), to: localDateInput(to) };
    },
  },
];

function formatInventoryQty(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(3)));
}

function inventoryMovementTypeLabel(type: string): string {
  return type.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function inventoryStockStatus(quantity: number, isLowStock: boolean): {
  label: string;
  tone: string;
} {
  if (quantity <= 0) return { label: 'Out of stock', tone: 'bg-red-50 text-red-700' };
  if (isLowStock) return { label: 'Low stock', tone: 'bg-amber-50 text-amber-700' };
  return { label: 'In stock', tone: 'bg-brand-50 text-brand-700' };
}

function inventoryStockStatusKey(
  quantity: number,
  isLowStock: boolean,
): Exclude<InventoryStockStatus, 'all'> {
  if (quantity <= 0) return 'out_of_stock';
  if (isLowStock) return 'low_stock';
  return 'in_stock';
}

function ReportFilterChips({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <View className="mb-3 gap-2">
      <Text className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="flex-row gap-2 pr-2">
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => onChange(option.value)}
                className={`min-h-9 justify-center rounded-lg border px-3 ${
                  selected
                    ? 'border-brand-700 bg-brand-700'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <Text
                  className={`text-xs font-medium ${selected ? 'text-white' : 'text-slate-600'}`}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function ReportCard({
  title,
  subtitle,
  children,
  action,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <View className="rounded-2xl border border-slate-100 bg-white p-5">
      <View className="mb-4 flex-row items-center justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] font-semibold text-slate-900">{title}</Text>
          {subtitle ? (
            <Text className="mt-0.5 text-xs text-slate-500" numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {action ?? null}
      </View>
      {children}
    </View>
  );
}

function TableEmpty({ message }: { message: string }) {
  return <Text className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">{message}</Text>;
}

function InventoryReportTables({
  report,
  performedBy,
  onPerformedByChange,
}: {
  report: InventoryReportResponse;
  performedBy: string;
  onPerformedByChange: (value: string) => void;
}) {
  const [stockStatus, setStockStatus] = useState<InventoryStockStatus>('all');
  const filteredStock = useMemo(
    () =>
      stockStatus === 'all'
        ? report.stock
        : report.stock.filter(
            (item) => inventoryStockStatusKey(item.quantity, item.isLowStock) === stockStatus,
          ),
    [report.stock, stockStatus],
  );
  const performerOptions = useMemo(() => {
    return [
      { label: 'All staff', value: 'all' },
      ...(report.performers ?? []).map((performer) => ({
        label: performer.name,
        value: performer.id,
      })),
    ];
  }, [report.performers]);
  const selectedPerformer = performerOptions.find((option) => option.value === performedBy);

  return (
    <View className="gap-4">
      <ReportCard
        title="Current stock"
        subtitle={`${filteredStock.length} of ${report.stock.length} tracked products shown.`}
        action={
          <Pressable
            onPress={() => router.push('/(tabs)/inventory')}
            className="min-h-10 flex-row items-center rounded-xl bg-brand-50 px-3"
          >
            <Text className="text-xs font-medium text-brand-700">Open inventory</Text>
            <Feather name="chevron-right" size={14} color="#1A593B" />
          </Pressable>
        }
      >
        <ReportFilterChips
          label="Status"
          value={stockStatus}
          options={[
            { label: 'All', value: 'all' },
            { label: 'In stock', value: 'in_stock' },
            { label: 'Low stock', value: 'low_stock' },
            { label: 'Out of stock', value: 'out_of_stock' },
          ]}
          onChange={(value) => setStockStatus(value as InventoryStockStatus)}
        />
        {filteredStock.length === 0 ? (
          <TableEmpty
            message={
              report.stock.length === 0
                ? 'No tracked inventory for this branch.'
                : 'No products match the selected status.'
            }
          />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="min-w-[820px] w-full overflow-hidden rounded-xl border border-slate-200">
              <View className="flex-row items-center border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                <Text className="w-[190px] text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Product
                </Text>
                <Text className="w-[78px] text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Role
                </Text>
                <Text className="w-[72px] text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Qty
                </Text>
                <Text className="w-[70px] text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Sealed
                </Text>
                <Text className="w-[70px] text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Opened
                </Text>
                <Text className="w-[58px] text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Unit
                </Text>
                <Text className="w-[100px] text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Status
                </Text>
                <Text className="w-[96px] text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Value
                </Text>
              </View>
              {filteredStock.map((item, index) => {
                const status = inventoryStockStatus(item.quantity, item.isLowStock);
                return (
                  <View
                    key={item.id}
                    className={`flex-row items-start px-4 py-3 ${
                      index ? 'border-t border-slate-100' : ''
                    }`}
                  >
                    <View className="w-[190px] pr-3">
                      <Text className="text-sm font-medium text-slate-900">{item.productName}</Text>
                      <Text className="mt-0.5 text-xs text-slate-500">
                        {item.sku}
                        {item.branchName ? ` · ${item.branchName}` : ''}
                      </Text>
                      {item.conversionHint ? (
                        <Text className="mt-1 text-xs text-slate-500">{item.conversionHint}</Text>
                      ) : null}
                    </View>
                    <Text className="w-[78px] text-sm capitalize text-slate-600">
                      {item.inventoryRole}
                    </Text>
                    <Text className="w-[72px] text-right text-sm font-medium text-slate-900">
                      {formatInventoryQty(item.quantity)}
                    </Text>
                    <Text className="w-[70px] text-right text-sm text-slate-600">
                      {formatInventoryQty(item.sealedQuantity)}
                    </Text>
                    <Text className="w-[70px] text-right text-sm text-slate-600">
                      {formatInventoryQty(item.openedQuantity)}
                    </Text>
                    <Text className="w-[58px] text-sm text-slate-600">{item.unit}</Text>
                    <View className="w-[100px]">
                      <Text
                        className={`self-start rounded-md px-2 py-0.5 text-[11px] font-medium ${status.tone}`}
                      >
                        {status.label}
                      </Text>
                    </View>
                    <Text className="w-[96px] text-right text-sm font-medium text-slate-800">
                      {item.inventoryValue == null ? '—' : formatMoney(item.inventoryValue)}
                    </Text>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        )}
      </ReportCard>

      <ReportCard
        title="Unit conversions"
        subtitle="Selling and pack rules relative to each product’s base unit."
      >
        {report.conversions.length === 0 ? (
          <TableEmpty message="No alternate selling units configured." />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="min-w-[760px] w-full overflow-hidden rounded-xl border border-slate-200">
              <View className="flex-row items-center border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                <Text className="min-w-0 flex-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Product
                </Text>
                <Text className="min-w-0 flex-[1.2] text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Conversion rule
                </Text>
                <Text className="w-[110px] text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Portioning
                </Text>
              </View>
              {report.conversions.map((item, index) => (
                <View
                  key={item.id}
                  className={`flex-row items-center px-4 py-3 ${
                    index ? 'border-t border-slate-100' : ''
                  }`}
                >
                  <View className="min-w-0 flex-1 pr-3">
                    <Text className="text-sm font-medium text-slate-900">{item.productName}</Text>
                    <Text className="mt-0.5 text-xs text-slate-500">
                      {item.sku} · {item.sellingUnitName}
                    </Text>
                  </View>
                  <Text className="min-w-0 flex-[1.2] pr-3 text-sm font-medium text-slate-800">
                    {item.ruleLabel}
                  </Text>
                  <Text className="w-[110px] text-sm text-slate-600">
                    {item.isPortioningContainer ? 'Yes' : 'No'}
                  </Text>
                </View>
              ))}
            </View>
          </ScrollView>
        )}
      </ReportCard>

      <ReportCard
        title="Inventory movements"
        subtitle={
          performedBy === 'all'
            ? report.movementsTotal > report.movements.length
              ? `Showing ${report.movements.length} of ${report.movementsTotal} movements in this period.`
              : `${report.movementsTotal} movements in this period.`
            : `${report.movementsTotal} movements performed by ${
                selectedPerformer?.label ?? 'the selected staff member'
              }.`
        }
      >
        <ReportFilterChips
          label="Performed by"
          value={performedBy}
          options={performerOptions}
          onChange={onPerformedByChange}
        />
        {report.movements.length === 0 ? (
          <TableEmpty
            message={
              performedBy === 'all'
                ? 'No inventory movements in this period.'
                : 'No movements match the selected staff member.'
            }
          />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="min-w-[1040px] w-full overflow-hidden rounded-xl border border-slate-200">
              <View className="flex-row items-center border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                <Text className="w-[126px] text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  When
                </Text>
                <Text className="w-[160px] text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Product
                </Text>
                <Text className="w-[108px] text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Type
                </Text>
                <Text className="w-[78px] text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Qty
                </Text>
                <Text className="w-[54px] text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Unit
                </Text>
                <Text className="w-[142px] text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Conversion
                </Text>
                <Text className="w-[78px] text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Balance
                </Text>
                <Text className="w-[146px] text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Reason
                </Text>
                <Text className="w-[116px] text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Performed by
                </Text>
              </View>
              {report.movements.map((item, index) => (
                <View
                  key={item.id}
                  className={`flex-row items-start px-4 py-3 ${
                    index ? 'border-t border-slate-100' : ''
                  }`}
                >
                  <Text className="w-[126px] pr-2 text-sm text-slate-500">
                    {formatDate(item.createdAt)}
                  </Text>
                  <View className="w-[160px] pr-3">
                    <Text className="text-sm font-medium text-slate-900">{item.productName}</Text>
                    <Text className="mt-0.5 text-xs text-slate-500">{item.sku}</Text>
                  </View>
                  <Text className="w-[108px] pr-2 text-sm text-slate-700">
                    {inventoryMovementTypeLabel(item.type)}
                  </Text>
                  <Text
                    className={`w-[78px] text-right text-sm font-medium ${
                      item.quantityDelta < 0 ? 'text-red-700' : 'text-brand-800'
                    }`}
                  >
                    {item.quantityDelta > 0 ? '+' : ''}
                    {formatInventoryQty(item.quantityDelta)}
                  </Text>
                  <Text className="w-[54px] pl-2 text-sm text-slate-600">{item.unit}</Text>
                  <Text className="w-[142px] px-3 text-sm text-slate-600">
                    {item.conversionLabel ?? '—'}
                  </Text>
                  <Text className="w-[78px] text-right text-sm text-slate-800">
                    {formatInventoryQty(item.quantityAfter)}
                  </Text>
                  <View className="w-[146px] pl-3">
                    <Text className="text-sm text-slate-700" numberOfLines={2}>
                      {item.reason}
                    </Text>
                  </View>
                  <View className="w-[116px] pl-3">
                    <Text className="text-sm text-slate-700" numberOfLines={1}>
                      {item.createdBy ?? 'System'}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
        )}
      </ReportCard>
    </View>
  );
}

function InventoryReportContent() {
  const { width } = useWindowDimensions();
  const phone = width < 640;
  const { session, loading: sessionLoading } = useSession();
  const branch = useBranchStore((state) => state.activeBranch);
  const defaultCustomRange = useMemo(() => {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 29);
    return { from: localDateInput(from), to: localDateInput(to) };
  }, []);
  const [period, setPeriod] = useState<ReportPeriod>('30d');
  const [customRange, setCustomRange] = useState(defaultCustomRange);
  const [dateRangeVisible, setDateRangeVisible] = useState(false);
  const [calendarSession, setCalendarSession] = useState(0);
  const [draftFrom, setDraftFrom] = useState(defaultCustomRange.from);
  const [draftTo, setDraftTo] = useState(defaultCustomRange.to);
  const [dateRangeError, setDateRangeError] = useState('');
  const [performedBy, setPerformedBy] = useState('all');

  const range = useMemo(() => {
    if (period === 'custom') {
      const from = dateAtLocalMidnight(customRange.from);
      const to = dateAtLocalMidnight(customRange.to);
      to.setDate(to.getDate() + 1);
      return { from: from.toISOString(), to: to.toISOString() };
    }
    const preset = PERIOD_PRESETS.find((p) => p.key === period);
    const r = preset ? preset.getRange() : PERIOD_PRESETS[3]!.getRange();
    const from = dateAtLocalMidnight(r.from);
    const to = dateAtLocalMidnight(r.to);
    to.setDate(to.getDate() + 1);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [customRange.from, customRange.to, period]);

  const rangeLabel = useMemo(() => readableDateRange(range.from, range.to), [range.from, range.to]);

  useEffect(() => {
    setPerformedBy('all');
  }, [branch?.id, range.from, range.to]);

  const query = useQuery({
    queryKey: [
      'inventory-report-page',
      branch?.id,
      range.from,
      range.to,
      performedBy,
      session?.user?.id,
    ],
    enabled: !sessionLoading && Boolean(session?.access_token),
    queryFn: () => {
      const fromDate = range.from.slice(0, 10);
      const exclusiveEnd = new Date(range.to);
      exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() - 1);
      const toDate = exclusiveEnd.toISOString().slice(0, 10);
      return api<InventoryReportResponse>(
        `/reports/inventory?from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}${
          branch?.id ? `&branchId=${branch.id}` : ''
        }${performedBy !== 'all' ? `&performedById=${encodeURIComponent(performedBy)}` : ''}&pageSize=100`,
      );
    },
  });

  return (
    <Screen>
      <Header
        title="Inventory"
        subtitle={`${rangeLabel} · ${branch?.name ?? 'All accessible branches'}`}
        showBack={!phone}
        backLabel="More"
        fallbackHref="/(tabs)/more"
      />
      <ScrollView
        className="flex-1"
        contentContainerClassName={`pb-12 ${phone ? 'px-3 pt-3' : 'px-5 pt-5'}`}
        contentContainerStyle={{
          flexGrow: 1,
          alignItems: 'center',
          width: '100%',
          maxWidth: 1280,
          alignSelf: 'center',
        }}
      >
        <View className="w-full max-w-6xl gap-4">
          <View className="flex-row flex-wrap items-end justify-between gap-3">
            <View className="min-w-[220px] flex-1">
              <Text className="text-2xl font-semibold text-slate-900">Inventory report</Text>
              <Text className="mt-1 text-sm text-slate-500">
                Current stock, unit conversions, and movements for {rangeLabel}
                {branch?.name ? ` · ${branch.name}` : ''}.
              </Text>
            </View>
            <View className="flex-row flex-wrap items-center gap-2">
              {PERIOD_PRESETS.map((item) => {
                const selected = item.key === period;
                return (
                  <Pressable
                    key={item.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setPeriod(item.key)}
                    className={`min-h-10 items-center justify-center rounded-xl px-3.5 ${
                      selected ? 'bg-brand-700' : 'border border-slate-200 bg-white'
                    }`}
                  >
                    <Text
                      className={`text-[13px] font-medium ${
                        selected ? 'text-white' : 'text-slate-600'
                      }`}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open calendar date range"
                onPress={() => {
                  const active =
                    period === 'custom'
                      ? customRange
                      : PERIOD_PRESETS.find((p) => p.key === period)?.getRange() ?? customRange;
                  setDraftFrom(active.from);
                  setDraftTo(active.to);
                  setDateRangeError('');
                  setCalendarSession((value) => value + 1);
                  setDateRangeVisible(true);
                }}
                className={`min-h-10 flex-row items-center rounded-xl px-3.5 ${
                  period === 'custom' ? 'bg-slate-900' : 'border border-slate-200 bg-white'
                }`}
              >
                <Feather
                  name="calendar"
                  size={15}
                  color={period === 'custom' ? '#FFFFFF' : '#1A593B'}
                />
                <Text
                  className={`ml-2 text-[13px] font-medium ${
                    period === 'custom' ? 'text-white' : 'text-slate-700'
                  }`}
                  numberOfLines={1}
                >
                  {period === 'custom' ? rangeLabel : 'Custom'}
                </Text>
              </Pressable>
            </View>
          </View>

          {query.isLoading ? (
            <View className="min-h-96 rounded-2xl bg-white">
              <LoadingState label="Loading inventory report…" />
            </View>
          ) : query.isError ? (
            <View className="min-h-96 rounded-2xl bg-white">
              <ErrorState message={query.error.message} retry={() => void query.refetch()} />
            </View>
          ) : query.data ? (
            <InventoryReportTables
              report={query.data}
              performedBy={performedBy}
              onPerformedByChange={setPerformedBy}
            />
          ) : null}
        </View>
      </ScrollView>

      <Modal
        visible={dateRangeVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDateRangeVisible(false)}
      >
        <Pressable
          className="flex-1 items-center justify-center bg-black/40 px-4"
          onPress={() => setDateRangeVisible(false)}
        >
          <Pressable
            className="w-full max-w-md rounded-2xl bg-white p-5"
            onPress={(event) => event.stopPropagation()}
          >
            <Text className="text-lg font-semibold text-slate-900">Custom date range</Text>
            <Text className="mt-1 text-sm text-slate-500">
              Choose the period for inventory movements.
            </Text>
            <View className="mt-4">
              <DateRangeCalendar
                key={calendarSession}
                from={draftFrom}
                to={draftTo}
                onChange={(next) => {
                  setDraftFrom(next.from);
                  setDraftTo(next.to);
                  setDateRangeError('');
                }}
              />
            </View>
            {dateRangeError ? (
              <Text className="mt-3 text-sm text-red-600">{dateRangeError}</Text>
            ) : null}
            <View className="mt-5 flex-row gap-2">
              <View className="flex-1">
                <Button title="Cancel" variant="secondary" onPress={() => setDateRangeVisible(false)} />
              </View>
              <View className="flex-1">
                <Button
                  title="Apply"
                  onPress={() => {
                    if (!isValidDateInput(draftFrom) || !isValidDateInput(draftTo)) {
                      setDateRangeError('Enter valid dates.');
                      return;
                    }
                    if (draftFrom > draftTo) {
                      setDateRangeError('Start date must be on or before end date.');
                      return;
                    }
                    setCustomRange({ from: draftFrom, to: draftTo });
                    setPeriod('custom');
                    setDateRangeVisible(false);
                  }}
                />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

export function InventoryReportScreen() {
  return (
    <AppSidebarProvider>
      <InventoryReportContent />
    </AppSidebarProvider>
  );
}
