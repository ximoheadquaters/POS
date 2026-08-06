import { useMemo, useState, type ComponentProps, type ReactNode } from 'react';
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
import { AppSidebarProvider } from '@/components/app-sidebar';
import { Button, ErrorState, Field, Header, LoadingState, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import type { ReportsWorkspace } from '@/lib/report-types';
import { useSession } from '@/providers/session';
import { useBranchStore } from '@/store/branch';

type ReportSection = 'overview' | 'sales' | 'products' | 'inventory' | 'purchasing' | 'profit' | 'cash';
type ReportPeriod = 'today' | 'yesterday' | '7d' | '30d' | 'this_month' | 'last_month' | 'all' | 'custom';

interface DetailItem {
  id: string;
  title: string;
  sku?: string;
  category?: string;
  quantity?: number;
  unit?: string;
  unitCost?: string;
  totalValue?: string;
  value: string;
  subValue?: string;
  statusTag?: string;
  statusTone?: 'green' | 'amber' | 'red' | 'blue' | 'slate';
  note?: string;
  actionHref?: string;
}

interface MetricDrilldownConfig {
  metricKey: string;
  title: string;
  subtitle: string;
  icon: ComponentProps<typeof Feather>['name'];
  tone?: 'brand' | 'amber' | 'red' | 'blue';
  summaryLabel: string;
  summaryValue: string;
  items: DetailItem[];
  categoriesSummary?: Array<{ name: string; value: number; display: string }>;
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
  {
    key: 'this_month',
    label: 'This Month',
    getRange: () => {
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: localDateInput(first), to: localDateInput(now) };
    },
  },
  {
    key: 'last_month',
    label: 'Last Month',
    getRange: () => {
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: localDateInput(first), to: localDateInput(last) };
    },
  },
  {
    key: 'all',
    label: 'All time',
    getRange: () => ({ from: '2000-01-01', to: localDateInput(new Date()) }),
  },
];

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
  if (!fromIso || !toIso) return '';
  const start = new Date(fromIso);
  const end = new Date(new Date(toIso).getTime() - 1000);
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  const startStr = start.toLocaleDateString('en-US', options);
  const endStr = end.toLocaleDateString('en-US', options);
  if (startStr === endStr) return startStr;
  return `${startStr} – ${endStr}`;
}

const SECTIONS: Array<{
  key: ReportSection;
  label: string;
  icon: ComponentProps<typeof Feather>['name'];
}> = [
  { key: 'overview', label: 'KPIs', icon: 'grid' },
  { key: 'sales', label: 'Sales', icon: 'shopping-cart' },
  { key: 'products', label: 'Products', icon: 'tag' },
  { key: 'inventory', label: 'Inventory', icon: 'package' },
  { key: 'purchasing', label: 'Purchasing', icon: 'truck' },
  { key: 'profit', label: 'Profit', icon: 'trending-up' },
  { key: 'cash', label: 'Cash & shifts', icon: 'monitor' },
];

const BRAND_COLORS = [
  '#1A593B',
  '#2D7D54',
  '#4CAF50',
  '#81C784',
  '#A7D2BC',
  '#B45309',
  '#2563EB',
];

function DonutChart({
  total,
  totalLabel = 'Total',
  segments,
}: {
  total: number | string;
  totalLabel?: string;
  segments: Array<{ label: string; count: number; percentage: number; color: string }>;
}) {
  const size = 160;
  const strokeWidth = 24;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let cumulativePercent = 0;

  return (
    <View className="flex-row flex-wrap items-center justify-between gap-6">
      <View className="relative items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="transparent"
            stroke="#F1F5F9"
            strokeWidth={strokeWidth}
          />
          {segments.map((seg, i) => {
            const strokeDasharray = `${(seg.percentage / 100) * circumference} ${circumference}`;
            const strokeDashoffset = -((cumulativePercent / 100) * circumference);
            cumulativePercent += seg.percentage;
            return (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="transparent"
                stroke={seg.color}
                strokeWidth={strokeWidth}
                strokeDasharray={strokeDasharray}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%', transition: 'all 0.5s ease' }}
              />
            );
          })}
        </svg>
        <View className="absolute items-center justify-center">
          <Text className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{totalLabel}</Text>
          <Text className="text-2xl font-black text-slate-900">{total}</Text>
        </View>
      </View>

      <View className="flex-1 min-w-[200px] gap-2">
        {segments.map((seg, i) => (
          <View key={i} className="flex-row items-center justify-between rounded-xl bg-slate-50 p-2.5 border border-slate-100">
            <View className="flex-row items-center gap-2 flex-1 mr-2">
              <View className="h-3 w-3 rounded-md" style={{ backgroundColor: seg.color }} />
              <Text numberOfLines={1} className="text-xs font-semibold text-slate-700">
                {seg.label}
              </Text>
            </View>
            <View className="rounded-md bg-white px-2 py-0.5 border border-slate-200">
              <Text className="text-xs font-bold text-slate-900">{seg.percentage}%</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function RadialGauge({
  percentage,
  label,
  valueNote,
  color = '#1A593B',
}: {
  percentage: number;
  label: string;
  valueNote?: string;
  color?: string;
}) {
  const size = 120;
  const strokeWidth = 14;
  const radius = (size - strokeWidth) / 2;
  const circumference = Math.PI * radius;

  return (
    <View className="items-center justify-center p-3 rounded-2xl bg-white border border-slate-200 flex-1 min-w-[140px]">
      <View className="relative items-center justify-center" style={{ width: size, height: size / 2 + 10 }}>
        <svg width={size} height={size / 2 + 10} viewBox={`0 0 ${size} ${size / 2 + 10}`}>
          <path
            d={`M ${strokeWidth / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${size / 2}`}
            fill="none"
            stroke="#E2E8F0"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
          <path
            d={`M ${strokeWidth / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${size / 2}`}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${(percentage / 100) * circumference} ${circumference}`}
            strokeLinecap="round"
            style={{ transition: 'all 0.5s ease' }}
          />
        </svg>
        <View className="absolute bottom-0 items-center">
          <Text className="text-xl font-black text-slate-900">{percentage}%</Text>
        </View>
      </View>
      <Text className="mt-2 text-xs font-bold text-slate-800 text-center">{label}</Text>
      {valueNote ? <Text className="mt-0.5 text-[11px] text-slate-500 text-center">{valueNote}</Text> : null}
    </View>
  );
}


function MetricCard({
  label,
  value,
  note,
  icon,
  tone = 'brand',
  trend,
  onPress,
}: {
  label: string;
  value: string;
  note?: string;
  icon: ComponentProps<typeof Feather>['name'];
  tone?: 'brand' | 'amber' | 'red' | 'blue';
  trend?: string;
  onPress?: () => void;
}) {
  const { width } = useWindowDimensions();
  const phone = width < 640;
  const palette = {
    brand: ['bg-brand-50', '#1A593B'],
    amber: ['bg-amber-50', '#B45309'],
    red: ['bg-red-50', '#B42318'],
    blue: ['bg-blue-50', '#2563EB'],
  }[tone];

  const cardContent = (
    <View
      className={`rounded-2xl border bg-white p-4 transition-all ${
        onPress
          ? 'border-slate-200 shadow-xs hover:border-brand-400 active:bg-slate-50 active:scale-[0.98]'
          : 'border-slate-200'
      }`}
      style={
        phone
          ? { width: '100%', minWidth: '100%', flexBasis: '100%' }
          : { minWidth: 160, flexBasis: 160, flexGrow: 1 }
      }
    >
      <View className="mb-2 flex-row items-center justify-between">
        <View className={`h-10 w-10 items-center justify-center rounded-xl ${palette[0]}`}>
          <Feather name={icon} size={18} color={palette[1]} />
        </View>
        <View className="flex-row items-center gap-1.5">
          {trend ? (
            <View className={`rounded-full px-2 py-0.5 ${trend.startsWith('+') || trend.startsWith('↑') ? 'bg-emerald-100' : 'bg-red-100'}`}>
              <Text className={`text-[10px] font-bold ${trend.startsWith('+') || trend.startsWith('↑') ? 'text-emerald-800' : 'text-red-800'}`}>
                {trend}
              </Text>
            </View>
          ) : null}
          {onPress ? (
            <View className="flex-row items-center rounded-full bg-slate-100 px-2 py-0.5">
              <Text className="mr-1 text-[10px] font-semibold text-slate-600">Details</Text>
              <Feather name="chevron-right" size={12} color="#64748B" />
            </View>
          ) : null}
        </View>
      </View>
      <Text className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</Text>
      <Text className="mt-1 text-xl font-semibold text-slate-950">{value}</Text>
      {note ? <Text className="mt-1 text-xs leading-4 text-slate-500">{note}</Text> : null}
    </View>
  );

  if (onPress) {
    return (
      <Pressable accessibilityRole="button" onPress={onPress}>
        {cardContent}
      </Pressable>
    );
  }

  return cardContent;
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
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
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
  const series = useMemo(() => fillSalesTrend(trend, from, to), [from, to, trend]);
  const maxSales = Math.max(...series.map((item) => Number(item.sales)), 1);
  const chartHeight = 160;
  const chartWidth = 320;
  const rawPoints = useMemo(
    () =>
      series.map((item, index) => {
        const x =
          series.length > 1
            ? (index / (series.length - 1)) * (chartWidth - 24) + 12
            : chartWidth / 2;
        const y = chartHeight - (Number(item.sales) / maxSales) * (chartHeight - 32) - 16;
        return { x, y };
      }),
    [chartWidth, maxSales, series],
  );

  const curvePoints = useMemo(
    () => smoothChartPoints(rawPoints, chartHeight - 12),
    [rawPoints],
  );

  const labelIndexes = useMemo(() => {
    if (series.length <= 4) return series.map((_, i) => i);
    const step = (series.length - 1) / 3;
    return [0, Math.round(step), Math.round(step * 2), series.length - 1];
  }, [series]);

  const lastActive = series.filter((item) => Number(item.sales) > 0).at(-1);

  return (
    <View>
      <View className="flex-row justify-between border-b border-slate-100 pb-3">
        <Text className="text-xs font-semibold text-slate-500">Daily sales trend</Text>
        <Text className="text-xs font-semibold text-brand-800">Max: {formatMoney(maxSales.toFixed(2))}</Text>
      </View>
      <View className="relative mt-4 h-40 w-full overflow-hidden rounded-xl bg-slate-50/60 p-2">
        <View className="absolute inset-0 justify-between py-3 opacity-20">
          <View className="h-px bg-slate-400" />
          <View className="h-px bg-slate-400" />
          <View className="h-px bg-slate-400" />
        </View>
        <View className="relative flex-1">
          {curvePoints.slice(0, -1).map((point, index) => {
            const previous = index === 0 ? point : curvePoints[index - 1]!;
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
      <View className="ml-2 mt-2 flex-row justify-between">
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

function MetricDrilldownView({
  config,
  rangeLabel,
  branchName,
  organizationName,
  onBack,
}: {
  config: MetricDrilldownConfig;
  rangeLabel: string;
  branchName: string;
  organizationName: string;
  onBack: () => void;
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'low_stock' | 'out_of_stock'>('all');

  const filteredItems = useMemo(() => {
    return config.items.filter((item) => {
      if (statusFilter === 'active' && item.statusTag !== 'Active (On POS)' && item.statusTag !== 'Active' && item.statusTag !== 'In Stock') return false;
      if (statusFilter === 'low_stock' && item.statusTag !== 'Low Stock') return false;
      if (statusFilter === 'out_of_stock' && item.statusTag !== 'Out of Stock') return false;

      if (!search.trim()) return true;
      const q = search.toLowerCase().trim();
      return (
        item.title.toLowerCase().includes(q) ||
        (item.sku && item.sku.toLowerCase().includes(q)) ||
        (item.category && item.category.toLowerCase().includes(q)) ||
        (item.note && item.note.toLowerCase().includes(q))
      );
    });
  }, [config.items, search, statusFilter]);


  const totalCount = config.items.length || 1;
  const inStockCount = config.items.filter((i) => i.statusTag === 'In Stock' || i.statusTag === 'Active (On POS)' || i.statusTag === 'Active' || i.statusTone === 'green').length;
  const lowStockCount = config.items.filter((i) => i.statusTag === 'Low Stock' || i.statusTone === 'amber').length;
  const outOfStockCount = config.items.filter((i) => i.statusTag === 'Out of Stock' || i.statusTag === 'Unpaid Balance' || i.statusTone === 'red').length;

  const inStockPct = Math.round((inStockCount / totalCount) * 100);
  const lowStockPct = Math.round((lowStockCount / totalCount) * 100);
  const outOfStockPct = Math.round((outOfStockCount / totalCount) * 100);

  const donutSegments = useMemo(() => {
    if (config.categoriesSummary && config.categoriesSummary.length > 0) {
      const totalVal = config.categoriesSummary.reduce((sum, c) => sum + c.value, 0) || 1;
      return config.categoriesSummary.slice(0, 5).map((cat, idx) => ({
        label: cat.name,
        count: cat.value,
        percentage: Math.round((cat.value / totalVal) * 100),
        color: BRAND_COLORS[idx % BRAND_COLORS.length]!,
      }));
    }
    return [
      { label: 'Active / Healthy Logs', count: inStockCount, percentage: inStockPct || 100, color: '#1A593B' },
      ...(lowStockCount > 0 ? [{ label: 'Pending / Low Status', count: lowStockCount, percentage: lowStockPct, color: '#B45309' }] : []),
      ...(outOfStockCount > 0 ? [{ label: 'Out of Stock / Unpaid', count: outOfStockCount, percentage: outOfStockPct, color: '#B42318' }] : []),
    ];
  }, [config.categoriesSummary, inStockCount, inStockPct, lowStockCount, lowStockPct, outOfStockCount, outOfStockPct]);

  return (
    <View className="w-full gap-5">
      {/* Top Action Header Bar */}
      <View className="flex-row flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <Pressable
          onPress={onBack}
          className="flex-row items-center rounded-xl bg-slate-100 px-3.5 py-2 active:bg-slate-200"
        >
          <Feather name="arrow-left" size={16} color="#1E293B" />
          <Text className="ml-2 font-semibold text-slate-800 text-sm">Back to Reports Overview</Text>
        </Pressable>

      </View>

      {/* Main Metric Title Banner */}
      <View className="rounded-3xl border border-brand-200 bg-brand-50/50 p-6">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center flex-1 mr-4">
            <View className="mr-4 h-14 w-14 items-center justify-center rounded-2xl bg-brand-700 shadow-sm">
              <Feather name={config.icon} size={24} color="#FFFFFF" />
            </View>
            <View className="flex-1">
              <Text className="text-2xl font-bold text-slate-950">{config.title}</Text>
              <Text className="mt-1 text-xs text-slate-600 leading-4">{config.subtitle}</Text>
              <Text className="mt-1 text-[11px] font-medium text-brand-800">
                {rangeLabel} · {branchName}
              </Text>
            </View>
          </View>
          <View className="items-end rounded-2xl bg-white p-4 border border-brand-200 shadow-xs">
            <Text className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {config.summaryLabel}
            </Text>
            <Text className="mt-1 text-2xl font-black text-brand-800">{config.summaryValue}</Text>
          </View>
        </View>
      </View>

      {/* Graphical Row: Donut Ring Chart + Radial Arc Gauge Cards */}
      <View className="flex-row flex-wrap gap-4">
        <ResponsivePanel>
          <ReportCard title="Distribution & Breakdown Ring Chart" subtitle="Percentage breakdown of recorded detail log entries.">
            <DonutChart
              total={config.items.length}
              totalLabel="Total Records"
              segments={donutSegments}
            />
          </ReportCard>
        </ResponsivePanel>

        <ResponsivePanel>
          <ReportCard title="Performance & Health Arc Gauges" subtitle="Operational fulfillment and record status metrics.">
            <View className="flex-row flex-wrap gap-3">
              <RadialGauge
                percentage={inStockPct || 100}
                label="Fulfillment Rate"
                valueNote={`${inStockCount} of ${config.items.length} records`}
                color="#1A593B"
              />
              <RadialGauge
                percentage={Math.max(0, 100 - outOfStockPct)}
                label="Operational Health"
                valueNote={`${config.items.length - outOfStockCount} items active`}
                color="#2563EB"
              />
            </View>
          </ReportCard>
        </ResponsivePanel>
      </View>

      {/* Search & Filter Toolbar */}
      <View className="flex-row flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <View className="flex-1 min-w-[240px] flex-row items-center rounded-xl border border-slate-200 bg-slate-50 px-3 min-h-11">
          <Feather name="search" size={16} color="#94A3B8" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={`Search ${config.items.length} log records by name, invoice #, PO #, SKU…`}
            placeholderTextColor="#94A3B8"
            className="ml-2 flex-1 text-sm text-slate-900"
          />
          {search ? (
            <Pressable onPress={() => setSearch('')}>
              <Feather name="x-circle" size={16} color="#94A3B8" />
            </Pressable>
          ) : null}
        </View>

        <View className="flex-row gap-1.5 flex-wrap">
          <Pressable
            onPress={() => setStatusFilter('all')}
            className={`rounded-xl px-3 py-2 border ${statusFilter === 'all' ? 'bg-slate-900 border-slate-900' : 'bg-slate-50 border-slate-200'}`}
          >
            <Text className={`text-xs font-semibold ${statusFilter === 'all' ? 'text-white' : 'text-slate-700'}`}>All ({config.items.length})</Text>
          </Pressable>
          {lowStockCount > 0 ? (
            <Pressable
              onPress={() => setStatusFilter('low_stock')}
              className={`rounded-xl px-3 py-2 border ${statusFilter === 'low_stock' ? 'bg-amber-600 border-amber-600' : 'bg-amber-50 border-amber-200'}`}
            >
              <Text className={`text-xs font-semibold ${statusFilter === 'low_stock' ? 'text-white' : 'text-amber-800'}`}>Pending / Low ({lowStockCount})</Text>
            </Pressable>
          ) : null}
          {outOfStockCount > 0 ? (
            <Pressable
              onPress={() => setStatusFilter('out_of_stock')}
              className={`rounded-xl px-3 py-2 border ${statusFilter === 'out_of_stock' ? 'bg-red-600 border-red-600' : 'bg-red-50 border-red-200'}`}
            >
              <Text className={`text-xs font-semibold ${statusFilter === 'out_of_stock' ? 'text-white' : 'text-red-800'}`}>Unpaid / Out of Stock ({outOfStockCount})</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Itemized Table List */}
      <ReportCard title={`Itemized Log Details (${filteredItems.length})`}>
        {filteredItems.length > 0 ? (
          <View className="gap-2.5">
            {filteredItems.map((item, index) => (
              <View
                key={item.id || index}
                className="flex-row flex-wrap items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/80 p-4"
              >
                <View className="flex-1 min-w-[220px] mr-4">
                  <View className="flex-row items-center gap-2 flex-wrap">
                    <Text className="text-sm font-bold text-slate-900">{item.title}</Text>
                    {item.statusTag ? (
                      <View
                        className={`rounded-md px-2 py-0.5 ${
                          item.statusTone === 'green'
                            ? 'bg-emerald-100'
                            : item.statusTone === 'amber'
                              ? 'bg-amber-100'
                              : item.statusTone === 'red'
                                ? 'bg-red-100'
                                : 'bg-slate-200'
                        }`}
                      >
                        <Text
                          className={`text-[10px] font-bold ${
                            item.statusTone === 'green'
                              ? 'text-emerald-800'
                              : item.statusTone === 'amber'
                                ? 'text-amber-800'
                                : item.statusTone === 'red'
                                  ? 'text-red-800'
                                  : 'text-slate-700'
                          }`}
                        >
                          {item.statusTag}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text className="mt-1 text-xs text-slate-500">
                    {item.sku ? `${item.sku}` : ''}
                    {item.category ? ` · ${item.category}` : ''}
                    {item.note ? ` · ${item.note}` : ''}
                  </Text>
                </View>

                <View className="items-end">
                  <Text className="text-base font-extrabold text-slate-950">{item.value}</Text>
                  {item.subValue ? (
                    <Text className="mt-0.5 text-xs font-semibold text-brand-800">{item.subValue}</Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        ) : (
          <View className="py-12 items-center justify-center">
            <Feather name="inbox" size={36} color="#CBD5E1" />
            <Text className="mt-3 text-sm text-slate-500">No records match your filter criteria.</Text>
          </View>
        )}
      </ReportCard>
    </View>
  );
}

function OverviewReport({
  report,
  setSection,
  onOpenDetail,
}: {
  report: ReportsWorkspace;
  setSection(section: ReportSection): void;
  onOpenDetail(config: MetricDrilldownConfig): void;
}) {
  const { width } = useWindowDimensions();
  const phone = width < 640;
  const { currentUser } = useSession();
  const permissions = currentUser?.permissions ?? [];
  const canViewCost = permissions.includes('reports:view_cost');
  const canViewProfit = permissions.includes('reports:view_profit');
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
      value: canViewCost ? formatMoney(report.inventory.inventoryValue) : `${report.inventory.lowStockCount} alerts`,
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
    ...(canViewProfit
      ? [
          {
            section: 'profit' as const,
            title: 'Profit report',
            value: formatMoney(report.kpis.grossProfit),
            note: `${Number(report.kpis.grossMarginPercent).toFixed(2)}% gross margin`,
            icon: 'trending-up' as const,
          },
        ]
      : []),
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
        <MetricCard
          label="Net sales"
          value={formatMoney(report.kpis.netSales)}
          trend="↑ +12.4%"
          icon="activity"
          onPress={() =>
            onOpenDetail({
              metricKey: 'net_sales',
              title: 'Net Sales Receipts Log',
              subtitle: 'Total revenue earned after customer refunds and discounts.',
              icon: 'activity',
              summaryLabel: 'Net Sales Revenue',
              summaryValue: formatMoney(report.kpis.netSales),
              items: report.sales.salesReceipts && report.sales.salesReceipts.length > 0
                ? report.sales.salesReceipts.map((sr) => ({
                    id: sr.id,
                    title: `Receipt #${sr.receiptNumber}`,
                    sku: `Payment: ${sr.paymentMethod.replaceAll('_', ' ').toUpperCase()}`,
                    category: sr.branchName ?? 'Main Branch',
                    note: `Completed: ${sr.completedAt || 'N/A'}${sr.cashierName ? ` · Cashier: ${sr.cashierName}` : ''}`,
                    value: formatMoney(sr.total),
                    subValue: `Tax: ${formatMoney(sr.tax || '0')} · Discount: ${formatMoney(sr.discount || '0')}`,
                    statusTag: sr.status.replaceAll('_', ' ').toUpperCase(),
                    statusTone: sr.status === 'completed' ? 'green' : 'amber',
                  }))
                : report.sales.topProducts.map((p) => ({
                    id: p.sku,
                    title: p.name,
                    sku: p.sku,
                    note: `${p.quantity} ${p.unit} sold`,
                    value: formatMoney(p.sales),
                    subValue: canViewProfit ? `Profit: ${formatMoney(p.profit)}` : undefined,
                  })),
            })
          }
        />
        {canViewProfit ? (
          <MetricCard
            label="Gross profit"
            value={formatMoney(report.kpis.grossProfit)}
            note={`${Number(report.kpis.grossMarginPercent).toFixed(2)}% margin`}
            trend="↑ +8.2%"
            icon="trending-up"
            onPress={() =>
              onOpenDetail({
                metricKey: 'gross_profit',
                title: 'Gross Profit Itemized Breakdown',
                subtitle: 'Gross profit equals net sales minus cost of goods sold.',
                icon: 'trending-up',
                summaryLabel: 'Total Gross Profit',
                summaryValue: formatMoney(report.kpis.grossProfit),
                items: report.sales.topProducts.map((p) => ({
                  id: p.sku,
                  title: p.name,
                  sku: p.sku,
                  note: `${p.quantity} ${p.unit} sold${canViewCost ? ` · Unit Cost: ${formatMoney(p.cost)}` : ''}`,
                  value: formatMoney(p.profit),
                  subValue: `Sales: ${formatMoney(p.sales)}`,
                })),
              })
            }
          />
        ) : null}
        {canViewCost ? (
          <MetricCard
            label="COGS"
            value={formatMoney(report.kpis.netCost)}
            note="Cost of goods sold"
            icon="archive"
            onPress={() =>
              onOpenDetail({
                metricKey: 'cogs',
                title: 'Cost of Goods Sold',
                subtitle: 'Net inventory cost of sold items after return cost reversals.',
                icon: 'archive',
                summaryLabel: 'COGS',
                summaryValue: formatMoney(report.kpis.netCost),
                items: report.sales.topProducts.map((p) => ({
                  id: `cogs-${p.sku}`,
                  title: p.name,
                  sku: p.sku,
                  note: `${p.quantity} ${p.unit} sold`,
                  value: formatMoney(p.cost),
                })),
              })
            }
          />
        ) : null}
        <MetricCard
          label="Transactions"
          value={String(report.kpis.transactions)}
          note={`${formatMoney(report.kpis.averageTransaction)} average`}
          trend="↑ +5.1%"
          icon="file-text"
          tone="blue"
          onPress={() =>
            onOpenDetail({
              metricKey: 'transactions',
              title: 'Sales Checkout Receipt Logs',
              subtitle: 'Total completed sales transactions across payment methods.',
              icon: 'file-text',
              tone: 'blue',
              summaryLabel: 'Completed Transactions',
              summaryValue: `${report.kpis.transactions} sales`,
              items: report.sales.salesReceipts && report.sales.salesReceipts.length > 0
                ? report.sales.salesReceipts.map((sr) => ({
                    id: sr.id,
                    title: `Receipt #${sr.receiptNumber}`,
                    sku: `Method: ${sr.paymentMethod.replaceAll('_', ' ').toUpperCase()}`,
                    category: sr.branchName ?? 'Main Branch',
                    note: `Completed: ${sr.completedAt || 'N/A'} · Cashier: ${sr.cashierName || 'Staff'}`,
                    value: formatMoney(sr.total),
                    statusTag: sr.status.replaceAll('_', ' ').toUpperCase(),
                    statusTone: 'green',
                  }))
                : report.sales.paymentMethods.map((m) => ({
                    id: m.method,
                    title: m.method.replaceAll('_', ' ').toUpperCase(),
                    note: `${m.transactions} checkout payments`,
                    value: formatMoney(m.total),
                  })),
            })
          }
        />
        {canViewCost ? (
          <MetricCard
            label="Inventory value"
            value={formatMoney(report.inventory.inventoryValue)}
            note={`${report.inventory.outOfStockCount} out of stock`}
            icon="package"
            tone="amber"
            onPress={() =>
              onOpenDetail({
                metricKey: 'inventory_value',
                title: 'Inventory Valuation Breakdown',
                subtitle: 'Total peso financial value of current branch inventory.',
                icon: 'package',
                tone: 'amber',
                summaryLabel: 'Total Inventory Valuation',
                summaryValue: formatMoney(report.inventory.inventoryValue),
                items: report.inventory.byCategory.map((c) => ({
                  id: c.name,
                  title: c.name,
                  note: `${c.products} products · ${c.quantity} total stock units`,
                  value: formatMoney(c.value),
                })),
              })
            }
          />
        ) : null}
        <MetricCard
          label="Payables"
          value={formatMoney(report.purchasing.outstandingPayables)}
          note="Current unpaid supplier invoices"
          icon="credit-card"
          tone="red"
          onPress={() =>
            onOpenDetail({
              metricKey: 'payables',
              title: 'Supplier Payables Breakdown',
              subtitle: 'Current unpaid purchase order invoices and supplier accounts payable balance.',
              icon: 'credit-card',
              tone: 'red',
              summaryLabel: 'Outstanding Payables',
              summaryValue: formatMoney(report.purchasing.outstandingPayables),
              items: report.purchasing.payablesInvoices && report.purchasing.payablesInvoices.length > 0
                ? report.purchasing.payablesInvoices.map((inv) => ({
                    id: inv.id,
                    title: inv.supplierName,
                    sku: `Invoice #${inv.invoiceNumber}${inv.poNumber ? ` (PO ${inv.poNumber})` : ''}`,
                    category: inv.branchName ?? 'Main Branch',
                    note: `Issued: ${inv.invoiceDate || 'N/A'} · Due Date: ${inv.dueDate || 'Immediate'}${inv.notes ? ` · Note: ${inv.notes}` : ''}`,
                    value: formatMoney(inv.balance),
                    subValue: `Total Invoice: ${formatMoney(inv.total)} (Paid: ${formatMoney(inv.paidAmount)})`,
                    statusTag: Number(inv.paidAmount) > 0 ? 'Partially Paid' : 'Unpaid Balance',
                    statusTone: Number(inv.paidAmount) > 0 ? 'amber' : 'red',
                  }))
                : report.purchasing.topSuppliers.map((s) => ({
                    id: s.id,
                    title: s.name,
                    note: `${s.orders} purchase orders placed`,
                    value: formatMoney(s.value),
                    statusTag: 'Supplier Account',
                    statusTone: 'red',
                  })),
            })
          }
        />
        <MetricCard
          label="Cash variance"
          value={formatMoney(report.cash.variance)}
          note={`${report.cash.shifts} shifts in period`}
          icon="briefcase"
          tone={Number(report.cash.variance) === 0 ? 'brand' : 'red'}
          onPress={() =>
            onOpenDetail({
              metricKey: 'cash_variance',
              title: 'Cash Shift Accountability Logs',
              subtitle: 'Reconciliation variance between expected and counted register cash.',
              icon: 'briefcase',
              tone: Number(report.cash.variance) === 0 ? 'brand' : 'red',
              summaryLabel: 'Net Cash Variance',
              summaryValue: formatMoney(report.cash.variance),
              items: report.cash.shiftLogs && report.cash.shiftLogs.length > 0
                ? report.cash.shiftLogs.map((shift) => ({
                    id: shift.id,
                    title: shift.cashierName ? `Cashier: ${shift.cashierName}` : `Shift #${shift.id.slice(0, 8)}`,
                    sku: `Register Shift #${shift.id.slice(0, 8)}`,
                    category: shift.branchName ?? 'Main Branch',
                    note: `Opened: ${shift.openedAt || 'N/A'} · Closed: ${shift.closedAt || 'Active Open Shift'}`,
                    value: `Variance: ${formatMoney(shift.variance || '0')}`,
                    subValue: `Counted: ${formatMoney(shift.countedCash || '0')} · Expected: ${formatMoney(shift.expectedCash || '0')}`,
                    statusTag: Number(shift.variance || 0) === 0 ? 'Balanced' : 'Discrepancy',
                    statusTone: Number(shift.variance || 0) === 0 ? 'green' : 'red',
                  }))
                : [
                    { id: '1', title: 'Cash Sales', value: formatMoney(report.cash.cashSales) },
                    { id: '2', title: 'Counted Cash', value: formatMoney(report.cash.countedCash) },
                    { id: '3', title: 'Cash In', value: formatMoney(report.cash.cashIn) },
                    { id: '4', title: 'Cash Out', value: formatMoney(report.cash.cashOut) },
                  ],
            })
          }
        />
      </View>

      {/* Visual Ring Charts Row in Overview */}
      <View className="flex-row flex-wrap gap-4">
        <ResponsivePanel>
          <ReportCard title="Sales by Category Ring Chart" subtitle="Category proportion of gross product sales.">
            <DonutChart
              total={report.sales.topCategories.reduce((sum, c) => sum + c.quantity, 0)}
              totalLabel="Items Sold"
              segments={report.sales.topCategories.slice(0, 5).map((cat, idx) => {
                const totalSales = report.sales.topCategories.reduce((s, c) => s + Number(c.sales), 0) || 1;
                return {
                  label: cat.name,
                  count: cat.quantity,
                  percentage: Math.round((Number(cat.sales) / totalSales) * 100),
                  color: BRAND_COLORS[idx % BRAND_COLORS.length]!,
                };
              })}
            />
          </ReportCard>
        </ResponsivePanel>

        <ResponsivePanel>
          <ReportCard title="Health & Margin Arc Gauges" subtitle="Profit margin and checkout performance.">
            <View className="flex-row flex-wrap gap-3">
              {canViewProfit ? (
                <RadialGauge
                  percentage={Math.round(Number(report.kpis.grossMarginPercent || 0))}
                  label="Gross Margin"
                  valueNote={`${formatMoney(report.kpis.grossProfit)} profit`}
                  color="#1A593B"
                />
              ) : null}
              <RadialGauge
                percentage={Math.round(100 - Number(report.kpis.refundRatePercent || 0))}
                label="Order Success Rate"
                valueNote={`${report.kpis.transactions} checkouts`}
                color="#2D7D54"
              />
            </View>
          </ReportCard>
        </ResponsivePanel>
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

function SalesReport({
  report,
  from,
  to,
  onOpenDetail,
}: {
  report: ReportsWorkspace;
  from: string;
  to: string;
  onOpenDetail(config: MetricDrilldownConfig): void;
}) {
  return (
    <>
      <View className="flex-row flex-wrap gap-3">
        <MetricCard
          label="Gross sales"
          value={formatMoney(report.kpis.grossSales)}
          trend="↑ +14.2%"
          icon="shopping-bag"
          onPress={() =>
            onOpenDetail({
              metricKey: 'gross_sales',
              title: 'Gross Sales Checkout Receipts',
              subtitle: 'Total gross sales before customer refunds and discounts.',
              icon: 'shopping-bag',
              summaryLabel: 'Gross Sales Volume',
              summaryValue: formatMoney(report.kpis.grossSales),
              items: report.sales.salesReceipts && report.sales.salesReceipts.length > 0
                ? report.sales.salesReceipts.map((sr) => ({
                    id: sr.id,
                    title: `Receipt #${sr.receiptNumber}`,
                    sku: `Method: ${sr.paymentMethod.replaceAll('_', ' ').toUpperCase()}`,
                    category: sr.branchName ?? 'Main Branch',
                    note: `Completed: ${sr.completedAt || 'N/A'} · Cashier: ${sr.cashierName || 'Staff'}`,
                    value: formatMoney(sr.total),
                    subValue: `Tax: ${formatMoney(sr.tax || '0')} · Discount: ${formatMoney(sr.discount || '0')}`,
                    statusTag: sr.status.replaceAll('_', ' ').toUpperCase(),
                    statusTone: 'green',
                  }))
                : report.sales.topProducts.map((p) => ({
                    id: p.sku,
                    title: p.name,
                    sku: p.sku,
                    note: `${p.quantity} ${p.unit} sold`,
                    value: formatMoney(p.sales),
                  })),
            })
          }
        />
        <MetricCard
          label="Net sales"
          value={formatMoney(report.kpis.netSales)}
          trend="↑ +12.4%"
          icon="activity"
          onPress={() =>
            onOpenDetail({
              metricKey: 'net_sales',
              title: 'Net Sales Revenue Receipts',
              subtitle: 'Gross sales less customer refunds.',
              icon: 'activity',
              summaryLabel: 'Net Sales Revenue',
              summaryValue: formatMoney(report.kpis.netSales),
              items: report.sales.salesReceipts && report.sales.salesReceipts.length > 0
                ? report.sales.salesReceipts.map((sr) => ({
                    id: sr.id,
                    title: `Receipt #${sr.receiptNumber}`,
                    sku: `Method: ${sr.paymentMethod.replaceAll('_', ' ').toUpperCase()}`,
                    category: sr.branchName ?? 'Main Branch',
                    note: `Completed: ${sr.completedAt || 'N/A'} · Cashier: ${sr.cashierName || 'Staff'}`,
                    value: formatMoney(sr.total),
                    statusTag: 'Net Sale',
                    statusTone: 'green',
                  }))
                : report.sales.topProducts.map((p) => ({
                    id: p.sku,
                    title: p.name,
                    sku: p.sku,
                    note: `${p.quantity} ${p.unit} sold`,
                    value: formatMoney(p.sales),
                  })),
            })
          }
        />
        <MetricCard
          label="Customer refunds"
          value={formatMoney(report.kpis.customerRefunds)}
          note={`${Number(report.kpis.refundRatePercent).toFixed(2)}% of gross sales`}
          icon="corner-up-left"
          tone="red"
          onPress={() =>
            onOpenDetail({
              metricKey: 'customer_refunds',
              title: 'Customer Refunds Details',
              subtitle: 'Total product returns and refunded transactions.',
              icon: 'corner-up-left',
              tone: 'red',
              summaryLabel: 'Total Refund Value',
              summaryValue: formatMoney(report.kpis.customerRefunds),
              items: [
                {
                  id: 'ref-1',
                  title: 'Refunded Transactions Log',
                  note: `${report.kpis.refundRatePercent}% refund rate`,
                  value: formatMoney(report.kpis.customerRefunds),
                  statusTag: 'Refunded',
                  statusTone: 'red',
                },
              ],
            })
          }
        />
        <MetricCard
          label="Average sale"
          value={formatMoney(report.kpis.averageTransaction)}
          icon="bar-chart-2"
          tone="blue"
          onPress={() =>
            onOpenDetail({
              metricKey: 'average_sale',
              title: 'Average Sale Basket Size',
              subtitle: 'Average sales value generated per customer checkout transaction.',
              icon: 'bar-chart-2',
              tone: 'blue',
              summaryLabel: 'Average Transaction Size',
              summaryValue: formatMoney(report.kpis.averageTransaction),
              items: report.sales.branches.map((b) => ({
                id: b.id,
                title: b.name,
                note: `${b.transactions} transactions`,
                value: formatMoney(b.sales),
              })),
            })
          }
        />
        <MetricCard
          label="Items sold"
          value={report.kpis.itemsSold.toLocaleString()}
          icon="box"
          onPress={() =>
            onOpenDetail({
              metricKey: 'items_sold',
              title: 'Items Sold Product Breakdown',
              subtitle: 'Total physical product units sold during this period.',
              icon: 'box',
              summaryLabel: 'Total Product Quantity Sold',
              summaryValue: `${report.kpis.itemsSold.toLocaleString()} units`,
              items: report.sales.topProducts.map((p) => ({
                id: p.sku,
                title: p.name,
                sku: p.sku,
                note: `Unit: ${p.unit}`,
                value: `${p.quantity} ${p.unit}`,
                subValue: formatMoney(p.sales),
              })),
            })
          }
        />
        <MetricCard
          label="Known customers"
          value={String(report.kpis.uniqueCustomers)}
          icon="users"
          tone="amber"
          onPress={() =>
            onOpenDetail({
              metricKey: 'known_customers',
              title: 'Customer Checkouts Details',
              subtitle: 'Number of registered unique customers served.',
              icon: 'users',
              tone: 'amber',
              summaryLabel: 'Unique Customers Served',
              summaryValue: `${report.kpis.uniqueCustomers} customers`,
              items: [
                {
                  id: 'cust-1',
                  title: 'Registered Customer Checkouts',
                  note: 'Recorded at checkout',
                  value: `${report.kpis.uniqueCustomers} customers`,
                },
              ],
            })
          }
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

function ProductPerformanceReport({
  report,
  onOpenDetail,
}: {
  report: {
    title: string;
    summaryCards: Array<{
      cardId: string;
      label: string;
      formattedValue: string;
      value: number | string | null;
      isSensitive?: boolean;
    }>;
    rows: Array<{
      id: string;
      title: string;
      quantity?: number;
      unit?: string;
      baseQuantity?: number;
      baseUnit?: string;
      value: string;
      subValue?: string;
    }>;
  };
  onOpenDetail(config: MetricDrilldownConfig): void;
}) {
  return (
    <>
      <ReportCard title={report.title || 'Product Performance'} subtitle="Selling-unit volume and revenue by product.">
        <View className="flex-row flex-wrap gap-3">
          {report.summaryCards
            .filter((card) => !card.isSensitive)
            .slice(0, 6)
            .map((card) => (
              <MetricCard
                key={card.cardId}
                label={card.label}
                value={card.formattedValue}
                icon="tag"
                onPress={() =>
                  onOpenDetail({
                    metricKey: card.cardId,
                    title: card.label,
                    subtitle: 'Product performance drill-down',
                    icon: 'tag',
                    summaryLabel: card.label,
                    summaryValue: card.formattedValue,
                    items: report.rows.map((row) => ({
                      id: row.id + String(row.unit ?? ''),
                      title: row.title,
                      value: row.value,
                      subValue: row.subValue,
                      quantity: row.quantity,
                      unit: row.unit,
                    })),
                  })
                }
              />
            ))}
        </View>
      </ReportCard>
      <ReportCard title="Product unit breakdown" subtitle="Piece and Box remain separate selling units.">
        {report.rows.length === 0 ? (
          <Text className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
            No product sales for this period.
          </Text>
        ) : (
          <View className="gap-3">
            {report.rows.map((row) => (
              <View
                key={`${row.id}-${row.unit ?? 'unit'}`}
                className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3"
              >
                <View className="flex-row items-center justify-between gap-3">
                  <View className="flex-1">
                    <Text className="text-sm font-medium text-slate-900">{row.title}</Text>
                    <Text className="mt-0.5 text-xs text-slate-500">
                      {row.subValue ||
                        `${row.quantity ?? 0} ${row.unit ?? ''} (${row.baseQuantity ?? 0} ${row.baseUnit ?? 'base'})`}
                    </Text>
                  </View>
                  <Text className="text-sm font-semibold text-slate-950">{row.value}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ReportCard>
    </>
  );
}

function InventoryReport({
  report,
  productsList,
  onOpenDetail,
}: {
  report: ReportsWorkspace;
  productsList: any[];
  onOpenDetail(config: MetricDrilldownConfig): void;
}) {
  return (
    <>
      <View className="flex-row flex-wrap gap-3">
        <MetricCard
          label="Inventory value"
          value={formatMoney(report.inventory.inventoryValue)}
          icon="archive"
          onPress={() =>
            onOpenDetail({
              metricKey: 'inventory_value',
              title: 'Inventory Valuation Itemized Breakdown',
              subtitle: 'Itemized list of products sorted by total inventory valuation.',
              icon: 'archive',
              summaryLabel: 'Total Branch Valuation',
              summaryValue: formatMoney(report.inventory.inventoryValue),
              categoriesSummary: report.inventory.byCategory.map((c) => ({
                name: c.name,
                value: Number(c.value),
                display: formatMoney(c.value),
              })),
              items: productsList
                .filter((p) => (p.availableQuantity ?? 0) > 0)
                .map((p) => {
                  const qty = p.availableQuantity ?? 0;
                  const cost = Number(p.averageCost || p.cost || 0);
                  const totalVal = qty * cost;
                  return {
                    id: p.id,
                    title: p.name,
                    sku: p.sku,
                    category: p.categoryName ?? 'Uncategorized',
                    quantity: qty,
                    unit: p.unit,
                    note: `${qty} ${p.unit ?? 'pcs'} · Avg cost: ${formatMoney(String(cost))}`,
                    value: formatMoney(String(totalVal)),
                    statusTag: p.status === 'active' ? 'Active' : 'Hidden',
                    statusTone: (p.status === 'active' ? 'green' : 'slate') as 'green' | 'slate',
                  };
                })
                .sort((a, b) => parseFloat(b.value.replace(/[^0-9.]/g, '') || '0') - parseFloat(a.value.replace(/[^0-9.]/g, '') || '0')),
            })
          }
        />
        <MetricCard
          label="Total stock count (Units on hand)"
          value={report.inventory.unitsOnHand.toLocaleString()}
          icon="package"
          tone="blue"
          onPress={() =>
            onOpenDetail({
              metricKey: 'units_on_hand',
              title: 'Total Stock Count (Units on Hand)',
              subtitle: 'Combined physical inventory quantities of all items currently in stock.',
              icon: 'package',
              tone: 'blue',
              summaryLabel: 'Total Stock Units',
              summaryValue: `${report.inventory.unitsOnHand.toLocaleString()} units`,
              categoriesSummary: report.inventory.byCategory.map((c) => ({
                name: c.name,
                value: c.quantity,
                display: `${c.quantity.toLocaleString()} units`,
              })),
              items: productsList
                .map((p) => ({
                  id: p.id,
                  title: p.name,
                  sku: p.sku,
                  category: p.categoryName ?? 'Uncategorized',
                  note: `Unit: ${p.unit ?? 'piece'} · Cost: ${formatMoney(String(p.averageCost || p.cost || 0))}`,
                  value: `${(p.availableQuantity ?? 0).toLocaleString()} ${p.unit ?? 'pcs'}`,
                  subValue: formatMoney(String((p.availableQuantity ?? 0) * Number(p.averageCost || p.cost || 0))),
                  statusTag: (p.availableQuantity ?? 0) <= 0 ? 'Out of Stock' : (p.availableQuantity ?? 0) <= (p.lowStockThreshold ?? 5) ? 'Low Stock' : 'In Stock',
                  statusTone: ((p.availableQuantity ?? 0) <= 0 ? 'red' : (p.availableQuantity ?? 0) <= (p.lowStockThreshold ?? 5) ? 'amber' : 'green') as 'red' | 'amber' | 'green',
                }))
                .sort((a, b) => parseFloat(b.value.replace(/[^0-9.]/g, '') || '0') - parseFloat(a.value.replace(/[^0-9.]/g, '') || '0')),
            })
          }
        />
        <MetricCard
          label="Active products"
          value={String(report.inventory.activeProducts)}
          icon="tag"
          onPress={() =>
            onOpenDetail({
              metricKey: 'active_products',
              title: 'Active Products Catalog',
              subtitle: 'Products currently enabled and available on the POS cash register screen.',
              icon: 'tag',
              summaryLabel: 'Active Catalog Items',
              summaryValue: `${report.inventory.activeProducts} products`,
              items: productsList
                .filter((p) => p.status === 'active')
                .map((p) => ({
                  id: p.id,
                  title: p.name,
                  sku: p.sku,
                  category: p.categoryName ?? 'Uncategorized',
                  note: `Price: ${formatMoney(p.sellingPrice)}`,
                  value: `${p.availableQuantity ?? 0} ${p.unit ?? 'pcs'}`,
                  statusTag: 'Active (On POS)',
                  statusTone: 'green',
                })),
            })
          }
        />
        <MetricCard
          label="Low stock"
          value={String(report.inventory.lowStockCount)}
          icon="alert-triangle"
          tone="amber"
          onPress={() =>
            onOpenDetail({
              metricKey: 'low_stock',
              title: 'Low Stock Alert Items',
              subtitle: 'Products at or below their configured reorder alert thresholds.',
              icon: 'alert-triangle',
              tone: 'amber',
              summaryLabel: 'Low Stock Alert Items',
              summaryValue: `${report.inventory.lowStockCount} items`,
              items: report.inventory.lowStock
                .filter((item) => item.quantity > 0)
                .map((item) => ({
                  id: item.id,
                  title: item.name,
                  sku: item.sku,
                  note: `Alert limit: ${item.lowStockLevel} ${item.unit}`,
                  value: `${item.quantity} ${item.unit}`,
                  subValue: formatMoney(item.inventoryValue),
                  statusTag: 'Low Stock',
                  statusTone: 'amber',
                })),
            })
          }
        />
        <MetricCard
          label="Out of stock"
          value={String(report.inventory.outOfStockCount)}
          icon="x-circle"
          tone="red"
          onPress={() =>
            onOpenDetail({
              metricKey: 'out_of_stock',
              title: 'Out of Stock Items',
              subtitle: 'Products with zero (0) stock remaining in branch inventory.',
              icon: 'x-circle',
              tone: 'red',
              summaryLabel: 'Out of Stock Items',
              summaryValue: `${report.inventory.outOfStockCount} items`,
              items: report.inventory.lowStock
                .filter((item) => item.quantity <= 0)
                .map((item) => ({
                  id: item.id,
                  title: item.name,
                  sku: item.sku,
                  note: `Zero stock remaining`,
                  value: `0 ${item.unit}`,
                  statusTag: 'Out of Stock',
                  statusTone: 'red',
                })),
            })
          }
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

function PurchasingReport({
  report,
  onOpenDetail,
}: {
  report: ReportsWorkspace;
  onOpenDetail(config: MetricDrilldownConfig): void;
}) {
  return (
    <>
      <View className="flex-row flex-wrap gap-3">
        <MetricCard
          label="Ordered value"
          value={formatMoney(report.purchasing.orderedValue)}
          icon="clipboard"
          onPress={() =>
            onOpenDetail({
              metricKey: 'ordered_value',
              title: 'Ordered Purchase Value Details',
              subtitle: 'Total purchase order value issued to suppliers.',
              icon: 'clipboard',
              summaryLabel: 'Total PO Value Ordered',
              summaryValue: formatMoney(report.purchasing.orderedValue),
              items: report.purchasing.purchaseOrdersList && report.purchasing.purchaseOrdersList.length > 0
                ? report.purchasing.purchaseOrdersList.map((po) => ({
                    id: po.id,
                    title: po.supplierName,
                    sku: `PO #${po.poNumber}`,
                    category: po.branchName ?? 'Main Branch',
                    note: `Order Date: ${po.orderDate || 'N/A'}`,
                    value: formatMoney(po.total),
                    statusTag: po.status.replaceAll('_', ' ').toUpperCase(),
                    statusTone: po.status === 'received' || po.status === 'completed' ? 'green' : po.status === 'ordered' || po.status === 'partially_received' ? 'amber' : 'slate',
                  }))
                : report.purchasing.topSuppliers.map((s) => ({
                    id: s.id,
                    title: s.name,
                    note: `${s.orders} purchase orders`,
                    value: formatMoney(s.value),
                  })),
            })
          }
        />
        <MetricCard
          label="Received value"
          value={formatMoney(report.purchasing.receivedValue)}
          icon="download"
          tone="blue"
          onPress={() =>
            onOpenDetail({
              metricKey: 'received_value',
              title: 'Received Purchase Value Details',
              subtitle: 'Total value of supplier stock orders received and checked into inventory.',
              icon: 'download',
              tone: 'blue',
              summaryLabel: 'Total Stock Received Value',
              summaryValue: formatMoney(report.purchasing.receivedValue),
              items: report.purchasing.orderStatuses.map((os) => ({
                id: os.status,
                title: os.status.replaceAll('_', ' ').toUpperCase(),
                note: `${os.orders} orders`,
                value: formatMoney(os.value),
              })),
            })
          }
        />
        <MetricCard
          label="Open orders"
          value={String(report.purchasing.openOrders)}
          note={`${report.purchasing.purchaseOrders} orders created`}
          icon="truck"
          tone="amber"
          onPress={() =>
            onOpenDetail({
              metricKey: 'open_orders',
              title: 'Open Supplier Orders Details',
              subtitle: 'Purchase orders currently pending delivery or partial receipt.',
              icon: 'truck',
              tone: 'amber',
              summaryLabel: 'Pending Open Orders',
              summaryValue: `${report.purchasing.openOrders} open orders`,
              items: report.purchasing.purchaseOrdersList && report.purchasing.purchaseOrdersList.length > 0
                ? report.purchasing.purchaseOrdersList
                    .filter((po) => po.status === 'ordered' || po.status === 'partially_received')
                    .map((po) => ({
                      id: po.id,
                      title: po.supplierName,
                      sku: `PO #${po.poNumber}`,
                      category: po.branchName ?? 'Main Branch',
                      note: `Date: ${po.orderDate || 'N/A'}`,
                      value: formatMoney(po.total),
                      statusTag: po.status.replaceAll('_', ' ').toUpperCase(),
                      statusTone: 'amber',
                    }))
                : report.purchasing.orderStatuses.map((os) => ({
                    id: os.status,
                    title: os.status.replaceAll('_', ' ').toUpperCase(),
                    note: `${os.orders} total orders`,
                    value: formatMoney(os.value),
                  })),
            })
          }
        />
        <MetricCard
          label="Outstanding payables"
          value={formatMoney(report.purchasing.outstandingPayables)}
          note="Current unpaid supplier invoices"
          icon="credit-card"
          tone="red"
          onPress={() =>
            onOpenDetail({
              metricKey: 'outstanding_payables',
              title: 'Supplier Payables Breakdown',
              subtitle: 'Current unpaid purchase order invoices and supplier accounts payable balance.',
              icon: 'credit-card',
              tone: 'red',
              summaryLabel: 'Outstanding Payables',
              summaryValue: formatMoney(report.purchasing.outstandingPayables),
              items: report.purchasing.payablesInvoices && report.purchasing.payablesInvoices.length > 0
                ? report.purchasing.payablesInvoices.map((inv) => ({
                    id: inv.id,
                    title: inv.supplierName,
                    sku: `Invoice #${inv.invoiceNumber}${inv.poNumber ? ` (PO ${inv.poNumber})` : ''}`,
                    category: inv.branchName ?? 'Main Branch',
                    note: `Issued: ${inv.invoiceDate || 'N/A'} · Due Date: ${inv.dueDate || 'Immediate'}${inv.notes ? ` · Note: ${inv.notes}` : ''}`,
                    value: formatMoney(inv.balance),
                    subValue: `Total Invoice: ${formatMoney(inv.total)} (Paid: ${formatMoney(inv.paidAmount)})`,
                    statusTag: Number(inv.paidAmount) > 0 ? 'Partially Paid' : 'Unpaid Balance',
                    statusTone: Number(inv.paidAmount) > 0 ? 'amber' : 'red',
                  }))
                : report.purchasing.topSuppliers.map((s) => ({
                    id: s.id,
                    title: s.name,
                    note: `${s.orders} purchase orders placed`,
                    value: formatMoney(s.value),
                    statusTag: 'Supplier Account',
                    statusTone: 'red',
                  })),
            })
          }
        />
        <MetricCard
          label="Supplier payments"
          value={formatMoney(report.purchasing.supplierPayments)}
          icon="arrow-up-right"
          onPress={() =>
            onOpenDetail({
              metricKey: 'supplier_payments',
              title: 'Supplier Payments Log Details',
              subtitle: 'Total cash/bank disbursements made to suppliers.',
              icon: 'arrow-up-right',
              summaryLabel: 'Total Payments Paid',
              summaryValue: formatMoney(report.purchasing.supplierPayments),
              items: report.purchasing.topSuppliers.map((s) => ({
                id: s.id,
                title: s.name,
                value: formatMoney(s.value),
              })),
            })
          }
        />
        <MetricCard
          label="Supplier returns"
          value={formatMoney(report.purchasing.supplierReturns)}
          note={`${formatMoney(report.purchasing.supplierRefunds)} received back`}
          icon="corner-up-left"
          tone="red"
          onPress={() =>
            onOpenDetail({
              metricKey: 'supplier_returns',
              title: 'Supplier Returns & Refunds Details',
              subtitle: 'Returned damaged/rejected supplier goods.',
              icon: 'corner-up-left',
              tone: 'red',
              summaryLabel: 'Total Goods Returned',
              summaryValue: formatMoney(report.purchasing.supplierReturns),
              items: [
                {
                  id: 'ret-1',
                  title: 'Supplier Returns Value',
                  value: formatMoney(report.purchasing.supplierReturns),
                  subValue: `Refunded: ${formatMoney(report.purchasing.supplierRefunds)}`,
                },
              ],
            })
          }
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

function ProfitReport({
  report,
  onOpenDetail,
}: {
  report: ReportsWorkspace;
  onOpenDetail(config: MetricDrilldownConfig): void;
}) {
  return (
    <>
      <View className="flex-row flex-wrap gap-3">
        <MetricCard
          label="Gross sales"
          value={formatMoney(report.profit.grossSales)}
          icon="shopping-bag"
          onPress={() =>
            onOpenDetail({
              metricKey: 'gross_sales',
              title: 'Gross Sales Profitability Breakdown',
              subtitle: 'Total sales revenue before deducting cost of goods and refunds.',
              icon: 'shopping-bag',
              summaryLabel: 'Gross Sales Revenue',
              summaryValue: formatMoney(report.profit.grossSales),
              items: report.profit.trend.map((t) => ({
                id: t.date,
                title: new Date(`${t.date}T12:00:00`).toLocaleDateString(),
                note: `Net cost: ${formatMoney(t.netCost)}`,
                value: formatMoney(t.netSales),
                subValue: `Profit: ${formatMoney(t.profit)}`,
              })),
            })
          }
        />
        <MetricCard
          label="Refunds"
          value={formatMoney(report.profit.refunds)}
          icon="corner-up-left"
          tone="red"
          onPress={() =>
            onOpenDetail({
              metricKey: 'refunds',
              title: 'Customer Sales Refunds Details',
              subtitle: 'Total refunds deducted from gross revenue.',
              icon: 'corner-up-left',
              tone: 'red',
              summaryLabel: 'Total Refund Deduction',
              summaryValue: formatMoney(report.profit.refunds),
              items: [
                {
                  id: 'prof-ref-1',
                  title: 'Refunded Sales Transactions',
                  value: formatMoney(report.profit.refunds),
                },
              ],
            })
          }
        />
        <MetricCard
          label="Net sales"
          value={formatMoney(report.profit.netSales)}
          icon="activity"
          onPress={() =>
            onOpenDetail({
              metricKey: 'net_sales',
              title: 'Net Sales Revenue Details',
              subtitle: 'Gross sales minus customer returns.',
              icon: 'activity',
              summaryLabel: 'Net Revenue',
              summaryValue: formatMoney(report.profit.netSales),
              items: report.profit.trend.map((t) => ({
                id: t.date,
                title: new Date(`${t.date}T12:00:00`).toLocaleDateString(),
                value: formatMoney(t.netSales),
              })),
            })
          }
        />
        <MetricCard
          label="Net cost of goods"
          value={formatMoney(report.profit.netCost)}
          icon="package"
          tone="amber"
          onPress={() =>
            onOpenDetail({
              metricKey: 'net_cost',
              title: 'Net Cost of Goods Sold (COGS) Details',
              subtitle: 'Total supplier cost of products sold during this period.',
              icon: 'package',
              tone: 'amber',
              summaryLabel: 'Cost of Goods Sold',
              summaryValue: formatMoney(report.profit.netCost),
              items: report.profit.trend.map((t) => ({
                id: t.date,
                title: new Date(`${t.date}T12:00:00`).toLocaleDateString(),
                value: formatMoney(t.netCost),
              })),
            })
          }
        />
        <MetricCard
          label="Gross profit"
          value={formatMoney(report.profit.grossProfit)}
          icon="trending-up"
          onPress={() =>
            onOpenDetail({
              metricKey: 'gross_profit',
              title: 'Gross Profit Breakdown Details',
              subtitle: 'Net sales revenue minus cost of goods sold.',
              icon: 'trending-up',
              summaryLabel: 'Total Gross Profit',
              summaryValue: formatMoney(report.profit.grossProfit),
              items: report.profit.trend.map((t) => ({
                id: t.date,
                title: new Date(`${t.date}T12:00:00`).toLocaleDateString(),
                note: `Sales: ${formatMoney(t.netSales)} · Cost: ${formatMoney(t.netCost)}`,
                value: formatMoney(t.profit),
              })),
            })
          }
        />
        <MetricCard
          label="Gross margin"
          value={`${Number(report.profit.grossMarginPercent).toFixed(2)}%`}
          icon="percent"
          tone="blue"
          onPress={() =>
            onOpenDetail({
              metricKey: 'gross_margin',
              title: 'Gross Profit Margin Percentage Details',
              subtitle: 'Percentage of revenue retained after deducting cost of goods.',
              icon: 'percent',
              tone: 'blue',
              summaryLabel: 'Gross Margin Rate',
              summaryValue: `${Number(report.profit.grossMarginPercent).toFixed(2)}%`,
              items: [
                { id: '1', title: 'Net Sales', value: formatMoney(report.profit.netSales) },
                { id: '2', title: 'Cost of Goods Sold', value: formatMoney(report.profit.netCost) },
                { id: '3', title: 'Gross Profit', value: formatMoney(report.profit.grossProfit) },
              ],
            })
          }
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

function CashReport({
  report,
  onOpenDetail,
}: {
  report: ReportsWorkspace;
  onOpenDetail(config: MetricDrilldownConfig): void;
}) {
  return (
    <>
      <View className="flex-row flex-wrap gap-3">
        <MetricCard
          label="Cash sales"
          value={formatMoney(report.cash.cashSales)}
          icon="dollar-sign"
          onPress={() =>
            onOpenDetail({
              metricKey: 'cash_sales',
              title: 'Cash Sales Revenue Logs',
              subtitle: 'Total cash payments collected at register drawers.',
              icon: 'dollar-sign',
              summaryLabel: 'Total Cash Collected',
              summaryValue: formatMoney(report.cash.cashSales),
              items: report.cash.shiftLogs && report.cash.shiftLogs.length > 0
                ? report.cash.shiftLogs.map((shift) => ({
                    id: shift.id,
                    title: shift.cashierName ? `Cashier: ${shift.cashierName}` : `Shift #${shift.id.slice(0, 8)}`,
                    sku: `Shift #${shift.id.slice(0, 8)}`,
                    category: shift.branchName ?? 'Main Branch',
                    note: `Opened: ${shift.openedAt || 'N/A'}`,
                    value: formatMoney(shift.cashSales || '0'),
                    statusTag: 'Cash Register',
                    statusTone: 'green',
                  }))
                : [
                    { id: 'c-1', title: 'Cash Register Sales', value: formatMoney(report.cash.cashSales) },
                  ],
            })
          }
        />
        <MetricCard
          label="Cash refunds"
          value={formatMoney(report.cash.cashRefunds)}
          icon="corner-up-left"
          tone="red"
          onPress={() =>
            onOpenDetail({
              metricKey: 'cash_refunds',
              title: 'Cash Register Refunds Details',
              subtitle: 'Cash paid out to customers for returned goods.',
              icon: 'corner-up-left',
              tone: 'red',
              summaryLabel: 'Total Cash Refunds Paid',
              summaryValue: formatMoney(report.cash.cashRefunds),
              items: [
                { id: 'c-ref-1', title: 'Cash Refunds Paid', value: formatMoney(report.cash.cashRefunds) },
              ],
            })
          }
        />
        <MetricCard
          label="Cash in"
          value={formatMoney(report.cash.cashIn)}
          icon="log-in"
          onPress={() =>
            onOpenDetail({
              metricKey: 'cash_in',
              title: 'Cash Paid In Details',
              subtitle: 'Additional cash added to registers during active shifts.',
              icon: 'log-in',
              summaryLabel: 'Total Cash In',
              summaryValue: formatMoney(report.cash.cashIn),
              items: [
                { id: 'cin-1', title: 'Shift Cash Additions', value: formatMoney(report.cash.cashIn) },
              ],
            })
          }
        />
        <MetricCard
          label="Cash out"
          value={formatMoney(report.cash.cashOut)}
          icon="log-out"
          tone="amber"
          onPress={() =>
            onOpenDetail({
              metricKey: 'cash_out',
              title: 'Cash Removed (Pay Out) Details',
              subtitle: 'Cash removed from registers for petty cash or bank drops.',
              icon: 'log-out',
              tone: 'amber',
              summaryLabel: 'Total Cash Out',
              summaryValue: formatMoney(report.cash.cashOut),
              items: [
                { id: 'cout-1', title: 'Shift Cash Removals', value: formatMoney(report.cash.cashOut) },
              ],
            })
          }
        />
        <MetricCard
          label="Counted cash"
          value={formatMoney(report.cash.countedCash)}
          icon="briefcase"
          tone="blue"
          onPress={() =>
            onOpenDetail({
              metricKey: 'counted_cash',
              title: 'Counted Register Cash Shift Logs',
              subtitle: 'Physical cash entered by cashiers during shift closing.',
              icon: 'briefcase',
              tone: 'blue',
              summaryLabel: 'Physical Counted Cash',
              summaryValue: formatMoney(report.cash.countedCash),
              items: report.cash.shiftLogs && report.cash.shiftLogs.length > 0
                ? report.cash.shiftLogs.map((shift) => ({
                    id: shift.id,
                    title: shift.cashierName ? `Cashier: ${shift.cashierName}` : `Shift #${shift.id.slice(0, 8)}`,
                    sku: `Shift #${shift.id.slice(0, 8)}`,
                    category: shift.branchName ?? 'Main Branch',
                    note: `Opened: ${shift.openedAt || 'N/A'} · Closed: ${shift.closedAt || 'Active'}`,
                    value: formatMoney(shift.countedCash || '0'),
                    subValue: `Expected: ${formatMoney(shift.expectedCash || '0')}`,
                    statusTag: 'Counted Cash',
                    statusTone: 'green',
                  }))
                : [
                    { id: 'ccount-1', title: 'Physical Counted Cash', value: formatMoney(report.cash.countedCash) },
                  ],
            })
          }
        />
        <MetricCard
          label="Variance"
          value={formatMoney(report.cash.variance)}
          note={`${report.cash.openShifts} open of ${report.cash.shifts} shifts`}
          icon="alert-circle"
          tone={Number(report.cash.variance) === 0 ? 'brand' : 'red'}
          onPress={() =>
            onOpenDetail({
              metricKey: 'variance',
              title: 'Cash Register Variance Shift Logs',
              subtitle: 'Difference between expected drawer cash and physical counted cash.',
              icon: 'alert-circle',
              tone: Number(report.cash.variance) === 0 ? 'brand' : 'red',
              summaryLabel: 'Total Shift Cash Discrepancy',
              summaryValue: formatMoney(report.cash.variance),
              items: report.cash.shiftLogs && report.cash.shiftLogs.length > 0
                ? report.cash.shiftLogs.map((shift) => ({
                    id: shift.id,
                    title: shift.cashierName ? `Cashier: ${shift.cashierName}` : `Shift #${shift.id.slice(0, 8)}`,
                    sku: `Shift #${shift.id.slice(0, 8)}`,
                    category: shift.branchName ?? 'Main Branch',
                    note: `Opened: ${shift.openedAt || 'N/A'} · Closed: ${shift.closedAt || 'Active'}`,
                    value: `Variance: ${formatMoney(shift.variance || '0')}`,
                    subValue: `Counted: ${formatMoney(shift.countedCash || '0')} · Expected: ${formatMoney(shift.expectedCash || '0')}`,
                    statusTag: Number(shift.variance || 0) === 0 ? 'Balanced' : 'Discrepancy',
                    statusTone: Number(shift.variance || 0) === 0 ? 'green' : 'red',
                  }))
                : [
                    { id: 'v-1', title: 'Shifts Analyzed', value: `${report.cash.shifts} shifts (${report.cash.openShifts} open)` },
                    { id: 'v-2', title: 'Total Discrepancy Variance', value: formatMoney(report.cash.variance) },
                  ],
            })
          }
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

function ReportsContent({ initialSection = 'sales' }: { initialSection?: ReportSection }) {
  const { width } = useWindowDimensions();
  const phone = width < 640;
  const workspaceMaxWidth =
    width >= 3000 ? 2600 : width >= 2200 ? 2000 : width >= 1440 ? 1440 : 1200;
  const branch = useBranchStore((state) => state.activeBranch);
  const { currentUser, session, loading: sessionLoading } = useSession();
  const canViewProfit = (currentUser?.permissions ?? []).includes('reports:view_profit');
  const visibleSections = useMemo(
    () => SECTIONS.filter((item) => item.key !== 'profit' || canViewProfit),
    [canViewProfit],
  );
  const defaultCustomRange = useMemo(() => {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 29);
    return { from: localDateInput(from), to: localDateInput(to) };
  }, []);
  const [period, setPeriod] = useState<ReportPeriod>('30d');
  const [section, setSection] = useState<ReportSection>(initialSection);
  const [dateRangeVisible, setDateRangeVisible] = useState(false);
  const [customRange, setCustomRange] = useState(defaultCustomRange);
  const [draftFrom, setDraftFrom] = useState(defaultCustomRange.from);
  const [draftTo, setDraftTo] = useState(defaultCustomRange.to);
  const [dateRangeError, setDateRangeError] = useState('');

  const [activeMetricDrilldown, setActiveMetricDrilldown] = useState<MetricDrilldownConfig | null>(null);

  const handleOpenDetail = (config: MetricDrilldownConfig) => {
    setActiveMetricDrilldown(config);
  };

  const range = useMemo(() => {
    if (period === 'custom') {
      const from = dateAtLocalMidnight(customRange.from);
      const to = dateAtLocalMidnight(customRange.to);
      to.setDate(to.getDate() + 1);
      return { from: from.toISOString(), to: to.toISOString() };
    }
    const preset = PERIOD_PRESETS.find((p) => p.key === period);
    const r = preset ? preset.getRange() : PERIOD_PRESETS[3].getRange();
    const from = dateAtLocalMidnight(r.from);
    const to = dateAtLocalMidnight(r.to);
    to.setDate(to.getDate() + 1);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [customRange.from, customRange.to, period]);

  const rangeLabel = useMemo(() => readableDateRange(range.from, range.to), [range.from, range.to]);

  const query = useQuery({
    queryKey: ['reports-workspace', period, branch?.id, range.from, range.to, session?.user?.id],
    enabled: !sessionLoading && Boolean(session?.access_token),
    queryFn: () =>
      api<ReportsWorkspace>(
        `/reports/workspace?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(
          range.to,
        )}${branch?.id ? `&branchId=${branch.id}` : ''}`,
      ),
  });

  const productsQuery = useQuery({
    queryKey: ['reports-products-list', branch?.id, session?.user?.id],
    enabled: !sessionLoading && Boolean(session?.access_token) && Boolean(branch?.id),
    queryFn: () =>
      api<any[]>(`/products?branchId=${branch!.id}&includeInactive=true&pageSize=100`),
  });

  const productPerformanceQuery = useQuery({
    queryKey: ['reports-product-performance', period, branch?.id, range.from, range.to, session?.user?.id],
    enabled: !sessionLoading && Boolean(session?.access_token) && section === 'products',
    queryFn: () => {
      const fromDate = range.from.slice(0, 10);
      const exclusiveEnd = new Date(range.to);
      exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() - 1);
      const toDate = exclusiveEnd.toISOString().slice(0, 10);
      return api<{
        title: string;
        summaryCards: Array<{
          cardId: string;
          label: string;
          formattedValue: string;
          value: number | string | null;
          isSensitive?: boolean;
        }>;
        rows: Array<{
          id: string;
          title: string;
          quantity?: number;
          unit?: string;
          baseQuantity?: number;
          baseUnit?: string;
          value: string;
          subValue?: string;
        }>;
      }>(
        `/reports/products?from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}${
          branch?.id ? `&branchId=${branch.id}` : ''
        }`,
      );
    },
  });


  return (
    <Screen>
      <Header
        title={activeMetricDrilldown ? activeMetricDrilldown.title : 'Reports'}
        subtitle={`${rangeLabel} · ${branch?.name ?? 'All accessible branches'}`}
        showBack={!phone}
        backLabel="More"
        fallbackHref="/(tabs)/more"
        action={null}
      />
      <ScrollView contentContainerClassName="items-center p-4 pb-12">
        <View className="w-full gap-4" style={{ maxWidth: workspaceMaxWidth }}>
          {activeMetricDrilldown ? (
            <MetricDrilldownView
              config={activeMetricDrilldown}
              rangeLabel={rangeLabel}
              branchName={branch?.name ?? 'All accessible branches'}
              organizationName={currentUser?.organization.name ?? 'Ximo POS'}
              onBack={() => setActiveMetricDrilldown(null)}
            />
          ) : (
            <>
              <View className="rounded-2xl border border-slate-200 bg-white p-3">
                <View className="flex-row flex-wrap gap-2">
                  {PERIOD_PRESETS.slice(0, 4).map((item) => {
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
                    accessibilityState={{ selected: period === 'custom' || ['this_month', 'last_month', 'all'].includes(period) }}
                    onPress={() => {
                      setDraftFrom(customRange.from);
                      setDraftTo(customRange.to);
                      setDateRangeError('');
                      setDateRangeVisible(true);
                    }}
                    className={`min-h-11 flex-row items-center justify-center rounded-xl px-4 ${
                      period === 'custom' || ['this_month', 'last_month', 'all'].includes(period) ? 'bg-brand-700' : 'bg-slate-50 active:bg-brand-50'
                    }`}
                    style={{ minWidth: phone ? 120 : 145, flexBasis: phone ? 120 : 0, flexGrow: 1 }}
                  >
                    <Feather
                      name="calendar"
                      size={15}
                      color={period === 'custom' || ['this_month', 'last_month', 'all'].includes(period) ? '#FFFFFF' : '#81776E'}
                    />
                    <Text
                      className={`ml-2 text-sm font-medium ${
                        period === 'custom' || ['this_month', 'last_month', 'all'].includes(period) ? 'text-white' : 'text-slate-600'
                      }`}
                    >
                      {rangeLabel} 📅
                    </Text>
                  </Pressable>
                </View>
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View className="flex-row gap-2">
                  {visibleSections.map((item) => {
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
                    <OverviewReport report={query.data} setSection={setSection} onOpenDetail={handleOpenDetail} />
                  ) : null}
                  {section === 'sales' ? (
                    <SalesReport report={query.data} from={range.from} to={range.to} onOpenDetail={handleOpenDetail} />
                  ) : null}
                  {section === 'products' ? (
                    productPerformanceQuery.isLoading ? (
                      <LoadingState label="Loading product performance…" />
                    ) : productPerformanceQuery.isError ? (
                      <ErrorState
                        message={productPerformanceQuery.error.message}
                        retry={() => void productPerformanceQuery.refetch()}
                      />
                    ) : productPerformanceQuery.data ? (
                      <ProductPerformanceReport
                        report={productPerformanceQuery.data}
                        onOpenDetail={handleOpenDetail}
                      />
                    ) : null
                  ) : null}
                  {section === 'inventory' ? (
                    <InventoryReport
                      report={query.data}
                      productsList={productsQuery.data ?? []}
                      onOpenDetail={handleOpenDetail}
                    />
                  ) : null}
                  {section === 'purchasing' ? (
                    <PurchasingReport report={query.data} onOpenDetail={handleOpenDetail} />
                  ) : null}
                  {section === 'profit' ? (
                    <ProfitReport report={query.data} onOpenDetail={handleOpenDetail} />
                  ) : null}
                  {section === 'cash' ? (
                    <CashReport report={query.data} onOpenDetail={handleOpenDetail} />
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </View>
      </ScrollView>

      {/* Calendar Date Range Modal */}
      <Modal
        visible={dateRangeVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDateRangeVisible(false)}
      >
        <View className="flex-1 items-center justify-center bg-black/50 p-4 sm:p-6">
          <View className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
            <View className="mb-4 flex-row items-start justify-between">
              <View className="flex-row items-start flex-1">
                <View className="mr-3 h-12 w-12 items-center justify-center rounded-2xl bg-brand-50">
                  <Feather name="calendar" size={22} color="#1A593B" />
                </View>
                <View className="flex-1">
                  <Text className="text-xl font-bold text-slate-950">Select Report Period</Text>
                  <Text className="mt-1 text-xs text-slate-500">
                    Pick a preset range or enter custom start and end dates.
                  </Text>
                </View>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => setDateRangeVisible(false)}
                className="h-9 w-9 items-center justify-center rounded-xl bg-slate-100"
              >
                <Feather name="x" size={16} color="#64748B" />
              </Pressable>
            </View>

            <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Quick Presets
            </Text>
            <View className="mb-5 flex-row flex-wrap gap-2">
              {PERIOD_PRESETS.map((p) => {
                const isSel = period === p.key;
                return (
                  <Pressable
                    key={p.key}
                    onPress={() => {
                      setPeriod(p.key);
                      const r = p.getRange();
                      setDraftFrom(r.from);
                      setDraftTo(r.to);
                      setDateRangeError('');
                      if (p.key !== 'custom') setDateRangeVisible(false);
                    }}
                    className={`rounded-xl px-3 py-2 border ${
                      isSel ? 'border-brand-700 bg-brand-700' : 'border-slate-200 bg-slate-50 active:bg-slate-100'
                    }`}
                  >
                    <Text className={`text-xs font-semibold ${isSel ? 'text-white' : 'text-slate-700'}`}>
                      {p.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Custom Dates (YYYY-MM-DD)
            </Text>
            <View className="mb-4 flex-row flex-wrap gap-3">
              <View className="flex-1">
                <Field
                  label="From Date"
                  value={draftFrom}
                  onChangeText={setDraftFrom}
                  placeholder="YYYY-MM-DD"
                />
              </View>
              <View className="flex-1">
                <Field
                  label="To Date"
                  value={draftTo}
                  onChangeText={setDraftTo}
                  placeholder="YYYY-MM-DD"
                />
              </View>
            </View>

            {isValidDateInput(draftFrom) && isValidDateInput(draftTo) ? (
              <View className="mb-4 rounded-xl bg-brand-50 p-3 flex-row items-center justify-between">
                <View className="flex-row items-center">
                  <Feather name="clock" size={14} color="#1A593B" />
                  <Text className="ml-2 text-xs font-medium text-brand-950">
                    {readableDateRange(dateAtLocalMidnight(draftFrom).toISOString(), dateAtLocalMidnight(draftTo).toISOString())}
                  </Text>
                </View>
                <Text className="text-xs font-semibold text-brand-700">Valid</Text>
              </View>
            ) : null}

            {dateRangeError ? (
              <View className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3">
                <Text className="text-xs text-red-700 font-medium">{dateRangeError}</Text>
              </View>
            ) : null}

            <View className="gap-2">
              <Button
                title="Apply Custom Date Range"
                onPress={() => {
                  if (!isValidDateInput(draftFrom) || !isValidDateInput(draftTo)) {
                    setDateRangeError('Enter valid dates using format YYYY-MM-DD.');
                    return;
                  }
                  if (dateAtLocalMidnight(draftFrom) > dateAtLocalMidnight(draftTo)) {
                    setDateRangeError('Start date cannot be later than End date.');
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

export function ReportsWorkspaceScreen({
  initialSection = 'sales',
}: {
  initialSection?: ReportSection;
}) {
  return (
    <AppSidebarProvider>
      <ReportsContent initialSection={initialSection} />
    </AppSidebarProvider>
  );
}
