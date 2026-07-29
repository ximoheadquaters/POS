import { useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { useQuery } from '@tanstack/react-query';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { Button, ErrorState, Field, Header, LoadingState, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { useBranchStore } from '@/store/branch';

type ReportSection = 'overview' | 'sales' | 'inventory' | 'purchasing' | 'profit' | 'cash';
type ReportPeriod = 'today' | '7d' | '30d' | 'all' | 'custom';

interface ReportsWorkspace {
  kpis: {
    grossSales: string;
    netSales: string;
    customerRefunds: string;
    discounts: string;
    taxes: string;
    transactions: number;
    uniqueCustomers: number;
    averageTransaction: string;
    itemsSold: number;
    netCost: string;
    grossProfit: string;
    grossMarginPercent: string;
    refundRatePercent: string;
  };
  sales: {
    paymentMethods: Array<{ method: string; total: string; transactions: number }>;
    topProducts: Array<{
      name: string;
      sku: string;
      unit: string;
      quantity: number;
      sales: string;
      cost: string;
      profit: string;
    }>;
    topCategories: Array<{ name: string; sales: string; quantity: number }>;
    branches: Array<{ id: string; name: string; sales: string; transactions: number }>;
    trend: Array<{ date: string; sales: string; transactions: number }>;
  };
  inventory: {
    stockRecords: number;
    activeProducts: number;
    unitsOnHand: number;
    inventoryValue: string;
    stockValue: string;
    lowStockCount: number;
    outOfStockCount: number;
    lowStock: Array<{
      id: string;
      name: string;
      sku: string;
      unit: string;
      branchName: string;
      quantity: number;
      lowStockLevel: number;
      inventoryValue: string;
    }>;
    byCategory: Array<{ name: string; value: string; quantity: number; products: number }>;
    movements: Array<{ type: string; movements: number; quantity: number }>;
  };
  purchasing: {
    purchaseOrders: number;
    openOrders: number;
    orderedValue: string;
    receivedValue: string;
    supplierReturns: string;
    outstandingPayables: string;
    supplierPayments: string;
    supplierRefunds: string;
    orderStatuses: Array<{ status: string; orders: number; value: string }>;
    topSuppliers: Array<{ id: string; name: string; orders: number; value: string }>;
  };
  profit: {
    grossSales: string;
    refunds: string;
    netSales: string;
    netCost: string;
    grossProfit: string;
    grossMarginPercent: string;
    trend: Array<{ date: string; netSales: string; netCost: string; profit: string }>;
  };
  cash: {
    shifts: number;
    openShifts: number;
    cashSales: string;
    cashRefunds: string;
    countedCash: string;
    variance: string;
    cashIn: string;
    cashOut: string;
  };
}

const PERIODS = [
  { key: 'today', label: 'Today', days: 1 },
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: 'all', label: 'All time', days: null },
] as const;

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

function readableDateRange(from: string, to: string): string {
  const start = new Date(from);
  const inclusiveEnd = new Date(new Date(to).getTime() - 1);
  return `${start.toLocaleDateString()} – ${inclusiveEnd.toLocaleDateString()}`;
}

const SECTIONS: Array<{
  key: ReportSection;
  label: string;
  icon: ComponentProps<typeof Feather>['name'];
}> = [
  { key: 'overview', label: 'KPIs', icon: 'grid' },
  { key: 'sales', label: 'Sales', icon: 'shopping-cart' },
  { key: 'inventory', label: 'Inventory', icon: 'package' },
  { key: 'purchasing', label: 'Purchasing', icon: 'truck' },
  { key: 'profit', label: 'Profit', icon: 'trending-up' },
  { key: 'cash', label: 'Cash & shifts', icon: 'monitor' },
];

function MetricCard({
  label,
  value,
  note,
  icon,
  tone = 'brand',
}: {
  label: string;
  value: string;
  note?: string;
  icon: ComponentProps<typeof Feather>['name'];
  tone?: 'brand' | 'amber' | 'red' | 'blue';
}) {
  const { width } = useWindowDimensions();
  const phone = width < 640;
  const palette = {
    brand: ['bg-brand-50', '#1A593B'],
    amber: ['bg-amber-50', '#B45309'],
    red: ['bg-red-50', '#B42318'],
    blue: ['bg-blue-50', '#2563EB'],
  }[tone];
  return (
    <View
      className="rounded-2xl border border-slate-200 bg-white p-4"
      style={
        phone
          ? { width: '100%', minWidth: '100%', flexBasis: '100%' }
          : { minWidth: 160, flexBasis: 160, flexGrow: 1 }
      }
    >
      <View className={`mb-3 h-10 w-10 items-center justify-center rounded-xl ${palette[0]}`}>
        <Feather name={icon} size={18} color={palette[1]} />
      </View>
      <Text className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</Text>
      <Text className="mt-1 text-xl font-semibold text-slate-950">{value}</Text>
      {note ? <Text className="mt-1 text-xs leading-4 text-slate-500">{note}</Text> : null}
    </View>
  );
}

function ResponsivePanel({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  const stacked = width < 760;
  return (
    <View
      style={
        stacked
          ? { width: '100%', flexBasis: '100%' }
          : { minWidth: 360, flexBasis: 0, flexGrow: 1 }
      }
    >
      {children}
    </View>
  );
}

function ReportCard({
  title,
  subtitle,
  children,
  action,
  icon,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
  icon?: ComponentProps<typeof Feather>['name'];
}) {
  return (
    <View className="rounded-2xl border border-slate-200 bg-white p-5">
      <View className="mb-4 flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="text-base font-semibold text-slate-900">{title}</Text>
          {subtitle ? (
            <Text className="mt-1 text-xs leading-4 text-slate-500">{subtitle}</Text>
          ) : null}
        </View>
        {action ??
          (icon ? (
            <View className="h-9 w-9 items-center justify-center rounded-xl bg-slate-50">
              <Feather name={icon} size={16} color="#81776E" />
            </View>
          ) : null)}
      </View>
      {children}
    </View>
  );
}

function BarRows({
  rows,
  emptyLabel = 'No activity for this period.',
}: {
  rows: Array<{ key: string; label: string; value: number; display: string; note?: string }>;
  emptyLabel?: string;
}) {
  const maximum = Math.max(...rows.map((row) => Math.abs(row.value)), 1);
  if (!rows.length) {
    return <Text className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">{emptyLabel}</Text>;
  }
  return (
    <View className="gap-4">
      {rows.map((row) => (
        <View key={row.key}>
          <View className="mb-2 flex-row items-center justify-between gap-3">
            <View className="flex-1">
              <Text numberOfLines={1} className="text-sm font-medium text-slate-700">
                {row.label}
              </Text>
              {row.note ? <Text className="mt-0.5 text-xs text-slate-400">{row.note}</Text> : null}
            </View>
            <Text className="text-sm font-semibold text-slate-900">{row.display}</Text>
          </View>
          <View className="h-2 overflow-hidden rounded-full bg-slate-100">
            <View
              className={`h-2 rounded-full ${row.value < 0 ? 'bg-red-500' : 'bg-brand-600'}`}
              style={{ width: `${Math.max(3, (Math.abs(row.value) / maximum) * 100)}%` }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

function fillSalesTrend(
  trend: ReportsWorkspace['sales']['trend'],
  from: string,
  to: string,
): ReportsWorkspace['sales']['trend'] {
  const dayMs = 86_400_000;
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  const dayCount = Math.round((end.getTime() - start.getTime()) / dayMs);
  if (dayCount < 1 || dayCount > 31) return trend;
  const byDate = new Map(trend.map((item) => [item.date, item]));
  return Array.from({ length: dayCount }, (_, index) => {
    const current = new Date(start);
    current.setDate(current.getDate() + index);
    const date = localDateInput(current);
    return byDate.get(date) ?? { date, sales: '0.00', transactions: 0 };
  });
}

function smoothChartPoints(
  points: Array<{ x: number; y: number }>,
  maximumY: number,
): Array<{ x: number; y: number }> {
  if (points.length < 2) return points;
  const samplesPerSegment = 10;
  const smooth: Array<{ x: number; y: number }> = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)]!;
    const p1 = points[index]!;
    const p2 = points[index + 1]!;
    const p3 = points[Math.min(points.length - 1, index + 2)]!;
    for (let sample = 0; sample < samplesPerSegment; sample += 1) {
      const t = sample / samplesPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      const x =
        0.5 *
        (2 * p1.x +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y =
        0.5 *
        (2 * p1.y +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      smooth.push({ x, y: Math.min(maximumY, Math.max(0, y)) });
    }
  }
  smooth.push(points.at(-1)!);
  return smooth;
}

function SalesLineChart({
  trend,
  from,
  to,
}: {
  trend: ReportsWorkspace['sales']['trend'];
  from: string;
  to: string;
}) {
  const [plotSize, setPlotSize] = useState({ width: 0, height: 148 });
  const series = useMemo(() => fillSalesTrend(trend, from, to), [from, to, trend]);
  const values = series.map((item) => Number(item.sales));
  const rawMaximum = Math.max(...values, 0);
  const step = Math.max(1, Math.ceil(rawMaximum / 4 / 100) * 100);
  const maximum = step * 4;
  const horizontalPadding = 5;
  const usableWidth = Math.max(0, plotSize.width - horizontalPadding * 2);
  const points = series.map((item, index) => ({
    ...item,
    x:
      series.length <= 1
        ? plotSize.width / 2
        : horizontalPadding + (index / (series.length - 1)) * usableWidth,
    y: plotSize.height - (Number(item.sales) / maximum) * plotSize.height,
  }));
  const smoothPoints = smoothChartPoints(points, plotSize.height);
  const labelCount = plotSize.width < 360 ? 4 : 6;
  const labelIndexes = Array.from(
    new Set(
      Array.from({ length: labelCount }, (_, index) => index).map((index) =>
        Math.min(
          series.length - 1,
          Math.max(
            0,
            Math.round((index / Math.max(labelCount - 1, 1)) * Math.max(series.length - 1, 0)),
          ),
        ),
      ),
    ),
  );
  const lastActive = [...trend].reverse().find((item) => Number(item.sales) !== 0) ?? trend.at(-1);

  return (
    <View>
      <View className="flex-row">
        <View className="mr-2 h-40 w-12 justify-between pb-3">
          {[4, 3, 2, 1, 0].map((level) => (
            <Text key={level} className="text-right text-[10px] text-slate-400">
              {level === 0 ? '0' : `₱${(step * level).toLocaleString()}`}
            </Text>
          ))}
        </View>
        <View
          className="relative h-40 flex-1 overflow-hidden"
          onLayout={(event) =>
            setPlotSize({
              width: event.nativeEvent.layout.width,
              height: Math.max(100, event.nativeEvent.layout.height - 12),
            })
          }
        >
          {[0, 1, 2, 3, 4].map((level) => (
            <View
              key={level}
              className="absolute left-0 right-0 h-px bg-slate-100"
              style={{ top: (level / 4) * plotSize.height }}
            />
          ))}
          {smoothPoints.slice(0, -1).map((point, index) => {
            const next = smoothPoints[index + 1]!;
            return (
              <View
                key={`${index}-fill`}
                className="absolute"
                style={{
                  left: point.x,
                  top: point.y,
                  width: Math.max(2, next.x - point.x + 1),
                  height: Math.max(0, plotSize.height - point.y),
                  backgroundColor: 'rgba(26, 89, 59, 0.055)',
                }}
              />
            );
          })}
          {smoothPoints.slice(1).map((point, index) => {
            const previous = smoothPoints[index]!;
            const deltaX = point.x - previous.x;
            const deltaY = point.y - previous.y;
            const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            const angle = (Math.atan2(deltaY, deltaX) * 180) / Math.PI;
            return (
              <View
                key={`${index}-line`}
                className="absolute rounded-full"
                style={{
                  left: (point.x + previous.x - length) / 2,
                  top: (point.y + previous.y) / 2 - 1,
                  width: length,
                  height: 2,
                  backgroundColor: '#1A593B',
                  transform: [{ rotate: `${angle}deg` }],
                }}
              />
            );
          })}
        </View>
      </View>
      <View className="ml-14 mt-1 flex-row justify-between">
        {labelIndexes.map((index) => {
          const item = series[index];
          return (
            <Text key={`${item?.date}-${index}`} className="text-[10px] text-slate-400">
              {item
                ? new Date(`${item.date}T12:00:00`).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })
                : ''}
            </Text>
          );
        })}
      </View>
      {lastActive ? (
        <View className="mt-5 flex-row items-center justify-between border-t border-slate-100 pt-4">
          <View>
            <Text className="text-sm font-medium text-slate-900">
              {new Date(`${lastActive.date}T12:00:00`).toLocaleDateString()}
            </Text>
            <Text className="mt-1 text-xs text-slate-500">
              {lastActive.transactions} transactions
            </Text>
          </View>
          <Text className="text-base font-semibold text-slate-950">
            {formatMoney(lastActive.sales)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function RankedMoneyRows({
  rows,
  emptyLabel,
}: {
  rows: Array<{
    key: string;
    label: string;
    note: string;
    value: string;
    icon?: ComponentProps<typeof Feather>['name'];
  }>;
  emptyLabel: string;
}) {
  const maximum = Math.max(...rows.map((item) => Number(item.value)), 1);
  if (!rows.length) {
    return <Text className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">{emptyLabel}</Text>;
  }
  const total = rows.reduce((sum, item) => sum + Number(item.value), 0);
  return (
    <View>
      <View className="gap-4">
        {rows.map((item, index) => (
          <View key={item.key}>
            <View className="mb-2 flex-row items-center">
              <View className="mr-3 h-8 w-8 items-center justify-center rounded-full bg-brand-50">
                {item.icon ? (
                  <Feather name={item.icon} size={14} color="#81776E" />
                ) : (
                  <Text className="text-xs font-medium text-brand-700">{index + 1}</Text>
                )}
              </View>
              <View className="flex-1">
                <Text numberOfLines={1} className="text-sm font-medium text-slate-900">
                  {item.label}
                </Text>
                <Text className="mt-0.5 text-xs text-slate-500">{item.note}</Text>
              </View>
              <Text className="text-sm font-semibold text-slate-950">
                {formatMoney(item.value)}
              </Text>
            </View>
            <View className="ml-11 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <View
                className="h-1.5 rounded-full bg-brand-700"
                style={{ width: `${Math.max(3, (Number(item.value) / maximum) * 100)}%` }}
              />
            </View>
          </View>
        ))}
      </View>
      <View className="mt-5 flex-row items-center justify-between border-t border-slate-100 pt-4">
        <Text className="text-sm font-medium text-slate-700">Total</Text>
        <Text className="text-base font-semibold text-slate-950">
          {formatMoney(total.toFixed(2))}
        </Text>
      </View>
    </View>
  );
}

function ReportsContent() {
  const { width } = useWindowDimensions();
  const phone = width < 640;
  const workspaceMaxWidth =
    width >= 3000 ? 2600 : width >= 2200 ? 2000 : width >= 1440 ? 1440 : 1200;
  const branch = useBranchStore((state) => state.activeBranch);
  const defaultCustomRange = useMemo(() => {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 29);
    return { from: localDateInput(from), to: localDateInput(to) };
  }, []);
  const [period, setPeriod] = useState<ReportPeriod>('30d');
  const [section, setSection] = useState<ReportSection>('sales');
  const [dateRangeVisible, setDateRangeVisible] = useState(false);
  const [customRange, setCustomRange] = useState(defaultCustomRange);
  const [draftFrom, setDraftFrom] = useState(defaultCustomRange.from);
  const [draftTo, setDraftTo] = useState(defaultCustomRange.to);
  const [dateRangeError, setDateRangeError] = useState('');
  const selectedPeriod = PERIODS.find((item) => item.key === period);
  const range = useMemo(() => {
    if (period === 'custom') {
      const from = dateAtLocalMidnight(customRange.from);
      const to = dateAtLocalMidnight(customRange.to);
      to.setDate(to.getDate() + 1);
      return { from: from.toISOString(), to: to.toISOString() };
    }
    const to = new Date();
    to.setHours(0, 0, 0, 0);
    to.setDate(to.getDate() + 1);
    const from =
      selectedPeriod?.days === null ? new Date('2000-01-01T00:00:00.000Z') : new Date(to.getTime());
    if (selectedPeriod?.days !== null) from.setDate(from.getDate() - (selectedPeriod?.days ?? 30));
    return { from: from.toISOString(), to: to.toISOString() };
  }, [customRange.from, customRange.to, period, selectedPeriod?.days]);
  const rangeLabel =
    period === 'custom' ? readableDateRange(range.from, range.to) : (selectedPeriod?.label ?? '');
  const query = useQuery({
    queryKey: ['reports-workspace', period, branch?.id, range.from, range.to],
    queryFn: () =>
      api<ReportsWorkspace>(
        `/reports/workspace?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(
          range.to,
        )}${branch?.id ? `&branchId=${branch.id}` : ''}`,
      ),
  });

  return (
    <Screen>
      <Header
        title="Reports"
        subtitle={`${rangeLabel} · ${branch?.name ?? 'All accessible branches'}`}
        showBack={!phone}
        backLabel="More"
        fallbackHref="/(tabs)/more"
      />
      <ScrollView contentContainerClassName="items-center p-4 pb-12">
        <View className="w-full gap-4" style={{ maxWidth: workspaceMaxWidth }}>
          <View className="rounded-2xl border border-slate-200 bg-white p-3">
            <View className="flex-row flex-wrap gap-2">
              {PERIODS.map((item) => {
                const selected = item.key === period;
                return (
                  <Pressable
                    key={item.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setPeriod(item.key)}
                    className={`min-h-11 items-center justify-center rounded-xl px-4 ${
                      selected ? 'bg-brand-700' : 'bg-slate-50 active:bg-brand-50'
                    }`}
                    style={{ minWidth: phone ? 80 : 100, flexBasis: phone ? 80 : 0, flexGrow: 1 }}
                  >
                    <Text
                      className={`text-sm font-medium ${selected ? 'text-white' : 'text-slate-600'}`}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: period === 'custom' }}
                onPress={() => {
                  setDraftFrom(customRange.from);
                  setDraftTo(customRange.to);
                  setDateRangeError('');
                  setDateRangeVisible(true);
                }}
                className={`min-h-11 flex-row items-center justify-center rounded-xl px-4 ${
                  period === 'custom' ? 'bg-brand-700' : 'bg-slate-50 active:bg-brand-50'
                }`}
                style={{ minWidth: phone ? 120 : 145, flexBasis: phone ? 120 : 0, flexGrow: 1 }}
              >
                <Feather
                  name="calendar"
                  size={15}
                  color={period === 'custom' ? '#FFFFFF' : '#81776E'}
                />
                <Text
                  className={`ml-2 text-sm font-medium ${
                    period === 'custom' ? 'text-white' : 'text-slate-600'
                  }`}
                >
                  Date range
                </Text>
              </Pressable>
            </View>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="flex-row gap-2">
              {SECTIONS.map((item) => {
                const selected = item.key === section;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => setSection(item.key)}
                    className={`min-h-11 flex-row items-center justify-center rounded-xl border px-4 ${
                      selected
                        ? 'border-brand-700 bg-brand-50'
                        : 'border-slate-200 bg-white active:bg-slate-50'
                    }`}
                  >
                    <Feather name={item.icon} size={15} color={selected ? '#1A593B' : '#81776E'} />
                    <Text
                      className={`ml-2 text-sm font-medium ${
                        selected ? 'text-brand-800' : 'text-slate-600'
                      }`}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          {query.isLoading ? (
            <View className="min-h-96 rounded-2xl bg-white">
              <LoadingState label="Building your reports…" />
            </View>
          ) : query.isError ? (
            <View className="min-h-96 rounded-2xl bg-white">
              <ErrorState message={query.error.message} retry={() => void query.refetch()} />
            </View>
          ) : query.data ? (
            <>
              {section === 'overview' ? (
                <OverviewReport report={query.data} setSection={setSection} />
              ) : null}
              {section === 'sales' ? (
                <SalesReport report={query.data} from={range.from} to={range.to} />
              ) : null}
              {section === 'inventory' ? <InventoryReport report={query.data} /> : null}
              {section === 'purchasing' ? <PurchasingReport report={query.data} /> : null}
              {section === 'profit' ? <ProfitReport report={query.data} /> : null}
              {section === 'cash' ? <CashReport report={query.data} /> : null}
            </>
          ) : null}
        </View>
      </ScrollView>
      <Modal
        visible={dateRangeVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDateRangeVisible(false)}
      >
        <View className="flex-1 items-center justify-center bg-black/40 p-5">
          <View className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
            <View className="mb-5 flex-row items-start">
              <View className="mr-3 h-12 w-12 items-center justify-center rounded-2xl bg-brand-50">
                <Feather name="calendar" size={21} color="#1A593B" />
              </View>
              <View className="flex-1">
                <Text className="text-xl font-semibold text-slate-950">Custom date range</Text>
                <Text className="mt-1 text-sm leading-5 text-slate-500">
                  Both start and end dates are included in the report.
                </Text>
              </View>
            </View>
            <View className="flex-row flex-wrap gap-3">
              <View
                style={
                  phone
                    ? { width: '100%', flexBasis: '100%' }
                    : { minWidth: 160, flexBasis: 0, flexGrow: 1 }
                }
              >
                <Field
                  label="From"
                  value={draftFrom}
                  onChangeText={setDraftFrom}
                  placeholder="YYYY-MM-DD"
                />
              </View>
              <View
                style={
                  phone
                    ? { width: '100%', flexBasis: '100%' }
                    : { minWidth: 160, flexBasis: 0, flexGrow: 1 }
                }
              >
                <Field
                  label="To"
                  value={draftTo}
                  onChangeText={setDraftTo}
                  placeholder="YYYY-MM-DD"
                />
              </View>
            </View>
            {dateRangeError ? (
              <View className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3">
                <Text className="text-sm text-red-700">{dateRangeError}</Text>
              </View>
            ) : null}
            <View className="gap-3">
              <Button
                title="Apply date range"
                onPress={() => {
                  if (!isValidDateInput(draftFrom) || !isValidDateInput(draftTo)) {
                    setDateRangeError('Enter valid dates using YYYY-MM-DD.');
                    return;
                  }
                  if (dateAtLocalMidnight(draftFrom) > dateAtLocalMidnight(draftTo)) {
                    setDateRangeError('The From date cannot be later than the To date.');
                    return;
                  }
                  setCustomRange({ from: draftFrom, to: draftTo });
                  setPeriod('custom');
                  setDateRangeVisible(false);
                }}
              />
              <Button
                title="Cancel"
                variant="secondary"
                onPress={() => setDateRangeVisible(false)}
              />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function OverviewReport({
  report,
  setSection,
}: {
  report: ReportsWorkspace;
  setSection(section: ReportSection): void;
}) {
  const { width } = useWindowDimensions();
  const phone = width < 640;
  const cards: Array<{
    section: ReportSection;
    title: string;
    value: string;
    note: string;
    icon: ComponentProps<typeof Feather>['name'];
  }> = [
    {
      section: 'sales',
      title: 'Sales report',
      value: formatMoney(report.kpis.netSales),
      note: `${report.kpis.transactions} transactions`,
      icon: 'shopping-cart',
    },
    {
      section: 'inventory',
      title: 'Inventory report',
      value: formatMoney(report.inventory.inventoryValue),
      note: `${report.inventory.lowStockCount} low-stock records`,
      icon: 'package',
    },
    {
      section: 'purchasing',
      title: 'Purchasing report',
      value: formatMoney(report.purchasing.receivedValue),
      note: `${report.purchasing.openOrders} open orders`,
      icon: 'truck',
    },
    {
      section: 'profit',
      title: 'Profit report',
      value: formatMoney(report.kpis.grossProfit),
      note: `${Number(report.kpis.grossMarginPercent).toFixed(2)}% gross margin`,
      icon: 'trending-up',
    },
    {
      section: 'cash',
      title: 'Cash and shifts',
      value: formatMoney(report.cash.cashSales),
      note: `${report.cash.openShifts} open shifts`,
      icon: 'monitor',
    },
  ];
  return (
    <>
      <View className="flex-row flex-wrap gap-3">
        <MetricCard label="Net sales" value={formatMoney(report.kpis.netSales)} icon="activity" />
        <MetricCard
          label="Gross profit"
          value={formatMoney(report.kpis.grossProfit)}
          note={`${Number(report.kpis.grossMarginPercent).toFixed(2)}% margin`}
          icon="trending-up"
        />
        <MetricCard
          label="Transactions"
          value={String(report.kpis.transactions)}
          note={`${formatMoney(report.kpis.averageTransaction)} average`}
          icon="file-text"
          tone="blue"
        />
        <MetricCard
          label="Inventory value"
          value={formatMoney(report.inventory.inventoryValue)}
          note={`${report.inventory.outOfStockCount} out of stock`}
          icon="package"
          tone="amber"
        />
        <MetricCard
          label="Payables"
          value={formatMoney(report.purchasing.outstandingPayables)}
          note="Current unpaid supplier invoices"
          icon="credit-card"
          tone="red"
        />
        <MetricCard
          label="Cash variance"
          value={formatMoney(report.cash.variance)}
          note={`${report.cash.shifts} shifts in period`}
          icon="briefcase"
          tone={Number(report.cash.variance) === 0 ? 'brand' : 'red'}
        />
      </View>
      <ReportCard title="All reports" subtitle="Open a report without leaving the Reports tab.">
        <View className="flex-row flex-wrap gap-3">
          {cards.map((card) => (
            <Pressable
              key={card.section}
              onPress={() => setSection(card.section)}
              className="flex-row items-center rounded-2xl border border-slate-200 bg-slate-50 p-4 active:bg-brand-50"
              style={
                phone
                  ? { width: '100%', flexBasis: '100%' }
                  : { minWidth: 224, flexBasis: 224, flexGrow: 1 }
              }
            >
              <View className="mr-3 h-11 w-11 items-center justify-center rounded-xl bg-white">
                <Feather name={card.icon} size={18} color="#1A593B" />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-medium text-slate-700">{card.title}</Text>
                <Text className="mt-1 text-lg font-semibold text-slate-950">{card.value}</Text>
                <Text className="mt-0.5 text-xs text-slate-500">{card.note}</Text>
              </View>
              <Feather name="chevron-right" size={17} color="#81776E" />
            </Pressable>
          ))}
        </View>
      </ReportCard>
    </>
  );
}

function SalesReport({ report, from, to }: { report: ReportsWorkspace; from: string; to: string }) {
  return (
    <>
      <View className="flex-row flex-wrap gap-3">
        <MetricCard
          label="Gross sales"
          value={formatMoney(report.kpis.grossSales)}
          icon="shopping-bag"
        />
        <MetricCard label="Net sales" value={formatMoney(report.kpis.netSales)} icon="activity" />
        <MetricCard
          label="Customer refunds"
          value={formatMoney(report.kpis.customerRefunds)}
          note={`${Number(report.kpis.refundRatePercent).toFixed(2)}% of gross sales`}
          icon="corner-up-left"
          tone="red"
        />
        <MetricCard
          label="Average sale"
          value={formatMoney(report.kpis.averageTransaction)}
          icon="bar-chart-2"
          tone="blue"
        />
        <MetricCard label="Items sold" value={report.kpis.itemsSold.toLocaleString()} icon="box" />
        <MetricCard
          label="Known customers"
          value={String(report.kpis.uniqueCustomers)}
          icon="users"
          tone="amber"
        />
      </View>
      <View className="flex-row flex-wrap gap-4">
        <ResponsivePanel>
          <ReportCard
            title="Sales Trend"
            subtitle="Up to the latest 31 active days in this range"
            action={<Feather name="trending-up" size={17} color="#1A593B" />}
          >
            <SalesLineChart trend={report.sales.trend} from={from} to={to} />
          </ReportCard>
        </ResponsivePanel>
        <ResponsivePanel>
          <ReportCard
            title="Payment methods"
            subtitle="Payments less customer refunds."
            icon="credit-card"
          >
            <RankedMoneyRows
              emptyLabel="No payments for this period."
              rows={report.sales.paymentMethods.map((item) => ({
                key: item.method,
                label: item.method.replaceAll('_', ' '),
                note: `${item.transactions} payments`,
                value: item.total,
                icon: 'dollar-sign',
              }))}
            />
          </ReportCard>
        </ResponsivePanel>
      </View>
      <View className="flex-row flex-wrap gap-4">
        <ResponsivePanel>
          <ReportCard
            title="Best-selling products"
            subtitle="Ranked by gross product sales."
            icon="star"
          >
            <RankedMoneyRows
              emptyLabel="No products sold for this period."
              rows={report.sales.topProducts.map((item) => ({
                key: item.sku,
                label: item.name,
                note: `${item.quantity} ${item.unit} · ${item.sku}`,
                value: item.sales,
              }))}
            />
          </ReportCard>
        </ResponsivePanel>
        <ResponsivePanel>
          <ReportCard
            title="Sales by category"
            subtitle="Gross sales per product category."
            icon="tag"
          >
            <RankedMoneyRows
              emptyLabel="No category sales for this period."
              rows={report.sales.topCategories.map((item) => ({
                key: item.name,
                label: item.name,
                note: `${item.quantity} items`,
                value: item.sales,
                icon: 'tag',
              }))}
            />
          </ReportCard>
        </ResponsivePanel>
      </View>
      <ReportCard title="Sales by branch" icon="map-pin">
        <BarRows
          rows={report.sales.branches.map((item) => ({
            key: item.id,
            label: item.name,
            note: `${item.transactions} transactions`,
            value: Number(item.sales),
            display: formatMoney(item.sales),
          }))}
        />
      </ReportCard>
    </>
  );
}

function InventoryReport({ report }: { report: ReportsWorkspace }) {
  return (
    <>
      <View className="flex-row flex-wrap gap-3">
        <MetricCard
          label="Inventory value"
          value={formatMoney(report.inventory.inventoryValue)}
          icon="archive"
        />
        <MetricCard
          label="Units on hand"
          value={report.inventory.unitsOnHand.toLocaleString()}
          icon="package"
          tone="blue"
        />
        <MetricCard
          label="Active products"
          value={String(report.inventory.activeProducts)}
          icon="tag"
        />
        <MetricCard
          label="Low stock"
          value={String(report.inventory.lowStockCount)}
          icon="alert-triangle"
          tone="amber"
        />
        <MetricCard
          label="Out of stock"
          value={String(report.inventory.outOfStockCount)}
          icon="x-circle"
          tone="red"
        />
      </View>
      <View className="flex-row flex-wrap gap-4">
        <ResponsivePanel>
          <ReportCard title="Inventory value by category">
            <BarRows
              rows={report.inventory.byCategory.map((item) => ({
                key: item.name,
                label: item.name,
                note: `${item.products} products · ${item.quantity} units`,
                value: Number(item.value),
                display: formatMoney(item.value),
              }))}
            />
          </ReportCard>
        </ResponsivePanel>
        <ResponsivePanel>
          <ReportCard title="Inventory movements" subtitle="Movement activity during this period.">
            <BarRows
              rows={report.inventory.movements.map((item) => ({
                key: item.type,
                label: item.type.replaceAll('_', ' '),
                note: `${item.quantity} units affected`,
                value: item.movements,
                display: `${item.movements} entries`,
              }))}
            />
          </ReportCard>
        </ResponsivePanel>
      </View>
      <ReportCard
        title="Low-stock and out-of-stock products"
        subtitle="Products at or below their configured alert level."
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
        {report.inventory.lowStock.length ? (
          <View className="overflow-hidden rounded-xl border border-slate-200">
            {report.inventory.lowStock.map((item, index) => (
              <View
                key={`${item.id}-${item.branchName}`}
                className={`flex-row flex-wrap items-center gap-3 p-4 ${
                  index ? 'border-t border-slate-100' : ''
                } ${item.quantity <= 0 ? 'bg-red-50' : 'bg-white'}`}
              >
                <View className="min-w-52 flex-1">
                  <Text className="text-sm font-medium text-slate-800">{item.name}</Text>
                  <Text className="mt-1 text-xs text-slate-500">
                    {item.sku} · {item.branchName}
                  </Text>
                </View>
                <Text className={item.quantity <= 0 ? 'text-red-700' : 'text-amber-700'}>
                  {item.quantity} {item.unit} / alert at {item.lowStockLevel}
                </Text>
                <Text className="w-28 text-right text-sm font-medium text-slate-700">
                  {formatMoney(item.inventoryValue)}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text className="rounded-xl bg-brand-50 p-4 text-sm text-brand-700">
            All tracked products are above their alert levels.
          </Text>
        )}
      </ReportCard>
    </>
  );
}

function PurchasingReport({ report }: { report: ReportsWorkspace }) {
  return (
    <>
      <View className="flex-row flex-wrap gap-3">
        <MetricCard
          label="Ordered value"
          value={formatMoney(report.purchasing.orderedValue)}
          icon="clipboard"
        />
        <MetricCard
          label="Received value"
          value={formatMoney(report.purchasing.receivedValue)}
          icon="download"
          tone="blue"
        />
        <MetricCard
          label="Open orders"
          value={String(report.purchasing.openOrders)}
          note={`${report.purchasing.purchaseOrders} orders created`}
          icon="truck"
          tone="amber"
        />
        <MetricCard
          label="Outstanding payables"
          value={formatMoney(report.purchasing.outstandingPayables)}
          note="Current unpaid supplier invoices"
          icon="credit-card"
          tone="red"
        />
        <MetricCard
          label="Supplier payments"
          value={formatMoney(report.purchasing.supplierPayments)}
          icon="arrow-up-right"
        />
        <MetricCard
          label="Supplier returns"
          value={formatMoney(report.purchasing.supplierReturns)}
          note={`${formatMoney(report.purchasing.supplierRefunds)} received back`}
          icon="corner-up-left"
          tone="red"
        />
      </View>
      <View className="flex-row flex-wrap gap-4">
        <ResponsivePanel>
          <ReportCard title="Purchase orders by status">
            <BarRows
              rows={report.purchasing.orderStatuses.map((item) => ({
                key: item.status,
                label: item.status.replaceAll('_', ' '),
                note: formatMoney(item.value),
                value: item.orders,
                display: `${item.orders} orders`,
              }))}
            />
          </ReportCard>
        </ResponsivePanel>
        <ResponsivePanel>
          <ReportCard
            title="Top suppliers"
            subtitle="Ranked by non-draft, non-cancelled order value."
          >
            <BarRows
              rows={report.purchasing.topSuppliers.map((item) => ({
                key: item.id,
                label: item.name,
                note: `${item.orders} orders`,
                value: Number(item.value),
                display: formatMoney(item.value),
              }))}
            />
          </ReportCard>
        </ResponsivePanel>
      </View>
      <Pressable
        onPress={() => router.push('/purchasing')}
        className="min-h-14 flex-row items-center justify-center rounded-xl bg-brand-700 px-5 active:opacity-80"
      >
        <Feather name="truck" size={17} color="#FFFFFF" />
        <Text className="ml-2 font-medium text-white">Open purchasing workspace</Text>
      </Pressable>
    </>
  );
}

function ProfitReport({ report }: { report: ReportsWorkspace }) {
  return (
    <>
      <View className="flex-row flex-wrap gap-3">
        <MetricCard
          label="Gross sales"
          value={formatMoney(report.profit.grossSales)}
          icon="shopping-bag"
        />
        <MetricCard
          label="Refunds"
          value={formatMoney(report.profit.refunds)}
          icon="corner-up-left"
          tone="red"
        />
        <MetricCard label="Net sales" value={formatMoney(report.profit.netSales)} icon="activity" />
        <MetricCard
          label="Net cost of goods"
          value={formatMoney(report.profit.netCost)}
          icon="package"
          tone="amber"
        />
        <MetricCard
          label="Gross profit"
          value={formatMoney(report.profit.grossProfit)}
          icon="trending-up"
        />
        <MetricCard
          label="Gross margin"
          value={`${Number(report.profit.grossMarginPercent).toFixed(2)}%`}
          icon="percent"
          tone="blue"
        />
      </View>
      <ReportCard
        title="Profit trend"
        subtitle="Gross profit equals net sales less net cost of goods. Operating expenses are not yet deducted."
      >
        <BarRows
          rows={report.profit.trend.map((item) => ({
            key: item.date,
            label: new Date(`${item.date}T12:00:00`).toLocaleDateString(),
            note: `${formatMoney(item.netSales)} net sales · ${formatMoney(item.netCost)} cost`,
            value: Number(item.profit),
            display: formatMoney(item.profit),
          }))}
        />
      </ReportCard>
    </>
  );
}

function CashReport({ report }: { report: ReportsWorkspace }) {
  return (
    <>
      <View className="flex-row flex-wrap gap-3">
        <MetricCard
          label="Cash sales"
          value={formatMoney(report.cash.cashSales)}
          icon="dollar-sign"
        />
        <MetricCard
          label="Cash refunds"
          value={formatMoney(report.cash.cashRefunds)}
          icon="corner-up-left"
          tone="red"
        />
        <MetricCard label="Cash in" value={formatMoney(report.cash.cashIn)} icon="log-in" />
        <MetricCard
          label="Cash out"
          value={formatMoney(report.cash.cashOut)}
          icon="log-out"
          tone="amber"
        />
        <MetricCard
          label="Counted cash"
          value={formatMoney(report.cash.countedCash)}
          icon="briefcase"
          tone="blue"
        />
        <MetricCard
          label="Variance"
          value={formatMoney(report.cash.variance)}
          note={`${report.cash.openShifts} open of ${report.cash.shifts} shifts`}
          icon="alert-circle"
          tone={Number(report.cash.variance) === 0 ? 'brand' : 'red'}
        />
      </View>
      <ReportCard
        title="Cash accountability"
        subtitle="Review each cashier shift, payment method, movement, expected cash, counted cash, and variance."
      >
        <Pressable
          onPress={() => router.push('/shift-reports')}
          className="min-h-14 flex-row items-center justify-between rounded-xl bg-brand-700 px-5 active:opacity-80"
        >
          <View className="flex-row items-center">
            <Feather name="monitor" size={18} color="#FFFFFF" />
            <Text className="ml-3 font-medium text-white">Open detailed cash and shift report</Text>
          </View>
          <Feather name="chevron-right" size={18} color="#FFFFFF" />
        </Pressable>
      </ReportCard>
    </>
  );
}

export default function ReportsScreen() {
  return (
    <AppSidebarProvider>
      <ReportsContent />
    </AppSidebarProvider>
  );
}
