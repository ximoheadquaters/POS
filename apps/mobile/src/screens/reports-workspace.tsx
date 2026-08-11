import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
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
import { REPORT_CATALOG, REPORT_METRICS, type ReportDefinition } from '@ximo/shared';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { DateRangeCalendar } from '@/components/date-range-calendar';
import { Button, ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import {
  buildInventoryExportExcel,
  buildInventoryExportPdf,
  buildReportsExcel,
  buildReportsCsv,
  buildReportsPdf,
  type InventoryExportData,
} from '@/lib/report-export';
import type { ReportsWorkspace } from '@/lib/report-types';
import { saveReportExport } from '@/lib/save-report-export';
import { useIosAlert } from '@/providers/ios-alert';
import { useSession } from '@/providers/session';
import { useBranchStore } from '@/store/branch';

type ReportSection =
  | 'overview'
  | 'sales'
  | 'products'
  | 'inventory'
  | 'purchasing'
  | 'profit'
  | 'cash'
  | 'audit'
  | 'repacking';
type ReportPeriod = 'today' | 'yesterday' | '7d' | '30d' | 'this_month' | 'last_month' | 'all' | 'custom';
type ComparisonPeriod = 'none' | 'previous_period' | 'previous_month' | 'previous_year';

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
  /** When set, row is a summary group — tap to view these records. */
  children?: DetailItem[];
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
  /** When set, open this child group immediately (e.g. a specific category). */
  initialGroupTitle?: string;
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

function comparisonDateRange(
  current: { from: string; to: string },
  mode: ComparisonPeriod,
): { from: string; to: string } | null {
  if (mode === 'none') return null;
  const from = new Date(current.from);
  const to = new Date(current.to);
  if (mode === 'previous_period') {
    const duration = Math.max(86_400_000, to.getTime() - from.getTime());
    return {
      from: new Date(from.getTime() - duration).toISOString(),
      to: from.toISOString(),
    };
  }
  if (mode === 'previous_month') {
    const start = new Date(from);
    start.setUTCMonth(start.getUTCMonth() - 1);
    const end = new Date(to);
    end.setUTCMonth(end.getUTCMonth() - 1);
    return { from: start.toISOString(), to: end.toISOString() };
  }
  const start = new Date(from);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  const end = new Date(to);
  end.setUTCFullYear(end.getUTCFullYear() - 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

const SECTIONS: Array<{
  key: ReportSection;
  label: string;
  icon: ComponentProps<typeof Feather>['name'];
}> = [
  { key: 'overview', label: 'Overview', icon: 'grid' },
  { key: 'sales', label: 'Sales', icon: 'shopping-cart' },
  { key: 'products', label: 'Products', icon: 'tag' },
  { key: 'inventory', label: 'Inventory', icon: 'package' },
  { key: 'purchasing', label: 'Purchasing', icon: 'truck' },
  { key: 'profit', label: 'Profit', icon: 'trending-up' },
  { key: 'cash', label: 'Cash', icon: 'monitor' },
  { key: 'audit', label: 'Audit', icon: 'shield' },
  { key: 'repacking', label: 'Repacking', icon: 'repeat' },
];

const SECTION_REPORT_IDS: Record<ReportSection, string> = {
  overview: 'sales_overview',
  sales: 'sales_summary',
  products: 'product_performance',
  inventory: 'inventory_valuation',
  purchasing: 'purchasing_summary',
  profit: 'profit_analysis',
  cash: 'cash_shift_accountability',
  audit: 'audit_activity',
  repacking: 'recipe_costing',
};

/** Distinct chart hues — readable on white, not a single green wash. */
const CHART_COLORS = [
  '#1A593B',
  '#0F766E',
  '#2563EB',
  '#D97706',
  '#BE123C',
  '#7C3AED',
  '#0891B2',
  '#65A30D',
];

const BRAND_COLORS = CHART_COLORS;

type MetricTone = 'brand' | 'blue' | 'amber' | 'sky' | 'purple' | 'slate' | 'rose' | 'red';

/** Pastel card fills + icon accents — same language as the Dashboard home. */
const METRIC_TONES: Record<MetricTone, { bg: string; accent: string }> = {
  brand: { bg: 'bg-[#E8F5EE]', accent: '#1A593B' },
  blue: { bg: 'bg-[#EAF4FB]', accent: '#1D6B8A' },
  amber: { bg: 'bg-[#F4F0E6]', accent: '#8A6A2F' },
  sky: { bg: 'bg-[#E8F3F7]', accent: '#1D6B8A' },
  purple: { bg: 'bg-[#EEF2FF]', accent: '#3F5B9A' },
  slate: { bg: 'bg-[#F1F5F4]', accent: '#64748B' },
  rose: { bg: 'bg-[#FCEEEE]', accent: '#A13D3D' },
  red: { bg: 'bg-[#FCEEEE]', accent: '#A13D3D' },
};

function useChartReady(dependencyKey: string | number) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    const timer = setTimeout(() => setReady(true), 50);
    return () => clearTimeout(timer);
  }, [dependencyKey]);
  return ready;
}

function pathLengthOf(points: Array<{ x: number; y: number }>): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    const dx = points[i]!.x - points[i - 1]!.x;
    const dy = points[i]!.y - points[i - 1]!.y;
    length += Math.sqrt(dx * dx + dy * dy);
  }
  return length;
}

const softCardShadow = {
  shadowColor: '#0F172A',
  shadowOpacity: 0.04,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;

function SoftCard({
  children,
  onPress,
  className = '',
  style,
  fill = false,
}: {
  children: ReactNode;
  onPress?: () => void;
  className?: string;
  style?: object;
  fill?: boolean;
}) {
  const fillStyle = fill
    ? { alignSelf: 'stretch' as const, flex: 1, height: '100%' as const }
    : { alignSelf: 'flex-start' as const };
  const body = (
    <View
      className={`w-full rounded-2xl border border-slate-100 bg-white ${className}`}
      style={[softCardShadow, fillStyle, style]}
    >
      {children}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="active:opacity-95"
      style={fill ? { ...fillStyle, width: '100%' } : { alignSelf: 'flex-start', width: '100%' }}
    >
      {body}
    </Pressable>
  );
}

function DonutChart({
  total,
  totalLabel = 'Total',
  segments,
  onSegmentPress,
}: {
  total: number | string;
  totalLabel?: string;
  segments: Array<{
    label: string;
    count: number;
    percentage: number;
    color: string;
    note?: string;
  }>;
  onSegmentPress?: (segment: {
    label: string;
    count: number;
    percentage: number;
    note?: string;
  }) => void;
}) {
  const size = 188;
  const strokeWidth = 22;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const ready = useChartReady(segments.map((s) => `${s.label}:${s.percentage}`).join('|'));

  let cumulativePercent = 0;

  return (
    <View className="flex-row flex-wrap items-center gap-5">
      <View className="relative items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="transparent"
            stroke="#EEF2F0"
            strokeWidth={strokeWidth}
          />
          {segments.map((seg, i) => {
            const arc = (seg.percentage / 100) * circumference;
            const offset = -((cumulativePercent / 100) * circumference);
            cumulativePercent += seg.percentage;
            return (
              <circle
                key={`${seg.label}-${i}`}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="transparent"
                stroke={seg.color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${ready ? arc : 0} ${circumference}`}
                strokeDashoffset={offset}
                strokeLinecap={segments.length > 1 ? 'butt' : 'round'}
                style={{
                  transform: 'rotate(-90deg)',
                  transformOrigin: '50% 50%',
                  transition: 'stroke-dasharray 900ms cubic-bezier(0.22, 1, 0.36, 1)',
                  transitionDelay: `${i * 80}ms`,
                }}
              />
            );
          })}
        </svg>
        <View className="absolute items-center justify-center">
          <Text className="text-3xl font-semibold text-slate-900">{total}</Text>
          <Text className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {totalLabel}
          </Text>
        </View>
      </View>

      <View className="min-w-[180px] flex-1 justify-center gap-3.5">
        {segments.map((seg, i) => {
          const row = (
            <View className="gap-1.5 px-1 py-0.5">
              <View className="flex-row items-center justify-between gap-3">
                <View className="min-w-0 flex-1 flex-row items-center gap-2">
                  <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: seg.color }} />
                  <View className="min-w-0 flex-1">
                    <Text numberOfLines={1} className="text-sm font-medium text-slate-700">
                      {seg.label}
                    </Text>
                    <Text numberOfLines={1} className="mt-0.5 text-[11px] text-slate-400">
                      {seg.note ?? `${seg.count} sold`}
                    </Text>
                  </View>
                </View>
                <Text className="text-sm font-semibold text-slate-900">{seg.percentage}%</Text>
              </View>
              <View className="h-2 overflow-hidden rounded-full bg-slate-100">
                <View
                  className="h-2 rounded-full"
                  style={{
                    width: ready ? `${Math.max(seg.percentage, 2)}%` : '0%',
                    backgroundColor: seg.color,
                    transitionProperty: 'width',
                    transitionDuration: '900ms',
                    transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
                    transitionDelay: `${120 + i * 80}ms`,
                  }}
                />
              </View>
            </View>
          );
          if (!onSegmentPress) {
            return <View key={`${seg.label}-${i}`}>{row}</View>;
          }
          return (
            <Pressable
              key={`${seg.label}-${i}`}
              accessibilityRole="button"
              onPress={() => onSegmentPress(seg)}
              className="rounded-xl active:bg-brand-50"
            >
              {row}
            </Pressable>
          );
        })}
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
  const strokeWidth = 12;
  const radius = (size - strokeWidth) / 2;
  const circumference = Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percentage));
  const ready = useChartReady(`${label}-${clamped}`);

  return (
    <View className="min-w-[120px] flex-1 items-center justify-center px-1 py-1">
      <View className="relative items-center justify-center" style={{ width: size, height: size / 2 + 12 }}>
        <svg width={size} height={size / 2 + 12} viewBox={`0 0 ${size} ${size / 2 + 12}`}>
          <path
            d={`M ${strokeWidth / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${size / 2}`}
            fill="none"
            stroke="#EEF2F0"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
          <path
            d={`M ${strokeWidth / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${size / 2}`}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${ready ? (clamped / 100) * circumference : 0} ${circumference}`}
            strokeLinecap="round"
            style={{
              transition: 'stroke-dasharray 1000ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          />
        </svg>
        <View className="absolute bottom-0 items-center">
          <Text className="text-xl font-semibold text-slate-900">{clamped}%</Text>
        </View>
      </View>
      <Text className="mt-2 text-center text-xs font-medium text-slate-700">{label}</Text>
      {valueNote ? <Text className="mt-0.5 text-center text-[11px] text-slate-500">{valueNote}</Text> : null}
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
  tone?: MetricTone;
  trend?: 'up' | 'down';
  onPress?: () => void;
}) {
  const { width } = useWindowDimensions();
  const phone = width < 640;
  const palette = METRIC_TONES[tone];
  const cardStyle = {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: phone ? ('46%' as const) : width < 1100 ? ('30%' as const) : ('13%' as const),
    minWidth: phone ? 150 : 160,
  };

  const content = (
    <>
      <View className="mb-3 flex-row items-center justify-between">
        <Text className="min-w-0 flex-1 text-[12px] font-medium text-slate-600" numberOfLines={1}>
          {label}
        </Text>
        <View className="ml-2 flex-row items-center gap-1.5">
          {trend ? (
            <Feather
              name={trend === 'up' ? 'arrow-up-right' : 'arrow-down-right'}
              size={14}
              color={trend === 'up' ? '#1A593B' : '#E11D48'}
            />
          ) : null}

          <View className="h-8 w-8 items-center justify-center rounded-xl bg-white/70">
            <Feather name={icon} size={15} color={palette.accent} />
          </View>
        </View>
      </View>
      <Text className="text-2xl font-semibold text-slate-900" numberOfLines={1}>
        {value}
      </Text>
      {note ? (
        <Text className="mt-1.5 text-[11px] leading-4 text-slate-500" numberOfLines={2}>
          {note}
        </Text>
      ) : null}
    </>
  );

  if (!onPress) {
    return (
      <View className={`rounded-2xl p-4 ${palette.bg}`} style={cardStyle}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={`rounded-2xl p-4 active:opacity-95 ${palette.bg}`}
      style={cardStyle}
    >
      {content}
    </Pressable>
  );
}

function ResponsivePanel({
  children,
  full = false,
  stretch = false,
}: {
  children: ReactNode;
  full?: boolean;
  stretch?: boolean;
}) {
  const { width } = useWindowDimensions();
  const stacked = width < 960;
  if (full) {
    return <View className="w-full">{children}</View>;
  }
  return (
    <View
      className="w-full"
      style={
        stacked
          ? { width: '100%', flexBasis: '100%' }
          : {
              width: '48.8%',
              maxWidth: '48.8%',
              flexGrow: 1,
              flexBasis: '48.8%',
              alignSelf: stretch ? 'stretch' : 'flex-start',
              ...(stretch ? { display: 'flex' as const } : {}),
            }
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
  onPress,
  collapsible = false,
  defaultCollapsed = false,
  fill = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
  icon?: ComponentProps<typeof Feather>['name'];
  onPress?: () => void;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  fill?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(collapsible && defaultCollapsed);
  const showBody = !collapsible || !collapsed;
  const header = (
    <View className={`flex-row items-center justify-between gap-3 ${showBody ? 'mb-4' : ''}`}>
      <View className="min-w-0 flex-1">
        <Text className="text-[15px] font-semibold text-slate-900">{title}</Text>
        {subtitle ? (
          <Text className="mt-0.5 text-xs text-slate-500" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {collapsible ? (
        <View className="h-8 w-8 items-center justify-center rounded-full bg-slate-50">
          <Feather name={collapsed ? 'chevron-down' : 'chevron-up'} size={15} color="#64748B" />
        </View>
      ) : (
        action ??
        (onPress ? (
          <View className="h-8 w-8 items-center justify-center rounded-full bg-slate-50">
            <Feather name="chevron-right" size={15} color="#64748B" />
          </View>
        ) : icon ? (
          <Feather name={icon} size={15} color="#94A3B8" />
        ) : null)
      )}
    </View>
  );
  return (
    <SoftCard onPress={onPress} className={fill ? 'h-full p-5' : 'p-5'} fill={fill}>
      {collapsible ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: !collapsed }}
          onPress={() => setCollapsed((value) => !value)}
        >
          {header}
        </Pressable>
      ) : (
        header
      )}
      {showBody ? (
        fill ? <View className="min-h-0 flex-1 justify-center">{children}</View> : children
      ) : null}
    </SoftCard>
  );
}

function BarRows({
  rows,
  emptyLabel = 'No activity for this period.',
  ranked = false,
}: {
  rows: Array<{ key: string; label: string; value: number; display: string; note?: string }>;
  emptyLabel?: string;
  ranked?: boolean;
}) {
  const maximum = Math.max(...rows.map((row) => Math.abs(row.value)), 1);
  const ready = useChartReady(rows.map((row) => `${row.key}:${row.value}`).join('|'));
  if (!rows.length) {
    return <Text className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">{emptyLabel}</Text>;
  }
  return (
    <View className="gap-3.5">
      {rows.map((row, index) => {
        const widthPct = Math.max(4, (Math.abs(row.value) / maximum) * 100);
        return (
          <View key={row.key} className="gap-1.5">
            <View className="flex-row items-center gap-3">
              {ranked ? (
                <View className="h-7 w-7 items-center justify-center rounded-full bg-brand-50">
                  <Text className="text-xs font-semibold text-brand-800">{index + 1}</Text>
                </View>
              ) : null}
              <View className="min-w-0 flex-1">
                <Text numberOfLines={1} className="text-sm font-medium text-slate-800">
                  {row.label}
                </Text>
                {row.note ? <Text className="mt-0.5 text-xs text-slate-400">{row.note}</Text> : null}
              </View>
              <Text className="text-sm font-semibold text-slate-900">{row.display}</Text>
            </View>
            <View className={`h-1.5 overflow-hidden rounded-full bg-slate-100 ${ranked ? 'ml-10' : ''}`}>
              <View
                className={`h-1.5 rounded-full ${row.value < 0 ? 'bg-rose-500' : 'bg-brand-600'}`}
                style={{
                  width: ready ? `${widthPct}%` : '0%',
                  transitionProperty: 'width',
                  transitionDuration: '900ms',
                  transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
                  transitionDelay: `${index * 70}ms`,
                }}
              />
            </View>
          </View>
        );
      })}
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
  if (dayCount < 1 || dayCount > 62) {
    return [...trend].sort((a, b) => a.date.localeCompare(b.date));
  }
  const byDate = new Map(trend.map((item) => [item.date, item]));
  return Array.from({ length: dayCount }, (_, index) => {
    const current = new Date(start);
    current.setDate(current.getDate() + index);
    const date = localDateInput(current);
    return byDate.get(date) ?? { date, sales: '0.00', transactions: 0 };
  });
}

/** Trim leading empty days so the line trend is not flattened by long zero stretches. */
function prepareSalesChartSeries(
  trend: ReportsWorkspace['sales']['trend'],
  from: string,
  to: string,
): ReportsWorkspace['sales']['trend'] {
  const filled = fillSalesTrend(trend, from, to);
  const firstActive = filled.findIndex((item) => Number(item.sales) > 0);
  if (firstActive < 0) return filled.slice(-7);
  // Keep a little context before the first sale, then plot as a continuous line.
  return filled.slice(Math.max(0, firstActive - 1));
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

function formatAxisMoney(value: number): string {
  if (value >= 1000) return `₱${(value / 1000).toFixed(1)}k`;
  return `₱${Math.round(value)}`;
}

/** Crosshair + tooltip rendered inside a trend chart's SVG at native scale. */
function ChartHoverOverlay({
  point,
  lines,
  chartWidth,
  topPad,
  plotHeight,
}: {
  point: { x: number; y: number };
  lines: string[];
  chartWidth: number;
  topPad: number;
  plotHeight: number;
}) {
  const boxWidth = Math.max(...lines.map((line) => line.length)) * 5.8 + 18;
  const boxHeight = lines.length * 13 + 12;
  const boxX = Math.min(Math.max(point.x - boxWidth / 2, 2), chartWidth - boxWidth - 2);
  const boxY = Math.max(2, point.y - boxHeight - 12);
  return (
    <g style={{ pointerEvents: 'none' }}>
      <line
        x1={point.x}
        y1={topPad}
        x2={point.x}
        y2={topPad + plotHeight}
        stroke="#94A3B8"
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      <circle cx={point.x} cy={point.y} r={4.5} fill="#1A593B" stroke="#FFFFFF" strokeWidth="2" />
      <rect x={boxX} y={boxY} width={boxWidth} height={boxHeight} rx={7} fill="#0F172A" opacity={0.94} />
      {lines.map((line, index) => (
        <text
          key={index}
          x={boxX + 9}
          y={boxY + 17 + index * 13}
          fontSize="10"
          fontWeight={index === 0 || index === lines.length - 1 ? '600' : '400'}
          fill={index === lines.length - 1 ? '#86EFAC' : index === 0 ? '#FFFFFF' : '#CBD5E1'}
        >
          {line}
        </text>
      ))}
    </g>
  );
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
  const series = useMemo(() => prepareSalesChartSeries(trend, from, to), [from, to, trend]);
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const maxSales = Math.max(...series.map((item) => Number(item.sales)), 1);
  const chartHeight = 248;
  const chartWidth = Math.max(measuredWidth, 320);
  const leftPad = 42;
  const rightPad = 16;
  const topPad = 16;
  const bottomPad = 28;
  const plotWidth = chartWidth - leftPad - rightPad;
  const plotHeight = chartHeight - topPad - bottomPad;
  const ready = useChartReady(`${from}|${to}|line|${maxSales}|${series.length}`);

  const rawPoints = useMemo(
    () =>
      series.map((item, index) => {
        const x =
          series.length > 1
            ? leftPad + (index / (series.length - 1)) * plotWidth
            : leftPad + plotWidth / 2;
        const y = topPad + plotHeight - (Number(item.sales) / maxSales) * plotHeight;
        return { x, y };
      }),
    [leftPad, maxSales, plotHeight, plotWidth, series, topPad],
  );

  const curvePoints = useMemo(
    () => smoothChartPoints(rawPoints, topPad + plotHeight),
    [plotHeight, rawPoints, topPad],
  );

  const linePath = useMemo(() => {
    if (!curvePoints.length) return '';
    return curvePoints
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(' ');
  }, [curvePoints]);

  const areaPath = useMemo(() => {
    if (!curvePoints.length) return '';
    const baseY = topPad + plotHeight;
    const first = curvePoints[0]!;
    const last = curvePoints.at(-1)!;
    return `${linePath} L ${last.x.toFixed(2)} ${baseY} L ${first.x.toFixed(2)} ${baseY} Z`;
  }, [curvePoints, linePath, plotHeight, topPad]);

  const drawLength = useMemo(() => Math.max(pathLengthOf(curvePoints), 1), [curvePoints]);

  const labelIndexes = useMemo(() => {
    if (series.length <= 6) return series.map((_, i) => i);
    const step = (series.length - 1) / 4;
    return [0, Math.round(step), Math.round(step * 2), Math.round(step * 3), series.length - 1];
  }, [series]);

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => maxSales * ratio);
  const lastActive = series.filter((item) => Number(item.sales) > 0).at(-1);

  return (
    <View className="w-full">
      <View className="mb-1 flex-row items-center justify-end">
        <Text className="text-xs text-slate-500">
          Peak <Text className="font-semibold text-slate-800">{formatMoney(maxSales.toFixed(2))}</Text>
        </Text>
      </View>

      <View
        className="mt-2 w-full overflow-hidden"
        onLayout={(event) => setMeasuredWidth(event.nativeEvent.layout.width)}
      >
        <svg
          width="100%"
          height={chartHeight}
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          style={{ cursor: 'crosshair', touchAction: 'pan-y' }}
          onMouseMove={(event) => {
            if (!series.length) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const x = event.clientX - bounds.left;
            const ratio = plotWidth > 0 ? (x - leftPad) / plotWidth : 0;
            const index = Math.round(ratio * Math.max(series.length - 1, 0));
            setHovered(Math.min(series.length - 1, Math.max(0, index)));
          }}
          onMouseLeave={() => setHovered(null)}
        >
          <defs>
            <linearGradient id="salesAreaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1A593B" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#1A593B" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {yTicks.map((tick, index) => {
            const y = topPad + plotHeight - (tick / maxSales) * plotHeight;
            return (
              <g key={`grid-${index}`}>
                <line
                  x1={leftPad}
                  y1={y}
                  x2={chartWidth - rightPad}
                  y2={y}
                  stroke="#E8EDE9"
                  strokeWidth="1"
                />
                <text x={leftPad - 8} y={y + 3} textAnchor="end" fontSize="10" fill="#94A3B8">
                  {formatAxisMoney(tick)}
                </text>
              </g>
            );
          })}

          <path
            d={areaPath}
            fill="url(#salesAreaFill)"
            opacity={ready ? 1 : 0}
            style={{ transition: 'opacity 700ms ease-out 350ms' }}
          />
          <path
            d={linePath}
            fill="none"
            stroke="#1A593B"
            strokeWidth="2.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={drawLength}
            strokeDashoffset={ready ? 0 : drawLength}
            style={{
              transition: 'stroke-dashoffset 1200ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          />
          {lastActive
            ? (() => {
                const idx = series.findIndex((item) => item.date === lastActive.date);
                const point = rawPoints[idx];
                if (!point) return null;
                return (
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={ready ? 4 : 0}
                    fill="#1A593B"
                    stroke="#FFFFFF"
                    strokeWidth="2"
                    style={{ transition: 'r 400ms ease-out 1000ms' }}
                  />
                );
              })()
            : null}

          {labelIndexes.map((index) => {
            const item = series[index];
            if (!item) return null;
            const x =
              series.length > 1
                ? leftPad + (index / (series.length - 1)) * plotWidth
                : leftPad + plotWidth / 2;
            return (
              <text
                key={`label-${item.date}`}
                x={x}
                y={chartHeight - 8}
                textAnchor="middle"
                fontSize="10"
                fill="#94A3B8"
              >
                {new Date(`${item.date}T12:00:00`).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </text>
            );
          })}
          {hovered !== null && rawPoints[hovered] && series[hovered] ? (
            <ChartHoverOverlay
              point={rawPoints[hovered]!}
              lines={[
                new Date(`${series[hovered]!.date}T12:00:00`).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                }),
                `${series[hovered]!.transactions} txns`,
                formatMoney(series[hovered]!.sales),
              ]}
              chartWidth={chartWidth}
              topPad={topPad}
              plotHeight={plotHeight}
            />
          ) : null}
        </svg>
      </View>

      {lastActive ? (
        <View className="mt-2 flex-row items-center justify-between border-t border-slate-100 pt-2.5">
          <View>
            <Text className="text-sm font-medium text-slate-900">
              {new Date(`${lastActive.date}T12:00:00`).toLocaleDateString()}
            </Text>
            <Text className="mt-0.5 text-xs text-slate-500">
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

function ProductBarChart({
  rows,
  emptyLabel = 'No products sold for this period.',
  height,
}: {
  rows: Array<{ key: string; label: string; value: number; display: string; note?: string }>;
  emptyLabel?: string;
  height?: number;
}) {
  const ready = useChartReady(rows.map((row) => `${row.key}:${row.value}`).join('|'));
  const [hovered, setHovered] = useState<number | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const gradientId = `productBarFill-${rows.map((row) => row.key).join('-').slice(0, 48) || 'chart'}`;
  const maximum = Math.max(...rows.map((row) => Math.abs(row.value)), 1);
  const chartHeight = height ?? 260;
  const chartWidth = Math.max(measuredWidth, 320);
  const leftPad = 8;
  const rightPad = 8;
  const topPad = 28;
  const bottomPad = 52;
  const plotWidth = chartWidth - leftPad - rightPad;
  const plotHeight = Math.max(chartHeight - topPad - bottomPad, 40);
  const slot = plotWidth / Math.max(rows.length, 1);
  const barWidth = Math.min(48, Math.max(18, slot * 0.55));

  if (!rows.length) {
    return <Text className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">{emptyLabel}</Text>;
  }

  return (
    <View
      className="w-full"
      style={{ minHeight: chartHeight }}
      onLayout={(event) => setMeasuredWidth(event.nativeEvent.layout.width)}
    >
      <svg
        width="100%"
        height={chartHeight}
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', overflow: 'visible', maxHeight: chartHeight }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2D7D54" />
            <stop offset="100%" stopColor="#1A593B" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = topPad + plotHeight - ratio * plotHeight;
          return (
            <line
              key={ratio}
              x1={leftPad}
              y1={y}
              x2={chartWidth - rightPad}
              y2={y}
              stroke="#EEF2F0"
              strokeWidth="1"
            />
          );
        })}
        {rows.map((row, index) => {
          const fullHeight = (Math.abs(row.value) / maximum) * plotHeight;
          // Avoid CSS transitions on SVG height/y — they collapse bars to thin caps on web.
          const barHeight = ready ? Math.max(8, fullHeight) : 8;
          const x = leftPad + index * slot + (slot - barWidth) / 2;
          const y = topPad + plotHeight - barHeight;
          const shortLabel =
            row.label.length > 10 ? `${row.label.slice(0, 9)}…` : row.label;
          const dimmed = hovered !== null && hovered !== index;
          const valueLabel =
            row.display?.trim() ||
            (Number.isInteger(row.value) && Math.abs(row.value) < 1000
              ? String(row.value)
              : formatAxisMoney(row.value));
          return (
            <g
              key={row.key}
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered((current) => (current === index ? null : current))}
              onClick={() => setHovered(index)}
              style={{ cursor: 'pointer' }}
            >
              <rect
                x={leftPad + index * slot}
                y={topPad}
                width={slot}
                height={plotHeight}
                fill="transparent"
              />
              <rect
                x={x}
                y={ready ? y : topPad + plotHeight - 8}
                width={barWidth}
                height={barHeight}
                rx={6}
                fill={`url(#${gradientId})`}
                opacity={ready ? (dimmed ? 0.4 : 1) : 0.15}
              />
              <text
                x={x + barWidth / 2}
                y={y - 8}
                textAnchor="middle"
                fontSize="10"
                fontWeight="600"
                fill="#334155"
                opacity={ready ? (dimmed ? 0.4 : 1) : 0}
              >
                {valueLabel}
              </text>
              <text
                x={x + barWidth / 2}
                y={chartHeight - 28}
                textAnchor="middle"
                fontSize="10"
                fill="#64748B"
                opacity={dimmed ? 0.5 : 1}
              >
                {shortLabel}
              </text>
              <text
                x={x + barWidth / 2}
                y={chartHeight - 12}
                textAnchor="middle"
                fontSize="9"
                fill="#94A3B8"
                opacity={dimmed ? 0.5 : 1}
              >
                #{index + 1}
              </text>
            </g>
          );
        })}
        {hovered !== null && rows[hovered]
          ? (() => {
              const row = rows[hovered]!;
              const truncate = (input: string, max: number) =>
                input.length > max ? `${input.slice(0, max - 1)}…` : input;
              const lines = [
                truncate(row.label, 34),
                ...(row.note ? [truncate(row.note, 34)] : []),
                row.display,
              ];
              const boxWidth = Math.max(...lines.map((line) => line.length)) * 5.8 + 18;
              const boxHeight = lines.length * 13 + 12;
              const fullHeight = (Math.abs(row.value) / maximum) * plotHeight;
              const barTop = topPad + plotHeight - Math.max(8, fullHeight);
              const centerX = leftPad + hovered * slot + slot / 2;
              const boxX = Math.min(Math.max(centerX - boxWidth / 2, 2), chartWidth - boxWidth - 2);
              const boxY = Math.max(2, barTop - boxHeight - 8);
              return (
                <g style={{ pointerEvents: 'none' }}>
                  <rect
                    x={boxX}
                    y={boxY}
                    width={boxWidth}
                    height={boxHeight}
                    rx={7}
                    fill="#0F172A"
                    opacity={0.94}
                  />
                  {lines.map((line, lineIndex) => (
                    <text
                      key={lineIndex}
                      x={boxX + 9}
                      y={boxY + 17 + lineIndex * 13}
                      fontSize="10"
                      fontWeight={lineIndex === 0 || lineIndex === lines.length - 1 ? '600' : '400'}
                      fill={lineIndex === lines.length - 1 ? '#86EFAC' : lineIndex === 0 ? '#FFFFFF' : '#CBD5E1'}
                    >
                      {line}
                    </text>
                  ))}
                </g>
              );
            })()
          : null}
      </svg>
    </View>
  );
}

function fillProfitTrend(
  trend: ReportsWorkspace['profit']['trend'],
  from: string,
  to: string,
): ReportsWorkspace['profit']['trend'] {
  const dayMs = 86_400_000;
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  const dayCount = Math.round((end.getTime() - start.getTime()) / dayMs);
  const byDate = new Map(trend.map((item) => [item.date, item]));
  if (dayCount < 1 || dayCount > 31) {
    return [...trend].sort((a, b) => a.date.localeCompare(b.date));
  }
  return Array.from({ length: dayCount }, (_, index) => {
    const current = new Date(start);
    current.setDate(current.getDate() + index);
    const date = localDateInput(current);
    return (
      byDate.get(date) ?? {
        date,
        netSales: '0.00',
        netCost: '0.00',
        profit: '0.00',
      }
    );
  });
}

function ProfitTrendChart({
  trend,
  from,
  to,
}: {
  trend: ReportsWorkspace['profit']['trend'];
  from: string;
  to: string;
}) {
  const series = useMemo(() => fillProfitTrend(trend, from, to), [from, to, trend]);
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const values = series.map((item) => Number(item.profit));
  const maxProfit = Math.max(...values, 1);
  const minProfit = Math.min(...values, 0);
  const span = Math.max(maxProfit - minProfit, 1);
  const chartHeight = 200;
  const chartWidth = Math.max(measuredWidth, 320);
  const leftPad = 40;
  const rightPad = 12;
  const topPad = 14;
  const bottomPad = 8;
  const plotWidth = chartWidth - leftPad - rightPad;
  const plotHeight = chartHeight - topPad - bottomPad;

  const rawPoints = useMemo(
    () =>
      series.map((item, index) => {
        const x =
          series.length > 1
            ? leftPad + (index / (series.length - 1)) * plotWidth
            : leftPad + plotWidth / 2;
        const y =
          topPad + plotHeight - ((Number(item.profit) - minProfit) / span) * plotHeight;
        return { x, y };
      }),
    [leftPad, minProfit, plotHeight, plotWidth, series, span, topPad],
  );

  const curvePoints = useMemo(
    () => smoothChartPoints(rawPoints, topPad + plotHeight),
    [plotHeight, rawPoints, topPad],
  );

  const linePath = useMemo(() => {
    if (!curvePoints.length) return '';
    return curvePoints
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(' ');
  }, [curvePoints]);

  const zeroY = topPad + plotHeight - ((0 - minProfit) / span) * plotHeight;
  const areaPath = useMemo(() => {
    if (!curvePoints.length) return '';
    const first = curvePoints[0]!;
    const last = curvePoints.at(-1)!;
    const baseY = Math.min(Math.max(zeroY, topPad), topPad + plotHeight);
    return `${linePath} L ${last.x.toFixed(2)} ${baseY} L ${first.x.toFixed(2)} ${baseY} Z`;
  }, [curvePoints, linePath, plotHeight, topPad, zeroY]);

  const drawLength = useMemo(() => Math.max(pathLengthOf(curvePoints), 1), [curvePoints]);
  const ready = useChartReady(`profit|${from}|${to}|${maxProfit}|${series.length}`);

  const labelIndexes = useMemo(() => {
    if (series.length <= 4) return series.map((_, i) => i);
    const step = (series.length - 1) / 3;
    return [0, Math.round(step), Math.round(step * 2), series.length - 1];
  }, [series]);

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => minProfit + span * ratio);
  const lastActive = series.filter((item) => Number(item.profit) !== 0 || Number(item.netSales) > 0).at(-1);

  if (!series.length) {
    return (
      <Text className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
        No profit activity for this period.
      </Text>
    );
  }

  return (
    <View>
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="text-xs text-slate-500">Daily gross profit — selected period</Text>
        <Text className="text-xs text-slate-500">
          Peak <Text className="font-semibold text-slate-800">{formatMoney(maxProfit.toFixed(2))}</Text>
        </Text>
      </View>

      <View
        className="mt-2 w-full overflow-hidden"
        onLayout={(event) => setMeasuredWidth(event.nativeEvent.layout.width)}
      >
        <svg
          width="100%"
          height={chartHeight}
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          style={{ cursor: 'crosshair', touchAction: 'pan-y' }}
          onMouseMove={(event) => {
            if (!series.length) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const x = event.clientX - bounds.left;
            const ratio = plotWidth > 0 ? (x - leftPad) / plotWidth : 0;
            const index = Math.round(ratio * Math.max(series.length - 1, 0));
            setHovered(Math.min(series.length - 1, Math.max(0, index)));
          }}
          onMouseLeave={() => setHovered(null)}
        >
          <defs>
            <linearGradient id="profitAreaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1A593B" stopOpacity="0.24" />
              <stop offset="100%" stopColor="#1A593B" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {yTicks.map((tick, index) => {
            const y = topPad + plotHeight - ((tick - minProfit) / span) * plotHeight;
            return (
              <g key={`profit-grid-${index}`}>
                <line
                  x1={leftPad}
                  y1={y}
                  x2={chartWidth - rightPad}
                  y2={y}
                  stroke="#E8EDE9"
                  strokeWidth="1"
                />
                <text x={leftPad - 6} y={y + 3} textAnchor="end" fontSize="9" fill="#94A3B8">
                  {formatAxisMoney(tick)}
                </text>
              </g>
            );
          })}
          {minProfit < 0 && maxProfit > 0 ? (
            <line
              x1={leftPad}
              y1={zeroY}
              x2={chartWidth - rightPad}
              y2={zeroY}
              stroke="#CBD5E1"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
          ) : null}
          <path
            d={areaPath}
            fill="url(#profitAreaFill)"
            opacity={ready ? 1 : 0}
            style={{ transition: 'opacity 700ms ease-out 350ms' }}
          />
          <path
            d={linePath}
            fill="none"
            stroke="#1A593B"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={drawLength}
            strokeDashoffset={ready ? 0 : drawLength}
            style={{
              transition: 'stroke-dashoffset 1200ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          />
          {lastActive
            ? (() => {
                const idx = series.findIndex((item) => item.date === lastActive.date);
                const point = rawPoints[idx];
                if (!point) return null;
                return (
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={ready ? 4 : 0}
                    fill="#1A593B"
                    stroke="#FFFFFF"
                    strokeWidth="2"
                    style={{ transition: 'r 400ms ease-out 1000ms' }}
                  />
                );
              })()
            : null}
          {hovered !== null && rawPoints[hovered] && series[hovered] ? (
            <ChartHoverOverlay
              point={rawPoints[hovered]!}
              lines={[
                new Date(`${series[hovered]!.date}T12:00:00`).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                }),
                `${formatMoney(series[hovered]!.netSales)} sales − ${formatMoney(series[hovered]!.netCost)} cost`,
                formatMoney(series[hovered]!.profit),
              ]}
              chartWidth={chartWidth}
              topPad={topPad}
              plotHeight={plotHeight}
            />
          ) : null}
        </svg>
      </View>

      <View className="ml-10 mt-1 flex-row justify-between">
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
        <View className="mt-4 flex-row items-center justify-between border-t border-slate-100 pt-3">
          <View className="min-w-0 flex-1 pr-3">
            <Text className="text-sm font-medium text-slate-900">
              {new Date(`${lastActive.date}T12:00:00`).toLocaleDateString()}
            </Text>
            <Text className="mt-0.5 text-xs text-slate-500" numberOfLines={1}>
              {formatMoney(lastActive.netSales)} net sales − {formatMoney(lastActive.netCost)} cost
            </Text>
          </View>
          <Text className="text-base font-semibold text-slate-950">
            {formatMoney(lastActive.profit)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function RankedMoneyRows({
  rows,
  emptyLabel,
  onRowPress,
}: {
  rows: Array<{
    key: string;
    label: string;
    note: string;
    value: string;
    icon?: ComponentProps<typeof Feather>['name'];
  }>;
  emptyLabel: string;
  onRowPress?: (row: { key: string; label: string; note: string; value: string }) => void;
}) {
  const maximum = Math.max(...rows.map((item) => Number(item.value)), 1);
  if (!rows.length) {
    return <Text className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">{emptyLabel}</Text>;
  }
  const total = rows.reduce((sum, item) => sum + Number(item.value), 0);
  return (
    <View>
      <View className="gap-3">
        {rows.map((item, index) => {
          const body = (
            <>
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
                  <Text className="mt-0.5 text-xs text-slate-500">
                    {item.note}
                    {onRowPress ? ' · Tap for products' : ''}
                  </Text>
                </View>
                <View className="flex-row items-center gap-1">
                  <Text className="text-sm font-semibold text-slate-950">
                    {formatMoney(item.value)}
                  </Text>
                  {onRowPress ? <Feather name="chevron-right" size={16} color="#1A593B" /> : null}
                </View>
              </View>
              <View className="ml-11 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <View
                  className="h-1.5 rounded-full bg-brand-700"
                  style={{ width: `${Math.max(3, (Number(item.value) / maximum) * 100)}%` }}
                />
              </View>
            </>
          );
          if (!onRowPress) {
            return <View key={item.key}>{body}</View>;
          }
          return (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              onPress={() => onRowPress(item)}
              className="rounded-xl px-1 py-1 active:bg-brand-50"
            >
              {body}
            </Pressable>
          );
        })}
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

function matchesDetailSearch(item: DetailItem, q: string): boolean {
  return (
    item.title.toLowerCase().includes(q) ||
    Boolean(item.sku?.toLowerCase().includes(q)) ||
    Boolean(item.category?.toLowerCase().includes(q)) ||
    Boolean(item.note?.toLowerCase().includes(q)) ||
    Boolean(item.statusTag?.toLowerCase().includes(q)) ||
    Boolean(item.subValue?.toLowerCase().includes(q)) ||
    Boolean(item.children?.some((child) => matchesDetailSearch(child, q)))
  );
}

/** When a drilldown is a flat list of tagged records, group them so users can tap a status to open details. */
/** Extract the numeric part of a formatted display value like "₱1,344.00" or "12 pieces". */
function parseDisplayValue(value: string | undefined): number {
  if (!value) return 0;
  const cleaned = value.replace(/[^0-9.-]/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function flattenDetailItems(items: DetailItem[]): DetailItem[] {
  const rows: DetailItem[] = [];
  for (const item of items) {
    if (item.children?.length) {
      rows.push(...flattenDetailItems(item.children));
    } else {
      rows.push(item);
    }
  }
  return rows;
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function buildDetailListCsv(
  title: string,
  items: DetailItem[],
  meta: { rangeLabel: string; branchName: string },
): { bytes: Uint8Array; fileName: string } {
  const rows = [
    [title],
    [`Date range: ${meta.rangeLabel}`],
    [`Branch: ${meta.branchName}`],
    [],
    ['Title', 'Reference', 'Category / Branch', 'Status', 'Quantity', 'Note', 'Value', 'Breakdown'],
    ...flattenDetailItems(items).map((item) => [
      item.title,
      item.sku ?? '',
      item.category ?? '',
      item.statusTag ?? '',
      item.quantity != null ? `${item.quantity}${item.unit ? ` ${item.unit}` : ''}` : '',
      item.note ?? '',
      item.value,
      item.subValue ?? '',
    ]),
  ];
  const csv = rows.map((row) => row.map((cell) => csvEscape(String(cell))).join(',')).join('\n');
  const stem = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return {
    bytes: new TextEncoder().encode(`\uFEFF${csv}`),
    fileName: `ximo-${stem || 'report'}-${new Date().toISOString().slice(0, 10)}.csv`,
  };
}

function buildStatusGroups(items: DetailItem[]): DetailItem[] | null {
  if (!items.length || items.some((item) => item.children?.length)) return null;
  const byTag = new Map<string, DetailItem[]>();
  for (const item of items) {
    const tag = item.statusTag?.trim();
    if (!tag) continue;
    const list = byTag.get(tag) ?? [];
    list.push(item);
    byTag.set(tag, list);
  }
  if (byTag.size < 2) return null;
  const taggedCount = [...byTag.values()].reduce((sum, list) => sum + list.length, 0);
  if (taggedCount < Math.ceil(items.length * 0.5)) return null;

  return [...byTag.entries()].map(([tag, children]) => ({
    id: `status-group-${tag}`,
    title: tag,
    note: `${children.length} record${children.length === 1 ? '' : 's'}`,
    value: children.length === 1 ? children[0]!.value : `${children.length} records`,
    statusTag: tag,
    statusTone: children[0]?.statusTone,
    children,
  }));
}

function mapPurchaseOrderItem(po: {
  id: string;
  poNumber: string;
  supplierName: string;
  orderDate?: string;
  status: string;
  total: string;
  branchName?: string;
}): DetailItem {
  const status = po.status.replaceAll('_', ' ').toUpperCase();
  return {
    id: po.id,
    title: po.supplierName,
    sku: `PO #${po.poNumber}`,
    category: po.branchName ?? 'Main Branch',
    note: `Order Date: ${po.orderDate || 'N/A'}`,
    value: formatMoney(po.total),
    statusTag: status,
    statusTone:
      po.status === 'received' || po.status === 'completed'
        ? 'green'
        : po.status === 'ordered' || po.status === 'partially_received'
          ? 'amber'
          : po.status === 'cancelled'
            ? 'red'
            : 'slate',
  };
}

function mapSalesReceiptItem(sr: {
  id: string;
  receiptNumber: string;
  status: string;
  paymentMethod: string;
  completedAt?: string;
  total: string;
  discount?: string;
  tax?: string;
  branchName?: string;
  cashierName?: string;
}): DetailItem {
  return {
    id: sr.id,
    title: `Receipt #${sr.receiptNumber}`,
    sku: `Payment: ${sr.paymentMethod.replaceAll('_', ' ').toUpperCase()}`,
    category: sr.branchName ?? 'Main Branch',
    note: `Completed: ${sr.completedAt || 'N/A'}${sr.cashierName ? ` · Cashier: ${sr.cashierName}` : ''}`,
    value: formatMoney(sr.total),
    subValue: `Tax: ${formatMoney(sr.tax || '0')} · Discount: ${formatMoney(sr.discount || '0')}`,
    statusTag: sr.status.replaceAll('_', ' ').toUpperCase(),
    statusTone: sr.status === 'completed' ? 'green' : sr.status === 'partially_refunded' ? 'amber' : 'red',
  };
}

function buildSalesByCategoryDrilldown(
  report: ReportsWorkspace,
  options?: { focusCategory?: string; canViewProfit?: boolean; canViewCost?: boolean },
): MetricDrilldownConfig {
  const canViewProfit = Boolean(options?.canViewProfit);
  const canViewCost = Boolean(options?.canViewCost);
  const focusCategory = options?.focusCategory?.trim();

  const categoryItems: DetailItem[] = report.sales.topCategories.map((cat) => {
    const children = report.sales.topProducts
      .filter((product) => (product.category || 'Uncategorized') === cat.name)
      .map((product) => ({
        id: `${product.sku}-${product.unit}`,
        title: product.name,
        sku: product.sku,
        category: product.category || cat.name,
        quantity: product.quantity,
        unit: product.unit,
        note: `${product.quantity} ${product.unit} sold`,
        value: formatMoney(product.sales),
        subValue: canViewProfit
          ? `Profit: ${formatMoney(product.profit)}`
          : canViewCost
            ? `Cost: ${formatMoney(product.cost)}`
            : undefined,
        statusTag: 'Product',
        statusTone: 'green' as const,
      }));

    return {
      id: `category-${cat.name}`,
      title: cat.name,
      note: `${cat.quantity} items sold · ${children.length || 0} products in sub-report`,
      value: formatMoney(cat.sales),
      statusTag: 'Category',
      statusTone: 'blue',
      children: children.length
        ? children
        : [
            {
              id: `empty-${cat.name}`,
              title: `No product rows for ${cat.name}`,
              note: 'Category total is available for this period, but no matching product breakdown was returned.',
              value: formatMoney(cat.sales),
              statusTag: 'Category',
              statusTone: 'slate',
            },
          ],
    };
  });

  return {
    metricKey: focusCategory ? `sales_by_category:${focusCategory}` : 'sales_by_category',
    title: 'Sales by category',
    subtitle: 'Tap a category sub-report to view products sold in that category.',
    icon: 'tag',
    summaryLabel: 'Category sales',
    summaryValue: formatMoney(
      String(report.sales.topCategories.reduce((sum, cat) => sum + Number(cat.sales), 0).toFixed(2)),
    ),
    categoriesSummary: report.sales.topCategories.map((cat) => ({
      name: cat.name,
      value: Number(cat.sales),
      display: formatMoney(cat.sales),
    })),
    items: categoryItems,
    initialGroupTitle: focusCategory,
  };
}

/** Status tags used only for product-origin drill rows — ignore in health mix. */
const SYNTHETIC_STATUS_TAGS = new Set([
  'Units',
  'Base',
  'Revenue',
  'Cost',
  'Profit',
  'Catalog',
  'Product',
]);

function isHealthyTone(item: DetailItem): boolean {
  return (
    item.statusTone === 'green' ||
    item.statusTag === 'In Stock' ||
    item.statusTag === 'Active (On POS)' ||
    item.statusTag === 'Active' ||
    item.statusTag === 'RECEIVED' ||
    item.statusTag === 'COMPLETED' ||
    item.statusTag === 'Balanced'
  );
}

function isWarningTone(item: DetailItem): boolean {
  return item.statusTone === 'amber' || item.statusTag === 'Low Stock' || item.statusTag === 'Partially Paid';
}

function isCriticalTone(item: DetailItem): boolean {
  return (
    item.statusTone === 'red' ||
    item.statusTag === 'Out of Stock' ||
    item.statusTag === 'Unpaid Balance' ||
    item.statusTag === 'CANCELLED' ||
    item.statusTag === 'Discrepancy'
  );
}

function buildScopedDonutSegments(
  sourceItems: DetailItem[],
  leafPool: DetailItem[],
  rootCategories?: MetricDrilldownConfig['categoriesSummary'],
  atRoot = true,
): Array<{ label: string; count: number; percentage: number; color: string; note?: string }> {
  if (atRoot && rootCategories && rootCategories.length > 0) {
    const totalVal = rootCategories.reduce((sum, c) => sum + c.value, 0) || 1;
    return rootCategories.slice(0, 6).map((cat, idx) => ({
      label: cat.name,
      count: cat.value,
      percentage: Math.round((cat.value / totalVal) * 100),
      color: CHART_COLORS[idx % CHART_COLORS.length]!,
      note: cat.display,
    }));
  }

  if (sourceItems.some((item) => item.children?.length)) {
    const groups = sourceItems.map((item) => ({
      label: item.title,
      count: item.children?.length ?? 0,
      value: parseDisplayValue(item.value) || (item.children?.length ?? 0),
      note: item.note,
    }));
    const totalVal = groups.reduce((sum, g) => sum + Math.abs(g.value), 0) || 1;
    return groups.slice(0, 6).map((group, idx) => ({
      label: group.label,
      count: group.count,
      percentage: Math.round((Math.abs(group.value) / totalVal) * 100),
      color: CHART_COLORS[idx % CHART_COLORS.length]!,
      note: group.note ?? `${group.count} records`,
    }));
  }

  const valued = leafPool
    .map((item) => ({
      label: item.title,
      value: parseDisplayValue(item.value),
      note: item.note || item.subValue,
    }))
    .filter((entry) => entry.value !== 0)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  if (valued.length > 0) {
    const totalVal = valued.reduce((sum, entry) => sum + Math.abs(entry.value), 0) || 1;
    const top = valued.slice(0, 5);
    const restVal = valued.slice(5).reduce((sum, entry) => sum + Math.abs(entry.value), 0);
    const segments = top.map((entry, idx) => ({
      label: entry.label,
      count: entry.value,
      percentage: Math.round((Math.abs(entry.value) / totalVal) * 100),
      color: CHART_COLORS[idx % CHART_COLORS.length]!,
      note: entry.note,
    }));
    if (restVal > 0) {
      segments.push({
        label: `Others (${valued.length - top.length})`,
        count: restVal,
        percentage: Math.max(1, Math.round((restVal / totalVal) * 100)),
        color: '#94A3B8',
        note: 'Remaining share',
      });
    }
    return segments;
  }

  const totalCount = Math.max(leafPool.length, 1);
  const healthyCount = leafPool.filter(isHealthyTone).length;
  const warningCount = leafPool.filter(isWarningTone).length;
  const criticalCount = leafPool.filter(isCriticalTone).length;
  return [
    {
      label: 'Healthy / Complete',
      count: healthyCount,
      percentage: Math.round((healthyCount / totalCount) * 100) || 100,
      color: '#1A593B',
    },
    ...(warningCount > 0
      ? [
          {
            label: 'Pending / Attention',
            count: warningCount,
            percentage: Math.round((warningCount / totalCount) * 100),
            color: '#B45309',
          },
        ]
      : []),
    ...(criticalCount > 0
      ? [
          {
            label: 'Critical / Unpaid',
            count: criticalCount,
            percentage: Math.round((criticalCount / totalCount) * 100),
            color: '#B42318',
          },
        ]
      : []),
  ];
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
  const { width } = useWindowDimensions();
  const phone = width < 640;
  const { showAlert } = useIosAlert();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  /** Nested drill path — each entry narrows charts + list until a leaf origin. */
  const [groupStack, setGroupStack] = useState<DetailItem[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [exportingDetail, setExportingDetail] = useState(false);

  useEffect(() => {
    const initial =
      config.initialGroupTitle
        ? config.items.find((item) => item.title === config.initialGroupTitle && item.children?.length) ??
          null
        : null;
    setGroupStack(initial ? [initial] : []);
    setSearch('');
    setStatusFilter('all');
    setExpandedId(null);
    // Only re-open when the drilldown identity changes — not when parent rebuilds items.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- config.items is intentionally omitted
  }, [config.metricKey, config.initialGroupTitle]);

  const rootItems = useMemo(
    () =>
      config.items.some((item) => item.children?.length)
        ? config.items
        : buildStatusGroups(config.items) ?? config.items,
    [config.items],
  );
  const activeGroup = groupStack[groupStack.length - 1] ?? null;
  const sourceItems = activeGroup?.children?.length ? activeGroup.children : rootItems;
  const atRoot = groupStack.length === 0;

  const statusOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of sourceItems) {
      const tag = item.statusTag?.trim();
      if (!tag) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [sourceItems]);

  const filteredItems = useMemo(() => {
    return sourceItems.filter((item) => {
      if (statusFilter !== 'all' && item.statusTag !== statusFilter) return false;
      if (!search.trim()) return true;
      return matchesDetailSearch(item, search.toLowerCase().trim());
    });
  }, [sourceItems, search, statusFilter]);

  /** Leaves under the current drill level only — charts follow this scope. */
  const leafPool = useMemo(() => flattenDetailItems(sourceItems), [sourceItems]);
  const hasGroupChildren = sourceItems.some((item) => item.children?.length);
  /** Donut center should match visible groups/rows, not nested origin leaves. */
  const chartRecordCount = hasGroupChildren ? sourceItems.length : leafPool.length;

  const statusLeafPool = useMemo(
    () =>
      leafPool.filter(
        (item) => item.statusTag && !SYNTHETIC_STATUS_TAGS.has(item.statusTag),
      ),
    [leafPool],
  );

  const totalCount = Math.max(statusLeafPool.length, 1);
  const healthyCount = statusLeafPool.filter(isHealthyTone).length;
  const warningCount = statusLeafPool.filter(isWarningTone).length;
  const criticalCount = statusLeafPool.filter(isCriticalTone).length;

  const donutSegments = useMemo(
    () => buildScopedDonutSegments(sourceItems, leafPool, config.categoriesSummary, atRoot),
    [sourceItems, leafPool, config.categoriesSummary, atRoot],
  );

  const topRecordRows = useMemo(() => {
    const chartSource = sourceItems.some((item) => item.children?.length)
      ? sourceItems
      : leafPool.filter((item) => !String(item.id ?? '').startsWith('empty-'));
    return chartSource
      .map((item, idx) => ({
        key: `${item.id || item.title}-${idx}`,
        label: item.title,
        value: parseDisplayValue(item.value),
        display: item.value,
        note: item.sku || item.category || item.note || undefined,
      }))
      .filter((row) => row.value !== 0)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 6);
  }, [sourceItems, leafPool]);

  const statusMix = useMemo(() => {
    const total = totalCount || 1;
    return [
      { label: 'Healthy', count: healthyCount, pct: (healthyCount / total) * 100, color: '#1A593B' },
      { label: 'Attention', count: warningCount, pct: (warningCount / total) * 100, color: '#D97706' },
      { label: 'Critical', count: criticalCount, pct: (criticalCount / total) * 100, color: '#BE123C' },
    ].filter((entry) => entry.count > 0);
  }, [totalCount, healthyCount, warningCount, criticalCount]);

  const openItem = (item: DetailItem, rowKey: string) => {
    if (item.children?.length) {
      setGroupStack((stack) => {
        const current = stack[stack.length - 1];
        // Prevent breadcrumb loops (same group pushed again).
        if (current && (current.id === item.id || current === item)) return stack;
        if (stack.some((group) => group.id === item.id && group.title === item.title)) {
          return stack;
        }
        return [...stack, item];
      });
      setSearch('');
      setStatusFilter('all');
      setExpandedId(null);
      return;
    }
    // Leaf with only a destination and no detail fields → go there immediately.
    const hasDetail = Boolean(
      item.sku || item.category || item.note || item.subValue || item.quantity != null,
    );
    if (item.actionHref && !hasDetail) {
      router.push(item.actionHref as never);
      return;
    }
    // Otherwise expand inline (catalog link, if any, appears in the detail panel).
    setExpandedId((current) => (current === rowKey ? null : rowKey));
  };

  const popGroup = () => {
    setGroupStack((stack) => stack.slice(0, -1));
    setSearch('');
    setStatusFilter('all');
    setExpandedId(null);
  };

  const jumpToStackIndex = (index: number) => {
    setGroupStack((stack) => (index < 0 ? [] : stack.slice(0, index + 1)));
    setSearch('');
    setStatusFilter('all');
    setExpandedId(null);
  };

  const exportDetailList = async () => {
    if (exportingDetail) return;
    setExportingDetail(true);
    try {
      const source = filteredItems.length ? filteredItems : sourceItems;
      const trail = groupStack.map((group) => group.title).join(' / ');
      const output = buildDetailListCsv(
        trail ? `${config.title} — ${trail}` : config.title,
        source,
        { rangeLabel, branchName },
      );
      await saveReportExport(output.bytes, output.fileName, 'csv');
      showAlert({
        type: 'success',
        title: 'Export ready',
        message: `${output.fileName} has been downloaded.`,
      });
    } catch (error) {
      showAlert({
        type: 'error',
        title: 'Export failed',
        message: error instanceof Error ? error.message : 'Could not export this report.',
      });
    } finally {
      setExportingDetail(false);
    }
  };

  const parentTitle =
    groupStack.length > 1 ? groupStack[groupStack.length - 2]!.title : config.title;

  return (
    <View className="w-full gap-5">
      <View className="flex-row items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3">
        <Pressable
          onPress={() => {
            if (groupStack.length) {
              popGroup();
              return;
            }
            onBack();
          }}
          className="min-w-0 shrink flex-row items-center rounded-xl bg-slate-100 px-3.5 py-2 active:bg-slate-200"
        >
          <Feather name="arrow-left" size={16} color="#1E293B" />
          <Text className="ml-2 min-w-0 shrink text-sm font-semibold text-slate-800" numberOfLines={1}>
            {groupStack.length ? (phone ? 'Back' : `Back to ${parentTitle}`) : 'Back to Reports'}
          </Text>
        </Pressable>
        <View className="min-w-0 shrink flex-row items-center gap-2">
          {activeGroup ? (
            <Text className="min-w-0 shrink text-right text-xs font-medium text-brand-800" numberOfLines={1}>
              Level {groupStack.length} · {sourceItems.length} records
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Export detail report"
            disabled={exportingDetail}
            onPress={() => void exportDetailList()}
            className="min-h-9 flex-row items-center rounded-xl bg-brand-700 px-3 active:opacity-90"
          >
            <Feather name="download" size={14} color="#FFFFFF" />
            <Text className="ml-1.5 text-[13px] font-medium text-white">
              {exportingDetail ? 'Exporting…' : 'Export'}
            </Text>
          </Pressable>
        </View>
      </View>

      {groupStack.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="flex-row items-center gap-1.5">
            <Pressable
              onPress={() => jumpToStackIndex(-1)}
              className="rounded-full bg-slate-100 px-3 py-1.5 active:bg-slate-200"
            >
              <Text className="text-xs font-semibold text-slate-700">{config.title}</Text>
            </Pressable>
            {groupStack.map((group, index) => (
              <View key={`${group.id}-${index}`} className="flex-row items-center gap-1.5">
                <Feather name="chevron-right" size={12} color="#94A3B8" />
                <Pressable
                  onPress={() => jumpToStackIndex(index)}
                  className={`rounded-full px-3 py-1.5 ${
                    index === groupStack.length - 1 ? 'bg-brand-700' : 'bg-slate-100'
                  }`}
                >
                  <Text
                    className={`text-xs font-semibold ${
                      index === groupStack.length - 1 ? 'text-white' : 'text-slate-700'
                    }`}
                  >
                    {group.title}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        </ScrollView>
      ) : null}

      <View className="rounded-2xl border border-brand-100 bg-brand-50/60 p-5">
        <View className="flex-row flex-wrap items-center justify-between gap-4">
          <View className="min-w-[220px] flex-1 flex-row items-center">
            <View className="mr-3.5 h-12 w-12 items-center justify-center rounded-xl bg-brand-700">
              <Feather name={config.icon} size={20} color="#FFFFFF" />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-xl font-semibold text-slate-900">
                {activeGroup ? activeGroup.title : config.title}
              </Text>
              <Text className="mt-1 text-xs leading-4 text-slate-600">
                {activeGroup
                  ? `${activeGroup.note || 'Narrowed to this group — charts and list update here.'}`
                  : config.subtitle}
              </Text>
              <Text className="mt-1 text-[11px] font-medium text-brand-800">
                {rangeLabel} · {branchName}
              </Text>
            </View>
          </View>
          <View
            className={
              phone
                ? 'w-full flex-row items-center justify-between rounded-xl border border-brand-100 bg-white px-4 py-3'
                : 'items-end rounded-xl border border-brand-100 bg-white px-4 py-3'
            }
          >
            <Text
              className="min-w-0 shrink text-[11px] font-medium uppercase tracking-wide text-slate-400"
              numberOfLines={1}
            >
              {activeGroup ? activeGroup.title : config.summaryLabel}
            </Text>
            <Text className={`text-xl font-semibold text-brand-800 ${phone ? 'ml-3' : 'mt-1'}`}>
              {activeGroup ? activeGroup.value : config.summaryValue}
            </Text>
          </View>
        </View>
      </View>

      <View
        className="flex-row flex-wrap gap-4"
        style={{ alignItems: topRecordRows.length > 0 && !phone ? 'stretch' : 'flex-start' }}
      >
        <ResponsivePanel full={topRecordRows.length === 0} stretch={topRecordRows.length > 0}>
          <ReportCard
            fill={topRecordRows.length > 0 && !phone}
            title="Distribution"
            subtitle={
              activeGroup
                ? `Share inside ${activeGroup.title}.`
                : 'Share of total value across records.'
            }
          >
            <DonutChart
              total={chartRecordCount}
              totalLabel={hasGroupChildren ? 'Groups' : 'Records'}
              segments={donutSegments}
              onSegmentPress={
                hasGroupChildren
                  ? (seg) => {
                      const group = sourceItems.find(
                        (item) => item.title === seg.label && item.children?.length,
                      );
                      if (group) openItem(group, String(group.id || group.title));
                    }
                  : undefined
              }
            />
            {statusMix.length > 1 ? (
              <View className="mt-5 gap-2 border-t border-slate-100 pt-4">
                <View className="h-2 w-full flex-row overflow-hidden rounded-full bg-slate-100">
                  {statusMix.map((entry) => (
                    <View
                      key={entry.label}
                      style={{ width: `${entry.pct}%`, backgroundColor: entry.color }}
                    />
                  ))}
                </View>
                <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1">
                  {statusMix.map((entry) => (
                    <View key={entry.label} className="flex-row items-center gap-1.5">
                      <View
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: entry.color }}
                      />
                      <Text className="text-xs text-slate-500">
                        {entry.label}{' '}
                        <Text className="font-semibold text-slate-800">{entry.count}</Text>
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </ReportCard>
        </ResponsivePanel>

        {topRecordRows.length > 0 ? (
          <ResponsivePanel stretch>
            <ReportCard
              fill={!phone}
              title="Top records"
              subtitle={
                activeGroup
                  ? `Largest values in ${activeGroup.title}.`
                  : 'Largest values in this report.'
              }
            >
              <ProductBarChart
                rows={topRecordRows}
                height={phone ? 260 : 320}
                emptyLabel="No values to chart for this period."
              />
            </ReportCard>
          </ResponsivePanel>
        ) : null}
      </View>

      <View className="flex-row flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <View className="min-h-11 min-w-[240px] flex-1 flex-row items-center rounded-xl border border-slate-200 bg-slate-50 px-3">
          <Feather name="search" size={16} color="#81776E" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={`Search ${sourceItems.length} records by name, invoice, PO, SKU…`}
            placeholderTextColor="#81776E"
            className="ml-2 flex-1 text-sm text-slate-900"
          />
          {search ? (
            <Pressable onPress={() => setSearch('')}>
              <Feather name="x-circle" size={16} color="#81776E" />
            </Pressable>
          ) : null}
        </View>

        <View className="flex-row flex-wrap gap-1.5">
          <Pressable
            onPress={() => setStatusFilter('all')}
            className={`rounded-full px-3 py-2 ${statusFilter === 'all' ? 'bg-brand-700' : 'bg-slate-50'}`}
          >
            <Text className={`text-xs font-semibold ${statusFilter === 'all' ? 'text-white' : 'text-slate-700'}`}>
              All ({sourceItems.length})
            </Text>
          </Pressable>
          {statusOptions.map(([tag, count]) => (
            <Pressable
              key={tag}
              onPress={() => setStatusFilter(tag)}
              className={`rounded-full px-3 py-2 ${statusFilter === tag ? 'bg-brand-700' : 'bg-slate-50'}`}
            >
              <Text className={`text-xs font-semibold ${statusFilter === tag ? 'text-white' : 'text-slate-700'}`}>
                {tag} ({count})
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <ReportCard
        title={
          activeGroup
            ? `${activeGroup.title} records (${filteredItems.length})`
            : `Itemized log details (${filteredItems.length})`
        }
        subtitle={
          activeGroup
            ? sourceItems.some((item) => item.children?.length)
              ? 'Tap a group to narrow further. Leaf rows expand details.'
              : 'Tap a row to expand details. Use Open product catalog for the product page.'
            : rootItems.some((item) => item.children?.length)
              ? 'Tap a group to narrow charts and list. Leaf rows expand in place.'
              : 'Tap a row to expand details. Use Open product catalog for the product page.'
        }
      >
        {filteredItems.length > 0 ? (
          <View className="gap-2.5">
            {filteredItems.map((item, index) => {
              const hasChildren = Boolean(item.children?.length);
              const rowKey = String(item.id || `${item.title}-${index}`);
              const expanded = expandedId === rowKey;
              const metaText = [item.sku, item.category, item.note].filter(Boolean).join(' · ');
              const row = (
                <View
                  className={`rounded-2xl border p-4 ${
                    hasChildren
                      ? 'border-brand-100 bg-brand-50/40'
                      : expanded
                        ? 'rounded-b-none border-brand-200 bg-white'
                        : 'border-slate-100 bg-slate-50/80'
                  }`}
                >
                  <View className="flex-row items-start justify-between gap-3">
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-semibold text-slate-900" numberOfLines={2}>
                        {item.title}
                      </Text>
                      {(item.statusTag && !hasChildren) || hasChildren ? (
                        <View className="mt-1.5 flex-row flex-wrap items-center gap-1.5">
                          {item.statusTag && !hasChildren ? (
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
                          {hasChildren ? (
                            <View className="rounded-md bg-white px-2 py-0.5">
                              <Text className="text-[10px] font-bold text-brand-800">
                                {item.children!.length}{' '}
                                {item.children!.some((child) => child.unit || /unit/i.test(child.title))
                                  ? item.children!.length === 1
                                    ? 'selling unit'
                                    : 'selling units'
                                  : item.children!.length === 1
                                    ? 'item'
                                    : 'items'}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                      ) : null}
                    </View>

                    <View className="shrink-0 flex-row items-center gap-1.5">
                      <Text className="text-sm font-semibold text-slate-900">{item.value}</Text>
                      <Feather
                        name={
                          hasChildren
                            ? 'chevron-right'
                            : expanded
                              ? 'chevron-up'
                              : 'chevron-down'
                        }
                        size={16}
                        color={hasChildren || expanded ? '#1A593B' : '#94A3B8'}
                      />
                    </View>
                  </View>

                  {metaText || hasChildren ? (
                    <Text className="mt-1.5 text-xs leading-4 text-slate-500" numberOfLines={2}>
                      {metaText}
                      {hasChildren ? `${metaText ? ' · ' : ''}Tap to view list` : ''}
                    </Text>
                  ) : null}
                  {item.subValue ? (
                    <Text className="mt-1 text-right text-[11px] font-medium text-brand-800">
                      {item.subValue}
                    </Text>
                  ) : null}
                </View>
              );

              const details: Array<[string, string]> = expanded
                ? ([
                    ['Reference', item.sku],
                    ['Category / Branch', item.category],
                    [
                      'Quantity',
                      item.quantity != null ? `${item.quantity}${item.unit ? ` ${item.unit}` : ''}` : undefined,
                    ],
                    ['Status', item.statusTag],
                    ['Details', item.note],
                    ['Amount', item.value],
                    ['Breakdown', item.subValue],
                  ].filter((entry): entry is [string, string] => Boolean(entry[1])))
                : [];

              return (
                <View key={rowKey}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: !hasChildren && !item.actionHref ? expanded : undefined }}
                    onPress={() => openItem(item, rowKey)}
                    className="active:opacity-90"
                  >
                    {row}
                  </Pressable>
                  {expanded ? (
                    <View className="rounded-b-2xl border border-t-0 border-brand-200 bg-brand-50/30 px-4 py-3">
                      <View className="gap-2">
                        {details.map(([label, value]) => (
                          <View key={label} className="flex-row flex-wrap items-baseline gap-x-4 gap-y-0.5">
                            <Text
                              className="text-[11px] font-medium uppercase tracking-wide text-slate-400"
                              style={{ width: 128 }}
                            >
                              {label}
                            </Text>
                            <Text className="min-w-0 flex-1 text-xs leading-4 text-slate-700">{value}</Text>
                          </View>
                        ))}
                        {item.actionHref ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Open ${item.title} in catalog`}
                            onPress={() => router.push(item.actionHref as never)}
                            className="mt-2 min-h-10 flex-row items-center justify-center rounded-xl bg-brand-700 px-3 active:opacity-90"
                          >
                            <Feather name="external-link" size={14} color="#FFFFFF" />
                            <Text className="ml-2 text-sm font-semibold text-white">
                              Open product catalog
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : (
          <View className="items-center justify-center py-12">
            <Feather name="inbox" size={36} color="#C7C0B8" />
            <Text className="mt-3 text-sm text-slate-500">No records match your filter criteria.</Text>
          </View>
        )}
      </ReportCard>
    </View>
  );
}

function OverviewReport({
  report,
  from,
  to,
  setSection,
  onOpenDetail,
}: {
  report: ReportsWorkspace;
  from: string;
  to: string;
  setSection(section: ReportSection): void;
  onOpenDetail(config: MetricDrilldownConfig): void;
}) {
  const { width } = useWindowDimensions();
  const stackedPanels = width < 960;
  const { currentUser } = useSession();
  const permissions = currentUser?.permissions ?? [];
  const canViewCost = permissions.includes('reports:view_cost');
  const canViewProfit = permissions.includes('reports:view_profit');

  const openNetSales = () =>
    onOpenDetail({
      metricKey: 'net_sales',
      title: 'Net Sales Receipts Log',
      subtitle: 'Total revenue earned after customer refunds and discounts.',
      icon: 'activity',
      summaryLabel: 'Net Sales Revenue',
      summaryValue: formatMoney(report.kpis.netSales),
      items:
        report.sales.salesReceipts && report.sales.salesReceipts.length > 0
          ? report.sales.salesReceipts.map(mapSalesReceiptItem)
          : report.sales.topProducts.map((p) => ({
              id: p.sku,
              title: p.name,
              sku: p.sku,
              note: `${p.quantity} ${p.unit} sold`,
              value: formatMoney(p.sales),
              subValue: canViewProfit ? `Profit: ${formatMoney(p.profit)}` : undefined,
            })),
    });

  const openGrossProfit = () =>
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
    });

  const openCogs = () =>
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
    });

  const openTransactions = () =>
    onOpenDetail({
      metricKey: 'transactions',
      title: 'Sales Checkout Receipt Logs',
      subtitle: 'Total completed sales transactions across payment methods.',
      icon: 'file-text',
      tone: 'blue',
      summaryLabel: 'Completed Transactions',
      summaryValue: `${report.kpis.transactions} sales`,
      items:
        report.sales.salesReceipts && report.sales.salesReceipts.length > 0
          ? report.sales.paymentMethods.map((m) => {
              const children = report.sales.salesReceipts!
                .filter((sr) => sr.paymentMethod === m.method)
                .map(mapSalesReceiptItem);
              return {
                id: m.method,
                title: m.method.replaceAll('_', ' ').toUpperCase(),
                note: `${m.transactions} checkout payments`,
                value: formatMoney(m.total),
                children: children.length ? children : undefined,
              } satisfies DetailItem;
            })
          : report.sales.paymentMethods.map((m) => ({
              id: m.method,
              title: m.method.replaceAll('_', ' ').toUpperCase(),
              note: `${m.transactions} checkout payments`,
              value: formatMoney(m.total),
            })),
    });

  const openInventory = () =>
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
    });

  const openPayables = () =>
    onOpenDetail({
      metricKey: 'payables',
      title: 'Supplier Payables Breakdown',
      subtitle: 'Current unpaid purchase order invoices and supplier accounts payable balance.',
      icon: 'credit-card',
      tone: 'red',
      summaryLabel: 'Outstanding Payables',
      summaryValue: formatMoney(report.purchasing.outstandingPayables),
      items:
        report.purchasing.payablesInvoices && report.purchasing.payablesInvoices.length > 0
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
    });

  const openCashVariance = () =>
    onOpenDetail({
      metricKey: 'cash_variance',
      title: 'Cash Shift Accountability Logs',
      subtitle: 'Reconciliation variance between expected and counted register cash.',
      icon: 'briefcase',
      tone: Number(report.cash.variance) === 0 ? 'brand' : 'red',
      summaryLabel: 'Net Cash Variance',
      summaryValue: formatMoney(report.cash.variance),
      items:
        report.cash.shiftLogs && report.cash.shiftLogs.length > 0
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
    });

  const topProductBars = [...report.sales.topProducts]
    .sort((a, b) => Number(b.sales) - Number(a.sales))
    .slice(0, 6)
    .map((p) => ({
      key: p.sku,
      label: p.name,
      value: Number(p.sales),
      display: formatMoney(p.sales),
      note: `${p.quantity} ${p.unit}`,
    }));

  const categoryRows = report.sales.topCategories.slice(0, 6);
  const useProductMix = categoryRows.length === 0 && report.sales.topProducts.length > 0;
  const wheelSegments = useProductMix
    ? (() => {
        const totalSales =
          report.sales.topProducts.reduce((sum, p) => sum + Number(p.sales), 0) || 1;
        return report.sales.topProducts.slice(0, 6).map((product, idx) => ({
          label: product.name,
          count: product.quantity,
          percentage: Math.round((Number(product.sales) / totalSales) * 100),
          color: CHART_COLORS[idx % CHART_COLORS.length]!,
          note: `${formatMoney(product.sales)} · ${product.quantity} sold`,
        }));
      })()
    : (() => {
        const totalSales = categoryRows.reduce((sum, c) => sum + Number(c.sales), 0) || 1;
        return categoryRows.map((cat, idx) => ({
          label: cat.name,
          count: cat.quantity,
          percentage: Math.round((Number(cat.sales) / totalSales) * 100),
          color: CHART_COLORS[idx % CHART_COLORS.length]!,
          note: `${formatMoney(cat.sales)} · ${cat.quantity} sold`,
        }));
      })();

  const wheelTotal = useProductMix
    ? report.sales.topProducts.reduce((sum, p) => sum + p.quantity, 0)
    : categoryRows.reduce((sum, c) => sum + c.quantity, 0);

  const paymentTotal =
    report.sales.paymentMethods.reduce((sum, method) => sum + Number(method.total), 0) || 1;
  const marginPct = Math.max(0, Math.min(100, Math.round(Number(report.kpis.grossMarginPercent || 0))));
  const successPct = Math.max(
    0,
    Math.min(100, Math.round(100 - Number(report.kpis.refundRatePercent || 0))),
  );
  const stockAlerts = report.inventory.lowStock.slice(0, 4);
  const cashNegative = Number(report.cash.variance) < 0;

  return (
    <View className="gap-4">
      <View className="w-full flex-row flex-wrap gap-3">
          <MetricCard
            label="Net sales"
            value={formatMoney(report.kpis.netSales)}
            note={`${report.kpis.transactions} txns`}
            icon="activity"
            tone="brand"
            trend="up"
            onPress={openNetSales}
          />
          {canViewProfit ? (
            <MetricCard
              label="Gross profit"
              value={formatMoney(report.kpis.grossProfit)}
              note={`${Number(report.kpis.grossMarginPercent).toFixed(1)}% margin`}
              icon="trending-up"
              tone="blue"
              trend="up"
              onPress={openGrossProfit}
            />
          ) : null}
          {canViewCost ? (
            <MetricCard
              label="COGS"
              value={formatMoney(report.kpis.netCost)}
              icon="truck"
              tone="amber"
              onPress={openCogs}
            />
          ) : null}
          <MetricCard
            label="Transactions"
            value={String(report.kpis.transactions)}
            note={`${formatMoney(report.kpis.averageTransaction)} avg`}
            icon="shopping-cart"
            tone="sky"
            onPress={openTransactions}
          />
          {canViewCost ? (
            <MetricCard
              label="Inventory"
              value={formatMoney(report.inventory.inventoryValue)}
              note={
                report.inventory.outOfStockCount
                  ? `${report.inventory.outOfStockCount} out of stock`
                  : undefined
              }
              icon="package"
              tone="purple"
              onPress={openInventory}
            />
          ) : null}
          <MetricCard
            label="Payables"
            value={formatMoney(report.purchasing.outstandingPayables)}
            icon="credit-card"
            tone="slate"
            onPress={openPayables}
          />
          <MetricCard
            label="Cash variance"
            value={formatMoney(report.cash.variance)}
            icon="briefcase"
            tone={cashNegative ? 'rose' : 'brand'}
            trend={cashNegative ? 'down' : 'up'}
            onPress={openCashVariance}
          />
      </View>

      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          alignContent: 'flex-start',
          gap: 12,
        }}
      >
        <View
          style={
            stackedPanels
              ? { width: '100%', alignSelf: 'flex-start' }
              : { width: '58%', maxWidth: '58%', flexGrow: 0, alignSelf: 'flex-start' }
          }
        >
          <ReportCard
            title="Sales trend"
            subtitle="Daily sales — selected period"
            onPress={openNetSales}
          >
            <SalesLineChart trend={report.sales.trend} from={from} to={to} />
          </ReportCard>
        </View>
        <View
          style={
            stackedPanels
              ? { width: '100%', alignSelf: 'flex-start' }
              : { width: '40%', maxWidth: '40%', flexGrow: 0, alignSelf: 'flex-start' }
          }
        >
          <ReportCard
            title="Snapshot"
            subtitle="Payments, margin & stock"
            onPress={canViewProfit ? openGrossProfit : openTransactions}
          >
            <View className="gap-2.5">
              {canViewProfit ? (
                <View className="gap-1">
                  <View className="flex-row items-center justify-between gap-3">
                    <Text className="text-sm text-slate-600">Gross margin</Text>
                    <Text className="text-sm font-semibold text-slate-900">
                      {marginPct}% · {formatMoney(report.kpis.grossProfit)}
                    </Text>
                  </View>
                  <View className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                    <View
                      className="h-2.5 rounded-full bg-brand-700"
                      style={{ width: `${Math.max(marginPct, 2)}%` }}
                    />
                  </View>
                </View>
              ) : null}
              <View className="gap-1">
                <View className="flex-row items-center justify-between gap-3">
                  <Text className="text-sm text-slate-600">Checkout success</Text>
                  <Text className="text-sm font-semibold text-slate-900">
                    {successPct}% · {report.kpis.transactions} txns
                  </Text>
                </View>
                <View className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <View
                    className="h-2.5 rounded-full"
                    style={{ width: `${Math.max(successPct, 2)}%`, backgroundColor: '#5B4BDB' }}
                  />
                </View>
              </View>
              <View className="flex-row flex-wrap gap-2">
                <View className="min-w-[96px] flex-1 rounded-xl bg-[#E8F5EE] px-3 py-2.5">
                  <Text className="text-[10px] font-medium uppercase tracking-wide text-brand-800">
                    Avg ticket
                  </Text>
                  <Text className="mt-1 text-[15px] font-semibold text-slate-900">
                    {formatMoney(report.kpis.averageTransaction)}
                  </Text>
                </View>
                <View className="min-w-[96px] flex-1 rounded-xl bg-[#F4F0E6] px-3 py-2.5">
                  <Text className="text-[10px] font-medium uppercase tracking-wide text-amber-900">
                    Refund rate
                  </Text>
                  <Text className="mt-1 text-[15px] font-semibold text-slate-900">
                    {Number(report.kpis.refundRatePercent || 0).toFixed(1)}%
                  </Text>
                </View>
                <View className="min-w-[96px] flex-1 rounded-xl bg-[#EAF4FB] px-3 py-2.5">
                  <Text className="text-[10px] font-medium uppercase tracking-wide text-sky-900">
                    Items sold
                  </Text>
                  <Text className="mt-1 text-[15px] font-semibold text-slate-900">
                    {report.kpis.itemsSold}
                  </Text>
                </View>
              </View>

              <View className="gap-1.5 border-t border-slate-100 pt-2.5">
                <Text className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Payment mix
                </Text>
                {report.sales.paymentMethods.length ? (
                  report.sales.paymentMethods.slice(0, 4).map((method) => {
                    const pct = Math.round((Number(method.total) / paymentTotal) * 100);
                    return (
                      <View key={method.method} className="gap-1">
                        <View className="flex-row items-center justify-between gap-3">
                          <Text className="text-sm capitalize text-slate-700" numberOfLines={1}>
                            {method.method}
                          </Text>
                          <Text className="text-xs font-semibold text-slate-900">
                            {pct}% · {formatMoney(method.total)}
                          </Text>
                        </View>
                        <View className="h-2 overflow-hidden rounded-full bg-slate-100">
                          <View
                            className="h-2 rounded-full bg-slate-700"
                            style={{ width: `${Math.max(pct, 3)}%` }}
                          />
                        </View>
                      </View>
                    );
                  })
                ) : (
                  <Text className="text-sm text-slate-500">No payments in this period.</Text>
                )}
              </View>

              <View className="gap-1.5 border-t border-slate-100 pt-2.5">
                <View className="flex-row items-center justify-between">
                  <Text className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Stock alerts
                  </Text>
                  <Text className="text-xs font-medium text-slate-500">
                    {report.inventory.outOfStockCount} out · {report.inventory.lowStockCount} low
                  </Text>
                </View>
                {stockAlerts.length ? (
                  <View className="gap-1.5">
                    {stockAlerts.map((item) => (
                      <View
                        key={item.id}
                        className="flex-row items-center justify-between rounded-xl bg-rose-50/80 px-3 py-2"
                      >
                        <View className="min-w-0 flex-1 pr-3">
                          <Text className="text-sm font-medium text-slate-900" numberOfLines={1}>
                            {item.name}
                          </Text>
                          <Text className="text-[11px] text-slate-500" numberOfLines={1}>
                            {item.branchName}
                          </Text>
                        </View>
                        <View className="rounded-full bg-white px-2.5 py-1">
                          <Text className="text-[11px] font-semibold text-rose-700">
                            {item.quantity} {item.unit}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                ) : report.inventory.outOfStockCount > 0 ? (
                  <View className="flex-row items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5">
                    <Feather name="alert-circle" size={16} color="#D97706" />
                    <Text className="flex-1 text-xs leading-4 text-amber-900">
                      {report.inventory.outOfStockCount} products are out of stock. Restock soon to
                      avoid missed sales.
                    </Text>
                  </View>
                ) : (
                  <View className="rounded-xl bg-[#E8F5EE] px-3 py-2.5">
                    <Text className="text-xs leading-4 text-brand-900">
                      Stock levels look healthy for this period.
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </ReportCard>
        </View>
      </View>

      <ReportCard
        title="Sales mix"
        subtitle={
          useProductMix
            ? 'Product share and top sellers by gross sales'
            : 'Category share and top sellers by gross sales'
        }
      >
        <View className="gap-5">
          <View>
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="text-sm font-semibold text-slate-800">
                {useProductMix ? 'By product' : 'By category'}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  onOpenDetail(
                    buildSalesByCategoryDrilldown(report, {
                      canViewProfit,
                      canViewCost,
                    }),
                  )
                }
                className="flex-row items-center"
              >
                <Text className="text-xs font-medium text-brand-700">Details</Text>
                <Feather name="chevron-right" size={14} color="#1A593B" />
              </Pressable>
            </View>
            {wheelSegments.length ? (
              <DonutChart
                total={wheelTotal}
                totalLabel="Sold"
                segments={wheelSegments}
                onSegmentPress={(seg) => {
                  if (useProductMix) {
                    setSection('products');
                    return;
                  }
                  onOpenDetail(
                    buildSalesByCategoryDrilldown(report, {
                      focusCategory: seg.label,
                      canViewProfit,
                      canViewCost,
                    }),
                  );
                }}
              />
            ) : (
              <Text className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                No category sales in this period.
              </Text>
            )}
          </View>

          <View className="border-t border-slate-100 pt-4">
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="text-sm font-semibold text-slate-800">Top products</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setSection('products')}
                className="flex-row items-center"
              >
                <Text className="text-xs font-medium text-brand-700">View all</Text>
                <Feather name="chevron-right" size={14} color="#1A593B" />
              </Pressable>
            </View>
            {topProductBars.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {topProductBars.map((row, index) => {
                  const share = Math.round(
                    (row.value / Math.max(topProductBars[0]?.value || 1, 1)) * 100,
                  );
                  return (
                    <View
                      key={row.key}
                      className="gap-1.5 rounded-xl bg-slate-50 px-3 py-2.5"
                      style={{ width: '48.5%', flexGrow: 1, minWidth: 220 }}
                    >
                      <View className="flex-row items-center justify-between gap-3">
                        <View className="min-w-0 flex-1 flex-row items-center gap-2.5">
                          <View className="h-8 w-8 items-center justify-center rounded-lg bg-brand-50">
                            <Text className="text-xs font-semibold text-brand-800">{index + 1}</Text>
                          </View>
                          <View className="min-w-0 flex-1">
                            <Text className="text-sm font-medium text-slate-900" numberOfLines={1}>
                              {row.label}
                            </Text>
                            <Text className="text-[11px] text-slate-400" numberOfLines={1}>
                              {row.note}
                            </Text>
                          </View>
                        </View>
                        <Text className="text-sm font-semibold text-slate-900">{row.display}</Text>
                      </View>
                      <View className="h-1.5 overflow-hidden rounded-full bg-white">
                        <View
                          className="h-1.5 rounded-full bg-brand-700"
                          style={{ width: `${Math.max(share, 4)}%` }}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : (
              <Text className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                No product sales in this period.
              </Text>
            )}
          </View>
        </View>
      </ReportCard>
    </View>
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
  const { currentUser } = useSession();
  const permissions = currentUser?.permissions ?? [];
  const canViewCost = permissions.includes('reports:view_cost');
  const canViewProfit = permissions.includes('reports:view_profit');

  return (
    <View className="w-full gap-4">
      <View className="w-full flex-row flex-wrap gap-3">
        <MetricCard
          label="Gross sales"
          value={formatMoney(report.kpis.grossSales)}
          icon="shopping-bag"
          onPress={() =>
            onOpenDetail({
              metricKey: 'gross_sales',
              title: 'Gross Sales Checkout Receipts',
              subtitle: 'Total gross sales before customer refunds and discounts.',
              icon: 'shopping-bag',
              summaryLabel: 'Gross Sales Volume',
              summaryValue: formatMoney(report.kpis.grossSales),
              items:
                report.sales.salesReceipts && report.sales.salesReceipts.length > 0
                  ? report.sales.salesReceipts.map(mapSalesReceiptItem)
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
          icon="activity"
          onPress={() =>
            onOpenDetail({
              metricKey: 'net_sales',
              title: 'Net Sales Revenue Receipts',
              subtitle: 'Gross sales less customer refunds.',
              icon: 'activity',
              summaryLabel: 'Net Sales Revenue',
              summaryValue: formatMoney(report.kpis.netSales),
              items:
                report.sales.salesReceipts && report.sales.salesReceipts.length > 0
                  ? report.sales.salesReceipts.map(mapSalesReceiptItem)
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

      <ResponsivePanel full>
        <ReportCard title="Sales trend" subtitle="Daily sales over the selected period">
          <SalesLineChart trend={report.sales.trend} from={from} to={to} />
        </ReportCard>
      </ResponsivePanel>

      <View className="w-full flex-row flex-wrap gap-4">
        <ResponsivePanel>
          <ReportCard title="Best-selling products" subtitle="Top products by gross sales" icon="star">
            <ProductBarChart
              emptyLabel="No products sold for this period."
              rows={report.sales.topProducts.slice(0, 8).map((item) => ({
                key: item.sku,
                label: item.name,
                note: `${item.quantity} ${item.unit}`,
                value: Number(item.sales),
                display: formatMoney(item.sales),
              }))}
            />
          </ReportCard>
        </ResponsivePanel>
        <ResponsivePanel>
          <ReportCard title="Payment methods" subtitle="Payments less customer refunds" icon="credit-card">
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

      <View className="w-full flex-row flex-wrap gap-4">
        <ResponsivePanel>
          <ReportCard
            title="Sales by category"
            subtitle="Tap a category for its product sub-report"
            icon="tag"
            onPress={() =>
              onOpenDetail(
                buildSalesByCategoryDrilldown(report, {
                  canViewProfit,
                  canViewCost,
                }),
              )
            }
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
              onRowPress={(row) =>
                onOpenDetail(
                  buildSalesByCategoryDrilldown(report, {
                    focusCategory: row.label,
                    canViewProfit,
                    canViewCost,
                  }),
                )
              }
            />
          </ReportCard>
        </ResponsivePanel>
        <ResponsivePanel>
          <ReportCard title="Sales by branch" subtitle="Revenue by branch" icon="map-pin">
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
        </ResponsivePanel>
      </View>
    </View>
  );
}

type ProductPerformanceRow = {
  id: string;
  title: string;
  sku?: string;
  category?: string;
  quantity?: number;
  unit?: string;
  baseQuantity?: number;
  baseUnit?: string;
  value: string;
  subValue?: string;
  netCost?: string | null;
  grossProfit?: string | null;
};

const PRODUCT_CARD_META: Record<
  string,
  {
    explanation: string;
    icon: ComponentProps<typeof Feather>['name'];
    tone: MetricTone;
    drillTitle: string;
    sortKey: 'revenue' | 'sellingQty' | 'baseQty' | 'cost' | 'profit';
    valueOf: (row: ProductPerformanceRow) => string;
    noteOf?: (row: ProductPerformanceRow) => string | undefined;
  }
> = {
  products_sold: {
    explanation: 'Unique products that sold at least once in this period.',
    icon: 'layers',
    tone: 'sky',
    drillTitle: 'Products that sold',
    sortKey: 'revenue',
    valueOf: (row) => row.value,
    noteOf: (row) =>
      `${row.quantity ?? 0} ${row.unit ?? 'sold'}${row.category ? ` · ${row.category}` : ''}`,
  },
  selling_units_sold: {
    explanation: 'Total packs, boxes, or pieces rung up at POS (as sold).',
    icon: 'package',
    tone: 'brand',
    drillTitle: 'Selling units by product',
    sortKey: 'sellingQty',
    valueOf: (row) => `${row.quantity ?? 0} ${row.unit ?? ''}`.trim(),
    noteOf: (row) => `Revenue ${row.value}${row.category ? ` · ${row.category}` : ''}`,
  },
  equivalent_base_units_sold: {
    explanation: 'Selling units converted to base inventory units (e.g. boxes → pieces).',
    icon: 'repeat',
    tone: 'blue',
    drillTitle: 'Base units by product',
    sortKey: 'baseQty',
    valueOf: (row) => `${row.baseQuantity ?? 0} ${row.baseUnit ?? 'base'}`.trim(),
    noteOf: (row) =>
      `${row.quantity ?? 0} ${row.unit ?? 'sold'} as selling units · ${row.value}`,
  },
  product_revenue: {
    explanation: 'Gross product line totals before customer refunds.',
    icon: 'shopping-bag',
    tone: 'amber',
    drillTitle: 'Revenue by product',
    sortKey: 'revenue',
    valueOf: (row) => row.value,
    noteOf: (row) => row.subValue,
  },
  net_product_sales: {
    explanation: 'Product revenue minus product refunds for the period.',
    icon: 'activity',
    tone: 'brand',
    drillTitle: 'Net product sales',
    sortKey: 'revenue',
    valueOf: (row) => row.value,
    noteOf: (row) =>
      row.subValue ??
      `${row.quantity ?? 0} ${row.unit ?? 'sold'}${row.category ? ` · ${row.category}` : ''}`,
  },
  cogs: {
    explanation: 'Inventory cost of sold items after return cost reversals.',
    icon: 'truck',
    tone: 'slate',
    drillTitle: 'COGS by product',
    sortKey: 'cost',
    valueOf: (row) => row.netCost ?? '—',
    noteOf: (row) => `Revenue ${row.value} · ${row.quantity ?? 0} ${row.unit ?? 'sold'}`,
  },
  gross_profit: {
    explanation: 'Net product sales minus cost of goods sold.',
    icon: 'trending-up',
    tone: 'purple',
    drillTitle: 'Gross profit by product',
    sortKey: 'profit',
    valueOf: (row) => row.grossProfit ?? '—',
    noteOf: (row) =>
      `Revenue ${row.value}${row.netCost ? ` · Cost ${row.netCost}` : ''}`,
  },
};

function sortProductRows(
  rows: ProductPerformanceRow[],
  sortKey: (typeof PRODUCT_CARD_META)[string]['sortKey'],
): ProductPerformanceRow[] {
  const score = (row: ProductPerformanceRow) => {
    if (sortKey === 'sellingQty') return Number(row.quantity ?? 0);
    if (sortKey === 'baseQty') return Number(row.baseQuantity ?? 0);
    if (sortKey === 'cost') return parseDisplayValue(row.netCost ?? undefined);
    if (sortKey === 'profit') return parseDisplayValue(row.grossProfit ?? undefined);
    return parseDisplayValue(row.value);
  };
  return [...rows].sort((a, b) => score(b) - score(a));
}

/** One row per product_id — merges pack/box/piece lines into a single distinct product. */
function collapseRowsToDistinctProducts(rows: ProductPerformanceRow[]): ProductPerformanceRow[] {
  const byId = new Map<string, ProductPerformanceRow[]>();
  for (const row of rows) {
    const list = byId.get(row.id) ?? [];
    list.push(row);
    byId.set(row.id, list);
  }
  return [...byId.values()].map((variants) => {
    const revenue = variants.reduce((sum, row) => sum + parseDisplayValue(row.value), 0);
    const sellingQty = variants.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0);
    const baseQty = variants.reduce((sum, row) => sum + Number(row.baseQuantity ?? 0), 0);
    const cost = variants.reduce((sum, row) => sum + parseDisplayValue(row.netCost ?? undefined), 0);
    const profit = variants.reduce((sum, row) => sum + parseDisplayValue(row.grossProfit ?? undefined), 0);
    const primary = [...variants].sort(
      (a, b) => parseDisplayValue(b.value) - parseDisplayValue(a.value),
    )[0]!;
    const units = [...new Set(variants.map((row) => row.unit).filter(Boolean))];
    const unitSummary = variants
      .map((row) => `${row.quantity ?? 0} ${row.unit ?? 'sold'}`)
      .join(' + ');
    const avg =
      sellingQty > 0 ? formatMoney(String(revenue / sellingQty)) : formatMoney('0');
    if (variants.length === 1) {
      return {
        ...primary,
        subValue:
          primary.subValue ||
          `${primary.quantity ?? 0} ${primary.unit ?? ''} (${primary.baseQuantity ?? 0} ${primary.baseUnit ?? 'base'}) • Avg Price: ${avg}`,
      };
    }
    return {
      ...primary,
      quantity: sellingQty,
      baseQuantity: baseQty,
      unit: units.length > 1 ? 'mixed' : primary.unit,
      value: formatMoney(String(revenue)),
      netCost: primary.netCost != null || cost > 0 ? formatMoney(String(cost)) : primary.netCost,
      grossProfit:
        primary.grossProfit != null || profit !== 0 ? formatMoney(String(profit)) : primary.grossProfit,
      subValue: `${unitSummary} (${baseQty} ${primary.baseUnit ?? 'base'}) • Avg Price: ${avg}`,
      note: `${variants.length} selling units`,
    };
  });
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
      formulaDescription?: string;
      isSensitive?: boolean;
    }>;
    rows: ProductPerformanceRow[];
  };
  onOpenDetail(config: MetricDrilldownConfig): void;
}) {
  const openCardDrilldown = (card: (typeof report.summaryCards)[number]) => {
    const meta =
      PRODUCT_CARD_META[card.cardId] ??
      ({
        explanation: card.formulaDescription ?? 'Product performance for this period.',
        icon: 'tag' as const,
        tone: 'brand' as const,
        drillTitle: card.label,
        sortKey: 'revenue' as const,
        valueOf: (row: ProductPerformanceRow) => row.value,
        noteOf: (row: ProductPerformanceRow) => row.subValue,
      } satisfies (typeof PRODUCT_CARD_META)[string]);

    const distinctCount = new Set(report.rows.map((row) => row.id)).size;
    const unitRowCount = report.rows.length;
    // Distinct collapse only for the Distinct Products Sold card.
    const useDistinct = card.cardId === 'products_sold';
    const sourceRows = useDistinct
      ? sortProductRows(collapseRowsToDistinctProducts(report.rows), meta.sortKey)
      : sortProductRows(report.rows, meta.sortKey);

    const items: DetailItem[] = sourceRows.map((row) => {
      const unitVariants = useDistinct
        ? report.rows.filter((candidate) => candidate.id === row.id)
        : [row];

      if (useDistinct && unitVariants.length > 1) {
        return {
          id: `product-${row.id}-${card.cardId}`,
          title: row.title,
          sku: row.sku,
          category: row.category,
          quantity: row.quantity,
          unit: row.unit,
          note: `${unitVariants.length} selling units · ${meta.noteOf?.(row) ?? row.subValue ?? ''}`.trim(),
          value: meta.valueOf(row),
          subValue: row.subValue,
          children: unitVariants.map((variant) => ({
            id: `unit-${variant.id}-${variant.unit ?? 'unit'}-${card.cardId}`,
            title: `${variant.unit ?? 'unit'} unit`,
            sku: variant.sku,
            category: variant.category,
            quantity: variant.quantity,
            unit: variant.unit,
            note: [
              `${variant.quantity ?? 0} ${variant.unit ?? 'sold'}`,
              `${variant.baseQuantity ?? 0} ${variant.baseUnit ?? 'base'}`,
              variant.netCost ? `Cost ${variant.netCost}` : null,
              variant.grossProfit ? `Profit ${variant.grossProfit}` : null,
            ]
              .filter(Boolean)
              .join(' · '),
            value: meta.valueOf(variant),
            subValue: variant.subValue,
            actionHref: `/product-form?id=${encodeURIComponent(variant.id)}`,
          })),
        };
      }

      return {
        id: `product-${row.id}-${row.unit ?? 'unit'}-${card.cardId}`,
        title: row.title,
        sku: row.sku,
        category: row.category,
        quantity: row.quantity,
        unit: row.unit,
        note: meta.noteOf?.(row),
        value: meta.valueOf(row),
        subValue: [
          row.subValue,
          `${row.baseQuantity ?? 0} ${row.baseUnit ?? 'base'}`,
          row.netCost ? `Cost ${row.netCost}` : null,
          row.grossProfit ? `Profit ${row.grossProfit}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        actionHref: `/product-form?id=${encodeURIComponent(row.id)}`,
      };
    });

    onOpenDetail({
      metricKey: card.cardId,
      title: meta.drillTitle,
      subtitle: useDistinct
        ? `${meta.explanation} Showing ${distinctCount} distinct products. Tap a product to see its selling units.`
        : unitRowCount !== distinctCount
          ? `${meta.explanation} ${unitRowCount} selling-unit rows from ${distinctCount} distinct products.`
          : `${meta.explanation} Tap a row to expand details.`,
      icon: meta.icon,
      summaryLabel: card.label,
      summaryValue: card.formattedValue,
      items,
    });
  };

  const openProductRow = (row: ProductPerformanceRow) => {
    const detailItems: DetailItem[] = [
      {
        id: `${row.id}-selling`,
        title: 'Selling units sold',
        note: 'Quantity rung up at POS in this selling unit',
        value: `${row.quantity ?? 0} ${row.unit ?? ''}`.trim() || '0',
      },
      {
        id: `${row.id}-base`,
        title: 'Equivalent base units',
        note: 'Converted to the product’s base inventory unit',
        value: `${row.baseQuantity ?? 0} ${row.baseUnit ?? 'base'}`.trim(),
      },
      {
        id: `${row.id}-revenue`,
        title: 'Product revenue',
        note: 'Gross line total before refunds',
        value: row.value,
      },
    ];
    if (row.netCost) {
      detailItems.push({
        id: `${row.id}-cogs`,
        title: 'Cost of goods sold',
        note: 'Inventory cost for units sold',
        value: row.netCost,
      });
    }
    if (row.grossProfit) {
      detailItems.push({
        id: `${row.id}-profit`,
        title: 'Gross profit',
        note: 'Revenue minus cost for this product',
        value: row.grossProfit,
      });
    }
    detailItems.push({
      id: `${row.id}-open`,
      title: 'Open product record',
      note: row.sku ? `SKU ${row.sku}` : 'Edit catalog details, units, and pricing',
      value: 'View',
      actionHref: `/product-form?id=${encodeURIComponent(row.id)}`,
      statusTag: 'Catalog',
      statusTone: 'blue',
    });

    onOpenDetail({
      metricKey: `product_${row.id}`,
      title: row.title,
      subtitle:
        row.subValue ||
        `${row.quantity ?? 0} ${row.unit ?? 'sold'} · ${row.category ?? 'Uncategorized'}`,
      icon: 'tag',
      summaryLabel: 'Product revenue',
      summaryValue: row.value,
      items: detailItems,
    });
  };

  const visibleCards = report.summaryCards.filter((card) => !card.isSensitive).slice(0, 8);

  return (
    <>
      <ReportCard
        title={report.title || 'Product Performance'}
        subtitle="Tap a card for its breakdown. Piece and Box stay separate selling units."
      >
        <View className="flex-row flex-wrap gap-3">
          {visibleCards.map((card) => {
            const meta = PRODUCT_CARD_META[card.cardId];
            return (
              <MetricCard
                key={card.cardId}
                label={card.label}
                value={card.formattedValue}
                note={meta?.explanation ?? card.formulaDescription ?? 'Tap for product breakdown'}
                icon={meta?.icon ?? 'tag'}
                tone={meta?.tone ?? 'brand'}
                onPress={() => openCardDrilldown(card)}
              />
            );
          })}
        </View>
      </ReportCard>
      <ReportCard
        title="Product unit breakdown"
        subtitle="Tap a product for unit, revenue, and cost details."
      >
        {report.rows.length === 0 ? (
          <Text className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
            No product sales for this period.
          </Text>
        ) : (
          <View className="gap-2.5">
            {report.rows.map((row) => (
              <Pressable
                key={`${row.id}-${row.unit ?? 'unit'}`}
                accessibilityRole="button"
                accessibilityLabel={`Open ${row.title} product details`}
                onPress={() => openProductRow(row)}
                className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 active:bg-slate-100"
              >
                <View className="flex-row items-center justify-between gap-3">
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm font-medium text-slate-900">{row.title}</Text>
                    <Text className="mt-0.5 text-xs text-slate-500">
                      {row.subValue ||
                        `${row.quantity ?? 0} ${row.unit ?? ''} (${row.baseQuantity ?? 0} ${row.baseUnit ?? 'base'})`}
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-2">
                    <Text className="text-sm font-semibold text-slate-950">{row.value}</Text>
                    <Feather name="chevron-right" size={16} color="#94A3B8" />
                  </View>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ReportCard>
    </>
  );
}

function SelectDropdown({
  value,
  options,
  onChange,
  icon = 'filter',
  label,
}: {
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (val: string) => void;
  icon?: string;
  label?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedOption = options.find((o) => o.value === value) || options[0];

  return (
    <View className="relative z-50">
      <Pressable
        onPress={() => setIsOpen((prev) => !prev)}
        className="flex-row items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 transition-colors hover:bg-slate-100"
      >
        <Feather name={icon as any} size={14} color="#64748B" />
        <Text className="text-xs font-semibold text-slate-700">
          {label ? `${label}: ` : ''}
          {selectedOption?.label}
        </Text>
        <Feather name={isOpen ? 'chevron-up' : 'chevron-down'} size={14} color="#64748B" />
      </Pressable>

      {isOpen ? (
        <>
          <Pressable
            onPress={() => setIsOpen(false)}
            className="fixed inset-0 z-40 bg-transparent"
          />
          <View className="absolute right-0 top-11 z-50 max-h-60 min-w-[200px] overflow-y-auto rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl">
            {options.map((opt) => (
              <Pressable
                key={opt.value}
                onPress={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={`flex-row items-center justify-between px-3.5 py-2.5 hover:bg-emerald-50 ${
                  opt.value === value ? 'bg-emerald-50/80' : ''
                }`}
              >
                <Text
                  className={`text-xs ${
                    opt.value === value ? 'font-bold text-brand-800' : 'font-medium text-slate-700'
                  }`}
                >
                  {opt.label}
                </Text>
                {opt.value === value ? <Feather name="check" size={14} color="#047857" /> : null}
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

function InventoryReport({
  report,
  productsList,
  inventoryItems = [],
  inventoryMovements = [],
  productionProducts = [],
  isLoadingMovements = false,
  onOpenDetail,
  exportRef,
}: {
  report: ReportsWorkspace;
  productsList: any[];
  inventoryItems?: any[];
  inventoryMovements?: any[];
  productionProducts?: any[];
  isLoadingMovements?: boolean;
  onOpenDetail(config: MetricDrilldownConfig): void;
  exportRef?: React.MutableRefObject<(() => InventoryExportData) | null>;
}) {
  const [subTab, setSubTab] = useState<'stock' | 'movements' | 'conversions'>('stock');

  // Stock table state
  const [stockSearch, setStockSearch] = useState('');
  const [stockCategoryFilter, setStockCategoryFilter] = useState<string>('all');
  const [stockRoleFilter, setStockRoleFilter] = useState<'all' | 'sellable' | 'ingredient' | 'both'>('all');
  const [stockLowOnly, setStockLowOnly] = useState(false);
  const [stockSortKey, setStockSortKey] = useState<string>('name');
  const [stockSortDir, setStockSortDir] = useState<'asc' | 'desc'>('asc');

  // Movements table state
  const [movementSearch, setMovementSearch] = useState('');
  const [movementTypeFilter, setMovementTypeFilter] = useState<string>('all');
  const [movementSortKey, setMovementSortKey] = useState<string>('date');
  const [movementSortDir, setMovementSortDir] = useState<'asc' | 'desc'>('desc');

  // Conversion table state
  const [conversionSearch, setConversionSearch] = useState('');
  const [conversionStatusFilter, setConversionStatusFilter] = useState<string>('all');
  const [conversionSortKey, setConversionSortKey] = useState<string>('source');
  const [conversionSortDir, setConversionSortDir] = useState<'asc' | 'desc'>('asc');

  // Combine products & inventoryItems for complete data
  const combinedStockItems = useMemo(() => {
    const map = new Map<string, any>();
    for (const p of productsList) {
      map.set(p.id, {
        id: p.id,
        name: p.name,
        sku: p.sku ?? 'N/A',
        category: p.categoryName ?? 'Uncategorized',
        role: p.inventoryRole ?? 'sellable',
        unit: p.unit ?? 'pcs',
        quantity: p.availableQuantity ?? 0,
        lowStockLevel: p.lowStockThreshold ?? 5,
        cost: Number(p.averageCost || p.cost || 0),
        value: (p.availableQuantity ?? 0) * Number(p.averageCost || p.cost || 0),
        portioningEnabled: p.preparationBehavior === 'preproduced' || p.inventoryRole === 'ingredient',
        containerName: p.containerName ?? null,
        containerUnit: p.containerUnit ?? null,
        unitsPerBase: p.unitsPerBase ?? null,
        status:
          (p.availableQuantity ?? 0) <= 0
            ? 'out_of_stock'
            : (p.availableQuantity ?? 0) <= (p.lowStockThreshold ?? 5)
            ? 'low_stock'
            : 'in_stock',
      });
    }
    for (const item of inventoryItems) {
      if (item.productId && map.has(item.productId)) {
        const existing = map.get(item.productId)!;
        existing.quantity = item.quantity ?? existing.quantity;
        existing.lowStockLevel = item.lowStockLevel ?? existing.lowStockLevel;
        existing.cost = Number(item.averageCost ?? existing.cost);
        existing.value = Number(item.inventoryValue ?? existing.quantity * existing.cost);
        existing.portioningEnabled = item.portioningEnabled ?? existing.portioningEnabled;
        existing.containerName = item.containerName ?? existing.containerName;
        existing.containerUnit = item.containerUnit ?? existing.containerUnit;
        existing.unitsPerBase = item.containerUnitsPerBase ?? existing.unitsPerBase;
        existing.status =
          existing.quantity <= 0
            ? 'out_of_stock'
            : existing.quantity <= existing.lowStockLevel
            ? 'low_stock'
            : 'in_stock';
      }
    }
    return Array.from(map.values());
  }, [productsList, inventoryItems]);

  // Extract unique categories for category dropdown
  const categoriesList = useMemo(() => {
    const set = new Set<string>();
    for (const item of combinedStockItems) {
      if (item.category) set.add(item.category);
    }
    for (const p of productsList) {
      if (p.categoryName) set.add(p.categoryName);
    }
    return ['all', ...Array.from(set).sort()];
  }, [combinedStockItems, productsList]);

  // Filtered & sorted stock items
  const filteredStockItems = useMemo(() => {
    return combinedStockItems
      .filter((item) => {
        if (stockCategoryFilter !== 'all' && item.category !== stockCategoryFilter) return false;
        if (stockRoleFilter !== 'all' && item.role !== stockRoleFilter) return false;
        if (stockLowOnly && item.status === 'in_stock') return false;
        if (stockSearch.trim()) {
          const q = stockSearch.toLowerCase().trim();
          const matchName = item.name.toLowerCase().includes(q);
          const matchSku = item.sku.toLowerCase().includes(q);
          const matchCat = item.category.toLowerCase().includes(q);
          if (!matchName && !matchSku && !matchCat) return false;
        }
        return true;
      })
      .sort((a, b) => {
        let valA: any = a[stockSortKey as keyof typeof a];
        let valB: any = b[stockSortKey as keyof typeof b];
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();
        if (valA < valB) return stockSortDir === 'asc' ? -1 : 1;
        if (valA > valB) return stockSortDir === 'asc' ? 1 : -1;
        return 0;
      });
  }, [combinedStockItems, stockCategoryFilter, stockRoleFilter, stockLowOnly, stockSearch, stockSortKey, stockSortDir]);

  // Movement logs data — handles arrays, { data: [...] }, or report.inventory.movements
  const movementLogs = useMemo(() => {
    let raw: any[] = [];
    if (Array.isArray(inventoryMovements) && inventoryMovements.length > 0) {
      raw = inventoryMovements;
    } else if (Array.isArray((inventoryMovements as any)?.data) && (inventoryMovements as any).data.length > 0) {
      raw = (inventoryMovements as any).data;
    } else if (Array.isArray(report?.inventory?.movements) && report.inventory.movements.length > 0) {
      raw = report.inventory.movements;
    }
    return raw.map((m: any, idx: number) => ({
      id: m.id || `mov-${idx}`,
      createdAt: m.createdAt || m.created_at || new Date().toISOString(),
      productName: m.productName || m.product_name || m.name || m.label || 'Stock Item',
      sku: m.sku || 'N/A',
      unit: m.unit || 'pcs',
      type: m.type || m.movement_type || 'adjustment',
      quantityDelta: Number(m.quantityDelta ?? m.quantity_delta ?? m.quantity ?? 0),
      quantityAfter: Number(m.quantityAfter ?? m.quantity_after ?? 0),
      reason: m.reason || m.note || 'Standard movement',
      createdBy: m.createdBy || m.created_by || m.performedBy || 'System',
    }));
  }, [inventoryMovements, report]);

  const filteredMovements = useMemo(() => {
    return movementLogs
      .filter((m) => {
        if (movementTypeFilter !== 'all' && m.type !== movementTypeFilter) return false;
        if (movementSearch.trim()) {
          const q = movementSearch.toLowerCase().trim();
          const matchName = (m.productName ?? '').toLowerCase().includes(q);
          const matchSku = (m.sku ?? '').toLowerCase().includes(q);
          const matchReason = (m.reason ?? '').toLowerCase().includes(q);
          const matchBy = (m.createdBy ?? '').toLowerCase().includes(q);
          if (!matchName && !matchSku && !matchReason && !matchBy) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const key =
          movementSortKey === 'date'
            ? 'createdAt'
            : movementSortKey === 'name'
            ? 'productName'
            : movementSortKey === 'delta'
            ? 'quantityDelta'
            : movementSortKey === 'after'
            ? 'quantityAfter'
            : movementSortKey === 'by'
            ? 'createdBy'
            : movementSortKey;
        let valA: any = (a as Record<string, any>)[key];
        let valB: any = (b as Record<string, any>)[key];
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();
        if (valA < valB) return movementSortDir === 'asc' ? -1 : 1;
        if (valA > valB) return movementSortDir === 'asc' ? 1 : -1;
        return 0;
      });
  }, [movementLogs, movementTypeFilter, movementSearch, movementSortKey, movementSortDir]);

  // Conversions & Repacking data
  const conversionRows = useMemo(() => {
    const list: any[] = [];
    for (const p of productionProducts) {
      for (const ing of p.ingredients ?? []) {
        list.push({
          id: `${p.id}-${ing.productId}`,
          targetName: p.name,
          targetUnit: p.unit,
          targetStock: p.quantity ?? 0,
          sourceName: ing.name,
          sourceUnit: ing.baseUnit,
          sourceStock: ing.availableQuantity ?? 0,
          quantityRequired: ing.quantityRequired,
          recipeUnit: ing.recipeUnit,
          unitsPerBase: ing.unitsPerBase ?? 1,
          ratioDisplay:
            ing.unitsPerBase && ing.containerUnit
              ? `1 ${ing.containerUnit} = ${ing.unitsPerBase} ${ing.baseUnit}`
              : `1 ${p.unit} = ${ing.quantityRequired} ${ing.baseUnit}`,
          status: (ing.availableQuantity ?? 0) >= ing.quantityRequired ? 'Ready to Repack' : 'Low Source Stock',
        });
      }
    }
    for (const item of combinedStockItems) {
      if (item.unitsPerBase && item.containerName && item.containerUnit) {
        const exists = list.some((c) => c.targetName === item.name);
        if (!exists) {
          list.push({
            id: `portion-${item.id}`,
            targetName: item.name,
            targetUnit: item.unit,
            targetStock: item.quantity,
            sourceName: item.containerName,
            sourceUnit: item.containerUnit,
            sourceStock: Math.floor(item.quantity / item.unitsPerBase),
            quantityRequired: 1,
            recipeUnit: item.containerUnit,
            unitsPerBase: item.unitsPerBase,
            ratioDisplay: `1 ${item.containerUnit} = ${item.unitsPerBase} ${item.unit}`,
            status: item.quantity > 0 ? 'Active Conversion' : 'No Stock',
          });
        }
      }
    }
    return list;
  }, [productionProducts, combinedStockItems]);

  const filteredConversions = useMemo(() => {
    return conversionRows
      .filter((c) => {
        if (conversionStatusFilter !== 'all') {
          if (conversionStatusFilter === 'ready' && !c.status.includes('Ready')) return false;
          if (conversionStatusFilter === 'low' && !c.status.includes('Low')) return false;
          if (conversionStatusFilter === 'active' && !c.status.includes('Active')) return false;
        }
        if (conversionSearch.trim()) {
          const q = conversionSearch.toLowerCase().trim();
          const matchSource = c.sourceName.toLowerCase().includes(q);
          const matchTarget = c.targetName.toLowerCase().includes(q);
          if (!matchSource && !matchTarget) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const key =
          conversionSortKey === 'source'
            ? 'sourceName'
            : conversionSortKey === 'target'
            ? 'targetName'
            : conversionSortKey === 'ratio'
            ? 'ratioDisplay'
            : conversionSortKey === 'sourceStock'
            ? 'sourceStock'
            : conversionSortKey === 'targetStock'
            ? 'targetStock'
            : conversionSortKey === 'status'
            ? 'status'
            : conversionSortKey;
        let valA: any = a[key];
        let valB: any = b[key];
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();
        if (valA < valB) return conversionSortDir === 'asc' ? -1 : 1;
        if (valA > valB) return conversionSortDir === 'asc' ? 1 : -1;
        return 0;
      });
  }, [conversionRows, conversionStatusFilter, conversionSearch, conversionSortKey, conversionSortDir]);

  if (exportRef) {
    exportRef.current = () => ({
      stockItems: filteredStockItems,
      movements: filteredMovements,
      conversions: filteredConversions,
      filters: {
        subTab,
        category: stockCategoryFilter,
        role: stockRoleFilter,
        movementType: movementTypeFilter,
        lowStockOnly: stockLowOnly,
        search: stockSearch || movementSearch || conversionSearch,
      },
    });
  }

  const handleStockSort = (key: string) => {
    if (stockSortKey === key) {
      setStockSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setStockSortKey(key);
      setStockSortDir('asc');
    }
  };

  const handleMovementSort = (key: string) => {
    if (movementSortKey === key) {
      setMovementSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setMovementSortKey(key);
      setMovementSortDir('asc');
    }
  };

  const handleConversionSort = (key: string) => {
    if (conversionSortKey === key) {
      setConversionSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setConversionSortKey(key);
      setConversionSortDir('asc');
    }
  };

  return (
    <View className="w-full gap-5">
      {/* Sub-Tab Navigation Bar */}
      <View className="flex-row flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-xs">
        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={() => setSubTab('stock')}
            className={`flex-row items-center gap-2 rounded-xl px-4 py-2.5 transition-all ${
              subTab === 'stock' ? 'bg-brand-700 shadow-xs' : 'bg-slate-50 hover:bg-slate-100'
            }`}
          >
            <Feather name="package" size={16} color={subTab === 'stock' ? '#FFFFFF' : '#475569'} />
            <Text className={`text-xs font-semibold ${subTab === 'stock' ? 'text-white' : 'text-slate-700'}`}>
              Current Stock ({filteredStockItems.length})
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setSubTab('movements')}
            className={`flex-row items-center gap-2 rounded-xl px-4 py-2.5 transition-all ${
              subTab === 'movements' ? 'bg-brand-700 shadow-xs' : 'bg-slate-50 hover:bg-slate-100'
            }`}
          >
            <Feather name="activity" size={16} color={subTab === 'movements' ? '#FFFFFF' : '#475569'} />
            <Text className={`text-xs font-semibold ${subTab === 'movements' ? 'text-white' : 'text-slate-700'}`}>
              Stock Movement ({filteredMovements.length})
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setSubTab('conversions')}
            className={`flex-row items-center gap-2 rounded-xl px-4 py-2.5 transition-all ${
              subTab === 'conversions' ? 'bg-brand-700 shadow-xs' : 'bg-slate-50 hover:bg-slate-100'
            }`}
          >
            <Feather name="repeat" size={16} color={subTab === 'conversions' ? '#FFFFFF' : '#475569'} />
            <Text className={`text-xs font-semibold ${subTab === 'conversions' ? 'text-white' : 'text-slate-700'}`}>
              Conversion (Repacking) ({filteredConversions.length})
            </Text>
          </Pressable>
        </View>

        <Pressable
          onPress={() => router.push('/(tabs)/inventory')}
          className="flex-row items-center gap-1.5 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2"
        >
          <Text className="text-xs font-semibold text-brand-700">Manage Inventory</Text>
          <Feather name="external-link" size={14} color="#1A593B" />
        </Pressable>
      </View>

      {/* Sub-Tab 1: Current Stock */}
      {subTab === 'stock' ? (
        <View className="relative z-40 rounded-2xl border border-slate-200 bg-white shadow-xs">
          <View className="relative z-50 flex-row flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
            <View className="flex-1 min-w-[240px] flex-row items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <Feather name="search" size={16} color="#94A3B8" />
              <TextInput
                value={stockSearch}
                onChangeText={setStockSearch}
                placeholder="Search product, SKU, category..."
                className="ml-2 flex-1 text-xs text-slate-900 outline-none"
                placeholderTextColor="#94A3B8"
              />
              {stockSearch ? (
                <Pressable onPress={() => setStockSearch('')}>
                  <Feather name="x-circle" size={14} color="#94A3B8" />
                </Pressable>
              ) : null}
            </View>

            <View className="flex-row items-center gap-2.5">
              <SelectDropdown
                label="Category"
                icon="grid"
                value={stockCategoryFilter}
                options={categoriesList.map((cat) => ({
                  label: cat === 'all' ? 'All Categories' : cat,
                  value: cat,
                }))}
                onChange={setStockCategoryFilter}
              />

              <SelectDropdown
                label="Role"
                icon="tag"
                value={stockRoleFilter}
                options={[
                  { label: 'All Roles', value: 'all' },
                  { label: 'Sellable Only', value: 'sellable' },
                  { label: 'Raw Material (Ingredient)', value: 'ingredient' },
                  { label: 'Both', value: 'both' },
                ]}
                onChange={(val) => setStockRoleFilter(val as any)}
              />

              <Pressable
                onPress={() => setStockLowOnly((prev) => !prev)}
                className={`flex-row items-center gap-1.5 rounded-xl border px-3 py-2 ${
                  stockLowOnly ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'
                }`}
              >
                <Feather name="alert-triangle" size={14} color={stockLowOnly ? '#B45309' : '#64748B'} />
                <Text className={`text-xs font-medium ${stockLowOnly ? 'text-amber-900 font-semibold' : 'text-slate-700'}`}>
                  Low Stock Only
                </Text>
              </Pressable>
            </View>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={true} className="w-full">
            <View className="min-w-[900px] w-full">
              <View className="flex-row border-b border-slate-200 bg-slate-50 px-4 py-3">
                <Pressable onPress={() => handleStockSort('name')} className="w-56 flex-row items-center gap-1.5">
                  <Text className="text-xs font-bold tracking-wide uppercase text-slate-600">Product Name</Text>
                  {stockSortKey === 'name' ? (
                    <Feather name={stockSortDir === 'asc' ? 'chevron-up' : 'chevron-down'} size={14} color="#047857" />
                  ) : (
                    <Feather name="chevron-down" size={12} color="#94A3B8" />
                  )}
                </Pressable>

                <Pressable onPress={() => handleStockSort('sku')} className="w-32 flex-row items-center gap-1.5">
                  <Text className="text-xs font-bold tracking-wide uppercase text-slate-600">SKU</Text>
                  {stockSortKey === 'sku' ? (
                    <Feather name={stockSortDir === 'asc' ? 'chevron-up' : 'chevron-down'} size={14} color="#047857" />
                  ) : null}
                </Pressable>

                <Pressable onPress={() => handleStockSort('category')} className="w-36 flex-row items-center gap-1.5">
                  <Text className="text-xs font-bold tracking-wide uppercase text-slate-600">Category</Text>
                  {stockSortKey === 'category' ? (
                    <Feather name={stockSortDir === 'asc' ? 'chevron-up' : 'chevron-down'} size={14} color="#047857" />
                  ) : null}
                </Pressable>

                <Pressable onPress={() => handleStockSort('role')} className="w-28 flex-row items-center gap-1.5">
                  <Text className="text-xs font-bold tracking-wide uppercase text-slate-600">Role</Text>
                  {stockSortKey === 'role' ? (
                    <Feather name={stockSortDir === 'asc' ? 'chevron-up' : 'chevron-down'} size={14} color="#047857" />
                  ) : null}
                </Pressable>

                <Pressable onPress={() => handleStockSort('unit')} className="w-44 flex-row items-center gap-1.5">
                  <Text className="text-xs font-bold tracking-wide uppercase text-slate-600">Unit / Conversion</Text>
                  {stockSortKey === 'unit' ? (
                    <Feather name={stockSortDir === 'asc' ? 'chevron-up' : 'chevron-down'} size={14} color="#047857" />
                  ) : null}
                </Pressable>

                <Pressable onPress={() => handleStockSort('quantity')} className="w-36 flex-row items-center justify-end gap-1.5">
                  <Text className="text-xs font-bold tracking-wide uppercase text-slate-600">Stock Qty</Text>
                  {stockSortKey === 'quantity' ? (
                    <Feather name={stockSortDir === 'asc' ? 'chevron-up' : 'chevron-down'} size={14} color="#047857" />
                  ) : null}
                </Pressable>

                <Pressable onPress={() => handleStockSort('cost')} className="w-32 flex-row items-center justify-end gap-1.5">
                  <Text className="text-xs font-bold tracking-wide uppercase text-slate-600">Avg Cost</Text>
                  {stockSortKey === 'cost' ? (
                    <Feather name={stockSortDir === 'asc' ? 'chevron-up' : 'chevron-down'} size={14} color="#047857" />
                  ) : null}
                </Pressable>

                <Pressable onPress={() => handleStockSort('value')} className="w-36 flex-row items-center justify-end gap-1.5">
                  <Text className="text-xs font-bold tracking-wide uppercase text-slate-600">Valuation</Text>
                  {stockSortKey === 'value' ? (
                    <Feather name={stockSortDir === 'asc' ? 'chevron-up' : 'chevron-down'} size={14} color="#047857" />
                  ) : null}
                </Pressable>

                <Pressable onPress={() => handleStockSort('status')} className="w-28 flex-row items-center justify-end gap-1.5">
                  <Text className="text-xs font-bold tracking-wide uppercase text-slate-600">Status</Text>
                  {stockSortKey === 'status' ? (
                    <Feather name={stockSortDir === 'asc' ? 'chevron-up' : 'chevron-down'} size={14} color="#047857" />
                  ) : null}
                </Pressable>
              </View>

              {filteredStockItems.length > 0 ? (
                filteredStockItems.map((item, index) => (
                  <View
                    key={item.id}
                    className={`flex-row items-center px-4 py-3.5 ${
                      index % 2 === 1 ? 'bg-slate-50/50' : 'bg-white'
                    } border-b border-slate-100 transition-colors hover:bg-emerald-50/30`}
                  >
                    <View className="w-56 pr-2">
                      <Text className="text-xs font-semibold text-slate-900" numberOfLines={1}>
                        {item.name}
                      </Text>
                      {item.containerName ? (
                        <Text className="mt-0.5 text-[10px] text-slate-500">
                          Container: {item.containerName}
                        </Text>
                      ) : null}
                    </View>

                    <View className="w-32 pr-2">
                      <Text className="font-mono text-xs text-slate-600">{item.sku}</Text>
                    </View>

                    <View className="w-36 pr-2">
                      <Text className="text-xs text-slate-600">{item.category}</Text>
                    </View>

                    <View className="w-28 pr-2">
                      <View
                        className={`self-start rounded-full px-2 py-0.5 ${
                          item.role === 'ingredient'
                            ? 'bg-amber-100'
                            : item.role === 'both'
                            ? 'bg-purple-100'
                            : 'bg-blue-100'
                        }`}
                      >
                        <Text
                          className={`text-[10px] font-semibold capitalize ${
                            item.role === 'ingredient'
                              ? 'text-amber-800'
                              : item.role === 'both'
                              ? 'text-purple-800'
                              : 'text-blue-800'
                          }`}
                        >
                          {item.role === 'ingredient' ? 'Raw Mat.' : item.role}
                        </Text>
                      </View>
                    </View>

                    <View className="w-44 pr-2">
                      <Text className="text-xs text-slate-700">
                        {item.unit}
                        {item.containerUnit && item.unitsPerBase
                          ? ` (1 ${item.containerUnit} = ${item.unitsPerBase} ${item.unit})`
                          : ''}
                      </Text>
                    </View>

                    <View className="w-36 items-end pr-2">
                      <Text
                        className={`text-xs font-bold ${
                          item.quantity <= 0
                            ? 'text-red-700'
                            : item.quantity <= item.lowStockLevel
                            ? 'text-amber-700'
                            : 'text-slate-900'
                        }`}
                      >
                        {item.quantity.toLocaleString()} {item.unit}
                      </Text>
                    </View>

                    <View className="w-32 items-end pr-2">
                      <Text className="font-mono text-xs text-slate-600">
                        {formatMoney(String(item.cost))}
                      </Text>
                    </View>

                    <View className="w-36 items-end pr-2">
                      <Text className="text-xs font-semibold text-slate-900">
                        {formatMoney(String(item.value))}
                      </Text>
                    </View>

                    <View className="w-28 items-end">
                      <View
                        className={`rounded-full px-2 py-0.5 ${
                          item.status === 'out_of_stock'
                            ? 'bg-red-100'
                            : item.status === 'low_stock'
                            ? 'bg-amber-100'
                            : 'bg-emerald-100'
                        }`}
                      >
                        <Text
                          className={`text-[10px] font-bold ${
                            item.status === 'out_of_stock'
                              ? 'text-red-800'
                              : item.status === 'low_stock'
                              ? 'text-amber-800'
                              : 'text-emerald-800'
                          }`}
                        >
                          {item.status === 'out_of_stock'
                            ? 'Out of Stock'
                            : item.status === 'low_stock'
                            ? 'Low Stock'
                            : 'In Stock'}
                        </Text>
                      </View>
                    </View>
                  </View>
                ))
              ) : (
                <View className="items-center justify-center p-8">
                  <Feather name="package" size={24} color="#94A3B8" />
                  <Text className="mt-2 text-xs font-medium text-slate-500">
                    No stock records match the selected filters.
                  </Text>
                </View>
              )}
            </View>
          </ScrollView>
        </View>
      ) : null}

      {/* Sub-Tab 2: Stock Movement */}
      {subTab === 'movements' ? (
        <View className="relative z-40 rounded-2xl border border-slate-200 bg-white shadow-xs">
          <View className="relative z-50 flex-row flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
            <View className="flex-1 min-w-[240px] flex-row items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <Feather name="search" size={16} color="#94A3B8" />
              <TextInput
                value={movementSearch}
                onChangeText={setMovementSearch}
                placeholder="Search product, SKU, reason, or performed by..."
                className="ml-2 flex-1 text-xs text-slate-900 outline-none"
                placeholderTextColor="#94A3B8"
              />
            </View>

            <View className="flex-row items-center gap-2">
              <SelectDropdown
                label="Movement Type"
                icon="sliders"
                value={movementTypeFilter}
                options={[
                  { label: 'All Movement Types', value: 'all' },
                  { label: 'Adjustments', value: 'adjustment' },
                  { label: 'Sales', value: 'sale' },
                  { label: 'Returns', value: 'return' },
                  { label: 'Repacking (Production)', value: 'production' },
                  { label: 'Transfers', value: 'transfer' },
                ]}
                onChange={setMovementTypeFilter}
              />
            </View>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={true} className="w-full">
            <View className="min-w-[850px] w-full">
              <View className="flex-row border-b border-slate-200 bg-slate-50 px-4 py-3">
                <Pressable onPress={() => handleMovementSort('date')} className="w-44 flex-row items-center gap-1.5">
                  <Text className="text-xs font-bold uppercase tracking-wide text-slate-600">Date & Time</Text>
                  {movementSortKey === 'date' ? (
                    <Feather name={movementSortDir === 'asc' ? 'chevron-up' : 'chevron-down'} size={14} color="#047857" />
                  ) : null}
                </Pressable>

                <Pressable onPress={() => handleMovementSort('name')} className="w-56 flex-row items-center gap-1.5">
                  <Text className="text-xs font-bold uppercase tracking-wide text-slate-600">Product Name</Text>
                  {movementSortKey === 'name' ? (
                    <Feather name={movementSortDir === 'asc' ? 'chevron-up' : 'chevron-down'} size={14} color="#047857" />
                  ) : null}
                </Pressable>

                <Pressable onPress={() => handleMovementSort('type')} className="w-36 flex-row items-center gap-1.5">
                  <Text className="text-xs font-bold uppercase tracking-wide text-slate-600">Movement Type</Text>
                  {movementSortKey === 'type' ? (
                    <Feather name={movementSortDir === 'asc' ? 'chevron-up' : 'chevron-down'} size={14} color="#047857" />
                  ) : null}
                </Pressable>

                <Pressable onPress={() => handleMovementSort('delta')} className="w-32 flex-row items-center justify-end gap-1.5">
                  <Text className="text-xs font-bold uppercase tracking-wide text-slate-600">Qty Change</Text>
                  {movementSortKey === 'delta' ? (
                    <Feather name={movementSortDir === 'asc' ? 'chevron-up' : 'chevron-down'} size={14} color="#047857" />
                  ) : null}
                </Pressable>

                <Pressable onPress={() => handleMovementSort('after')} className="w-32 flex-row items-center justify-end gap-1.5">
                  <Text className="text-xs font-bold uppercase tracking-wide text-slate-600">Qty After</Text>
                  {movementSortKey === 'after' ? (
                    <Feather name={movementSortDir === 'asc' ? 'chevron-up' : 'chevron-down'} size={14} color="#047857" />
                  ) : null}
                </Pressable>

                <Pressable onPress={() => handleMovementSort('reason')} className="w-48 flex-row items-center gap-1.5">
                  <Text className="text-xs font-bold uppercase tracking-wide text-slate-600">Reason / Ref</Text>
                </Pressable>

                <Pressable onPress={() => handleMovementSort('by')} className="w-36 flex-row items-center gap-1.5">
                  <Text className="text-xs font-bold uppercase tracking-wide text-slate-600">Performed By</Text>
                </Pressable>
              </View>

              {filteredMovements.length > 0 ? (
                filteredMovements.map((m, index) => (
                  <View
                    key={m.id || index}
                    className={`flex-row items-center px-4 py-3.5 ${
                      index % 2 === 1 ? 'bg-slate-50/50' : 'bg-white'
                    } border-b border-slate-100 transition-colors hover:bg-emerald-50/30`}
                  >
                    <View className="w-44 pr-2">
                      <Text className="text-xs font-medium text-slate-800">
                        {m.createdAt ? new Date(m.createdAt).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' }) : 'Recent'}
                      </Text>
                    </View>

                    <View className="w-56 pr-2">
                      <Text className="text-xs font-semibold text-slate-900" numberOfLines={1}>
                        {m.productName}
                      </Text>
                      {m.sku ? <Text className="text-[10px] text-slate-500">{m.sku}</Text> : null}
                    </View>

                    <View className="w-36 pr-2">
                      <View
                        className={`self-start rounded-full px-2 py-0.5 ${
                          m.type === 'sale'
                            ? 'bg-blue-100'
                            : m.type === 'return'
                            ? 'bg-emerald-100'
                            : m.type === 'production'
                            ? 'bg-purple-100'
                            : 'bg-amber-100'
                        }`}
                      >
                        <Text
                          className={`text-[10px] font-semibold capitalize ${
                            m.type === 'sale'
                              ? 'text-blue-800'
                              : m.type === 'return'
                              ? 'text-emerald-800'
                              : m.type === 'production'
                              ? 'text-purple-800'
                              : 'text-amber-800'
                          }`}
                        >
                          {m.type?.replaceAll('_', ' ') ?? 'adjustment'}
                        </Text>
                      </View>
                    </View>

                    <View className="w-32 items-end pr-2">
                      <Text
                        className={`text-xs font-bold ${
                          (m.quantityDelta ?? 0) > 0
                            ? 'text-emerald-700'
                            : (m.quantityDelta ?? 0) < 0
                            ? 'text-red-700'
                            : 'text-slate-700'
                        }`}
                      >
                        {(m.quantityDelta ?? 0) > 0 ? `+${m.quantityDelta}` : m.quantityDelta}{' '}
                        {m.unit ?? 'pcs'}
                      </Text>
                    </View>

                    <View className="w-32 items-end pr-2">
                      <Text className="text-xs font-semibold text-slate-900">
                        {m.quantityAfter ?? '-'} {m.unit ?? 'pcs'}
                      </Text>
                    </View>

                    <View className="w-48 pr-2">
                      <Text className="text-xs text-slate-600" numberOfLines={1}>
                        {m.reason ?? 'Standard adjustment'}
                      </Text>
                    </View>

                    <View className="w-36 pr-2">
                      <Text className="text-xs font-medium text-slate-700" numberOfLines={1}>
                        {m.createdBy ?? 'System'}
                      </Text>
                    </View>
                  </View>
                ))
              ) : (
                <View className="items-center justify-center p-8">
                  <Feather name="activity" size={24} color="#94A3B8" />
                  <Text className="mt-2 text-xs font-medium text-slate-500">
                    No movement logs available for this branch.
                  </Text>
                </View>
              )}
            </View>
          </ScrollView>
        </View>
      ) : null}

      {/* Sub-Tab 3: Conversions & Repacking */}
      {subTab === 'conversions' ? (
        <View className="relative z-40 rounded-2xl border border-slate-200 bg-white shadow-xs">
          <View className="relative z-50 flex-row flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
            <View className="flex-1 min-w-[240px] flex-row items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <Feather name="search" size={16} color="#94A3B8" />
              <TextInput
                value={conversionSearch}
                onChangeText={setConversionSearch}
                placeholder="Search raw material or repacked product..."
                className="ml-2 flex-1 text-xs text-slate-900 outline-none"
                placeholderTextColor="#94A3B8"
              />
            </View>

            <View className="flex-row items-center gap-2">
              <SelectDropdown
                label="Status"
                icon="check-circle"
                value={conversionStatusFilter}
                options={[
                  { label: 'All Statuses', value: 'all' },
                  { label: 'Ready to Repack', value: 'ready' },
                  { label: 'Low Source Stock', value: 'low' },
                  { label: 'Active Conversion', value: 'active' },
                ]}
                onChange={setConversionStatusFilter}
              />
            </View>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={true} className="w-full">
            <View className="min-w-[850px] w-full">
              <View className="flex-row border-b border-slate-200 bg-slate-50 px-4 py-3">
                <Pressable onPress={() => handleConversionSort('source')} className="w-56 flex-row items-center gap-1.5">
                  <Text className="text-xs font-bold uppercase tracking-wide text-slate-600">Bulk Source Raw Material</Text>
                  {conversionSortKey === 'source' ? (
                    <Feather name={conversionSortDir === 'asc' ? 'chevron-up' : 'chevron-down'} size={14} color="#047857" />
                  ) : null}
                </Pressable>

                <Pressable onPress={() => handleConversionSort('target')} className="w-56 flex-row items-center gap-1.5">
                  <Text className="text-xs font-bold uppercase tracking-wide text-slate-600">Repacked Target Product</Text>
                  {conversionSortKey === 'target' ? (
                    <Feather name={conversionSortDir === 'asc' ? 'chevron-up' : 'chevron-down'} size={14} color="#047857" />
                  ) : null}
                </Pressable>

                <Pressable onPress={() => handleConversionSort('ratio')} className="w-48 flex-row items-center gap-1.5">
                  <Text className="text-xs font-bold uppercase tracking-wide text-slate-600">Conversion Ratio</Text>
                  {conversionSortKey === 'ratio' ? (
                    <Feather name={conversionSortDir === 'asc' ? 'chevron-up' : 'chevron-down'} size={14} color="#047857" />
                  ) : null}
                </Pressable>

                <Pressable onPress={() => handleConversionSort('sourceStock')} className="w-36 flex-row items-center justify-end gap-1.5">
                  <Text className="text-xs font-bold uppercase tracking-wide text-slate-600">Source Stock</Text>
                  {conversionSortKey === 'sourceStock' ? (
                    <Feather name={conversionSortDir === 'asc' ? 'chevron-up' : 'chevron-down'} size={14} color="#047857" />
                  ) : null}
                </Pressable>

                <Pressable onPress={() => handleConversionSort('targetStock')} className="w-36 flex-row items-center justify-end gap-1.5">
                  <Text className="text-xs font-bold uppercase tracking-wide text-slate-600">Repacked Stock</Text>
                  {conversionSortKey === 'targetStock' ? (
                    <Feather name={conversionSortDir === 'asc' ? 'chevron-up' : 'chevron-down'} size={14} color="#047857" />
                  ) : null}
                </Pressable>

                <Pressable onPress={() => handleConversionSort('status')} className="w-36 flex-row items-center justify-end gap-1.5">
                  <Text className="text-xs font-bold uppercase tracking-wide text-slate-600">Repack Status</Text>
                  {conversionSortKey === 'status' ? (
                    <Feather name={conversionSortDir === 'asc' ? 'chevron-up' : 'chevron-down'} size={14} color="#047857" />
                  ) : null}
                </Pressable>
              </View>

              {filteredConversions.length > 0 ? (
                filteredConversions.map((c, index) => (
                  <View
                    key={c.id || index}
                    className={`flex-row items-center px-4 py-3.5 ${
                      index % 2 === 1 ? 'bg-slate-50/50' : 'bg-white'
                    } border-b border-slate-100 transition-colors hover:bg-emerald-50/30`}
                  >
                    <View className="w-56 pr-2">
                      <Text className="text-xs font-semibold text-slate-900">{c.sourceName}</Text>
                      <Text className="text-[10px] text-slate-500">Unit: {c.sourceUnit}</Text>
                    </View>

                    <View className="w-56 pr-2">
                      <Text className="text-xs font-semibold text-emerald-800">{c.targetName}</Text>
                      <Text className="text-[10px] text-slate-500">Target Unit: {c.targetUnit}</Text>
                    </View>

                    <View className="w-48 pr-2">
                      <Text className="font-mono text-xs font-medium text-slate-800">{c.ratioDisplay}</Text>
                    </View>

                    <View className="w-36 items-end pr-2">
                      <Text className="text-xs font-bold text-slate-800">
                        {c.sourceStock.toLocaleString()} {c.sourceUnit}
                      </Text>
                    </View>

                    <View className="w-36 items-end pr-2">
                      <Text className="text-xs font-bold text-emerald-700">
                        {c.targetStock.toLocaleString()} {c.targetUnit}
                      </Text>
                    </View>

                    <View className="w-36 items-end">
                      <View
                        className={`rounded-full px-2.5 py-0.5 ${
                          c.status.includes('Ready') || c.status.includes('Active')
                            ? 'bg-emerald-100'
                            : 'bg-amber-100'
                        }`}
                      >
                        <Text
                          className={`text-[10px] font-bold ${
                            c.status.includes('Ready') || c.status.includes('Active')
                              ? 'text-emerald-800'
                              : 'text-amber-800'
                          }`}
                        >
                          {c.status}
                        </Text>
                      </View>
                    </View>
                  </View>
                ))
              ) : (
                <View className="items-center justify-center p-8">
                  <Feather name="repeat" size={24} color="#94A3B8" />
                  <Text className="mt-2 text-xs font-medium text-slate-500">
                    No conversion or repacking recipes configured yet.
                  </Text>
                </View>
              )}
            </View>
          </ScrollView>
        </View>
      ) : null}
    </View>
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
      <View className="w-full flex-row flex-wrap gap-3">
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
              items:
                report.purchasing.purchaseOrdersList && report.purchasing.purchaseOrdersList.length > 0
                  ? report.purchasing.purchaseOrdersList.map(mapPurchaseOrderItem)
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
              items: report.purchasing.orderStatuses.map((os) => {
                const children = (report.purchasing.purchaseOrdersList ?? [])
                  .filter((po) => po.status === os.status)
                  .map(mapPurchaseOrderItem);
                const status = os.status.replaceAll('_', ' ').toUpperCase();
                return {
                  id: os.status,
                  title: status,
                  note: `${os.orders} order${os.orders === 1 ? '' : 's'}`,
                  value: formatMoney(os.value),
                  statusTag: status,
                  statusTone:
                    os.status === 'received' || os.status === 'completed'
                      ? 'green'
                      : os.status === 'cancelled'
                        ? 'red'
                        : os.status === 'ordered' || os.status === 'partially_received'
                          ? 'amber'
                          : 'slate',
                  children: children.length ? children : undefined,
                } satisfies DetailItem;
              }),
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
              items:
                report.purchasing.purchaseOrdersList && report.purchasing.purchaseOrdersList.length > 0
                  ? report.purchasing.purchaseOrdersList
                      .filter((po) => po.status === 'ordered' || po.status === 'partially_received')
                      .map(mapPurchaseOrderItem)
                  : report.purchasing.orderStatuses
                      .filter((os) => os.status === 'ordered' || os.status === 'partially_received')
                      .map((os) => ({
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
      <View className="w-full flex-row flex-wrap gap-3">
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
        subtitle="Gross profit over time (net sales − cost of goods)"
      >
        <ProfitTrendChart trend={report.profit.trend} from={from} to={to} />
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
      <View className="w-full flex-row flex-wrap gap-3">
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

function AuditReport({
  report,
  onOpenDetail,
}: {
  report: ReportsWorkspace;
  onOpenDetail(config: MetricDrilldownConfig): void;
}) {
  const audit = report.audit;
  if (!audit) {
    return (
      <ReportCard
        title="Audit activity"
        subtitle="Voids, refunds, stock adjustments, and cash adjustments"
      >
        <View className="items-center rounded-2xl bg-slate-50 px-5 py-10">
          <Feather name="shield" size={28} color="#94A3B8" />
          <Text className="mt-3 text-sm font-semibold text-slate-800">Audit access is required</Text>
          <Text className="mt-1 max-w-lg text-center text-xs leading-5 text-slate-500">
            Ask an owner to grant Audit Logs access to view sensitive operational events.
          </Text>
        </View>
      </ReportCard>
    );
  }

  const detailItems = (type?: NonNullable<ReportsWorkspace['audit']>['events'][number]['type']): DetailItem[] =>
    audit.events
      .filter((event) => !type || event.type === type)
      .map((event) => ({
        id: event.id,
        title: event.title,
        category: event.branchName,
        note: `${new Date(event.createdAt).toLocaleString('en-PH')} - ${event.actorName ?? 'System'}`,
        value: event.amount === null ? event.detail : formatMoney(event.amount),
        subValue: event.amount === null ? undefined : event.detail,
        statusTag: event.type,
        statusTone: event.type === 'void' || event.type === 'refund' ? 'red' : event.type === 'cash' ? 'amber' : 'blue',
      }));

  return (
    <>
      <View className="w-full flex-row flex-wrap gap-3">
        <MetricCard
          label="Voided sales"
          value={`${audit.voidedSales}`}
          icon="slash"
          tone="red"
          onPress={() =>
            onOpenDetail({
              metricKey: 'void_count',
              title: 'Voided Sale Events',
              subtitle: 'Voided transactions in the selected date range.',
              icon: 'slash',
              tone: 'red',
              summaryLabel: 'Voided Sales',
              summaryValue: `${audit.voidedSales}`,
              items: detailItems('void'),
            })
          }
        />
        <MetricCard
          label="Refunds"
          value={formatMoney(audit.refundAmount)}
          note={`${audit.refundTransactions} transactions`}
          icon="corner-up-left"
          tone="red"
          onPress={() =>
            onOpenDetail({
              metricKey: 'refund_amount',
              title: 'Refund Events',
              subtitle: 'Completed customer refunds in the selected date range.',
              icon: 'corner-up-left',
              tone: 'red',
              summaryLabel: 'Refund Amount',
              summaryValue: formatMoney(audit.refundAmount),
              items: detailItems('refund'),
            })
          }
        />
        <MetricCard
          label="Stock adjustments"
          value={`${audit.inventoryAdjustments}`}
          icon="package"
          tone="blue"
          onPress={() =>
            onOpenDetail({
              metricKey: 'inventory_adjustments',
              title: 'Inventory Adjustment Events',
              subtitle: 'Manual stock changes recorded in the inventory ledger.',
              icon: 'package',
              tone: 'blue',
              summaryLabel: 'Stock Adjustments',
              summaryValue: `${audit.inventoryAdjustments}`,
              items: detailItems('inventory'),
            })
          }
        />
        <MetricCard
          label="Cash adjustments"
          value={`${audit.cashAdjustments}`}
          icon="repeat"
          tone="amber"
          onPress={() =>
            onOpenDetail({
              metricKey: 'cash_adjustments',
              title: 'Cash Adjustment Events',
              subtitle: 'Cash-in and cash-out movements recorded during shifts.',
              icon: 'repeat',
              tone: 'amber',
              summaryLabel: 'Cash Adjustments',
              summaryValue: `${audit.cashAdjustments}`,
              items: detailItems('cash'),
            })
          }
        />
      </View>
      <ReportCard
        title="Activity timeline"
        subtitle="Direct source events from the operational ledger, newest first."
        icon="clock"
      >
        {audit.events.length === 0 ? (
          <Text className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
            No sensitive activity was recorded for this period.
          </Text>
        ) : (
          <View className="gap-2">
            {audit.events.slice(0, 50).map((event) => (
              <View key={`${event.type}:${event.id}`} className="flex-row items-start gap-3 rounded-xl border border-slate-100 p-3.5">
                <View className="h-9 w-9 items-center justify-center rounded-xl bg-slate-50">
                  <Feather
                    name={event.type === 'void' ? 'slash' : event.type === 'refund' ? 'corner-up-left' : event.type === 'cash' ? 'dollar-sign' : 'package'}
                    size={15}
                    color={event.type === 'void' || event.type === 'refund' ? '#DC2626' : '#1A593B'}
                  />
                </View>
                <View className="min-w-0 flex-1">
                  <View className="flex-row flex-wrap items-center justify-between gap-2">
                    <Text className="font-medium text-slate-900">{event.title}</Text>
                    {event.amount !== null ? <Text className="font-semibold text-slate-900">{formatMoney(event.amount)}</Text> : null}
                  </View>
                  <Text className="mt-0.5 text-xs leading-5 text-slate-500">{event.detail}</Text>
                  <Text className="mt-1 text-[11px] text-slate-400">
                    {event.branchName} - {event.actorName ?? 'System'} - {new Date(event.createdAt).toLocaleString('en-PH')}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ReportCard>
    </>
  );
}

function RepackingReport({
  report,
  onOpenDetail,
}: {
  report: ReportsWorkspace;
  onOpenDetail(config: MetricDrilldownConfig): void;
}) {
  const repacking = report.repacking;
  if (!repacking) {
    return (
      <ReportCard title="Repacking performance" subtitle="Production output, cost allocation, yield, and loss">
        <Text className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
          No production or repacking data is available for this period.
        </Text>
      </ReportCard>
    );
  }

  const batchItems: DetailItem[] = repacking.batchRows.map((batch) => ({
    id: batch.id,
    title: batch.productName,
    sku: batch.batchNumber,
    quantity: batch.quantityProduced,
    value: formatMoney(batch.totalCost),
    subValue: `${formatMoney(batch.unitCost)} per output unit`,
    note: `${new Date(batch.createdAt).toLocaleString('en-PH')} - Input ${batch.inputQuantity} - Output ${batch.quantityProduced}`,
    statusTag: batch.yieldPercent === null ? 'Mixed units' : `${Number(batch.yieldPercent).toFixed(1)}% yield`,
    statusTone: batch.yieldPercent === null ? 'slate' : Number(batch.yieldPercent) >= 95 ? 'green' : 'amber',
  }));

  return (
    <>
      <View className="w-full flex-row flex-wrap gap-3">
        <MetricCard
          label="Batches"
          value={`${repacking.batches}`}
          icon="layers"
          onPress={() =>
            onOpenDetail({
              metricKey: 'production_batches',
              title: 'Production and Repacking Batches',
              subtitle: 'Finished-stock batches recorded during this period.',
              icon: 'layers',
              summaryLabel: 'Recorded Batches',
              summaryValue: `${repacking.batches}`,
              items: batchItems,
            })
          }
        />
        <MetricCard label="Output quantity" value={`${repacking.outputQuantity}`} icon="package" tone="blue" />
        <MetricCard label="Allocated cost" value={formatMoney(repacking.totalCost)} icon="dollar-sign" />
        <MetricCard label="Average output cost" value={formatMoney(repacking.averageCostPerOutput)} icon="pie-chart" tone="blue" />
        <MetricCard
          label="Yield"
          value={repacking.yieldPercent === null ? 'Not comparable' : `${Number(repacking.yieldPercent).toFixed(1)}%`}
          note={repacking.yieldPercent === null ? 'Input and output units differ' : 'Output divided by comparable input'}
          icon="trending-up"
        />
        <MetricCard
          label="Loss"
          value={repacking.lossPercent === null ? 'Not comparable' : `${Number(repacking.lossPercent).toFixed(1)}%`}
          note="100% minus comparable yield"
          icon="trending-down"
          tone={repacking.lossPercent !== null && Number(repacking.lossPercent) > 5 ? 'amber' : 'brand'}
        />
      </View>
      <ReportCard
        title="Production batch ledger"
        subtitle="Source consumption and finished output are costed when the batch is recorded."
        icon="list"
      >
        {repacking.batchRows.length === 0 ? (
          <Text className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
            No production or repacking batches were recorded for this period.
          </Text>
        ) : (
          <View className="gap-2">
            {repacking.batchRows.map((batch) => (
              <Pressable
                key={batch.id}
                accessibilityRole="button"
                onPress={() =>
                  onOpenDetail({
                    metricKey: `batch:${batch.id}`,
                    title: batch.batchNumber,
                    subtitle: `${batch.productName} production details`,
                    icon: 'layers',
                    summaryLabel: 'Allocated Batch Cost',
                    summaryValue: formatMoney(batch.totalCost),
                    items: [batchItems.find((item) => item.id === batch.id)!],
                  })
                }
                className="flex-row flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 p-3.5 active:bg-slate-50"
              >
                <View className="min-w-0 flex-1">
                  <Text className="font-medium text-slate-900">{batch.productName}</Text>
                  <Text className="mt-0.5 text-xs text-slate-500">
                    {batch.batchNumber} - {new Date(batch.createdAt).toLocaleString('en-PH')}
                  </Text>
                  <Text className="mt-1 text-[11px] text-slate-400">
                    Input {batch.inputQuantity} - Output {batch.quantityProduced}
                    {batch.yieldPercent === null ? ' - Mixed units' : ` - ${Number(batch.yieldPercent).toFixed(1)}% yield`}
                  </Text>
                </View>
                <View className="items-end">
                  <Text className="font-semibold text-slate-900">{formatMoney(batch.totalCost)}</Text>
                  <Text className="mt-0.5 text-[11px] text-slate-500">{formatMoney(batch.unitCost)} per unit</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ReportCard>
    </>
  );
}

interface StandardComparisonMetric {
  id: string;
  label: string;
  value: number;
  comparisonValue: number | null;
  format: 'currency' | 'number' | 'percentage';
}

function reportComparisonMetrics(
  report: ReportsWorkspace,
  comparison: ReportsWorkspace | undefined,
  section: ReportSection,
): StandardComparisonMetric[] {
  const metric = (
    id: string,
    label: string,
    current: string | number | null | undefined,
    previous: string | number | null | undefined,
    format: StandardComparisonMetric['format'],
  ): StandardComparisonMetric => ({
    id,
    label,
    value: Number(current ?? 0),
    comparisonValue: comparison ? Number(previous ?? 0) : null,
    format,
  });
  if (section === 'inventory') {
    return [
      metric('inventory_value_cost', 'Inventory value (cost)', report.inventory.inventoryValue, comparison?.inventory.inventoryValue, 'currency'),
      metric('inventory_value_retail', 'Inventory value (retail)', report.inventory.retailValue, comparison?.inventory.retailValue, 'currency'),
      metric('inventory_quantity', 'Inventory quantity', report.inventory.unitsOnHand, comparison?.inventory.unitsOnHand, 'number'),
      metric('dead_stock', 'Dead stock', report.inventory.deadStockCount, comparison?.inventory.deadStockCount, 'number'),
    ];
  }
  if (section === 'purchasing') {
    return [
      metric('purchase_value', 'Purchase value', report.purchasing.orderedValue, comparison?.purchasing.orderedValue, 'currency'),
      metric('receiving_accuracy', 'Receiving accuracy', report.purchasing.receivingAccuracy, comparison?.purchasing.receivingAccuracy, 'percentage'),
      metric('supplier_fulfillment_rate', 'Supplier fulfillment', report.purchasing.supplierFulfillmentRate, comparison?.purchasing.supplierFulfillmentRate, 'percentage'),
      metric('outstanding_payables', 'Outstanding payables', report.purchasing.outstandingPayables, comparison?.purchasing.outstandingPayables, 'currency'),
    ];
  }
  if (section === 'cash') {
    return [
      metric('cash_drawer_balance', 'Drawer balance', report.cash.drawerBalance, comparison?.cash.drawerBalance, 'currency'),
      metric('expected_cash', 'Expected cash', report.cash.expectedCash, comparison?.cash.expectedCash, 'currency'),
      metric('counted_cash', 'Counted cash', report.cash.countedCash, comparison?.cash.countedCash, 'currency'),
      metric('cash_variance', 'Cash variance', report.cash.variance, comparison?.cash.variance, 'currency'),
    ];
  }
  if (section === 'audit') {
    return [
      metric('void_count', 'Voided sales', report.audit?.voidedSales, comparison?.audit?.voidedSales, 'number'),
      metric('refund_amount', 'Refund amount', report.audit?.refundAmount, comparison?.audit?.refundAmount, 'currency'),
      metric('inventory_adjustments', 'Stock adjustments', report.audit?.inventoryAdjustments, comparison?.audit?.inventoryAdjustments, 'number'),
      metric('cash_adjustments', 'Cash adjustments', report.audit?.cashAdjustments, comparison?.audit?.cashAdjustments, 'number'),
    ];
  }
  if (section === 'repacking') {
    return [
      metric('batches', 'Production batches', report.repacking?.batches, comparison?.repacking?.batches, 'number'),
      metric('cost_allocation', 'Production cost', report.repacking?.totalCost, comparison?.repacking?.totalCost, 'currency'),
      metric('yield_percent', 'Yield', report.repacking?.yieldPercent, comparison?.repacking?.yieldPercent, 'percentage'),
      metric('loss_percent', 'Loss', report.repacking?.lossPercent, comparison?.repacking?.lossPercent, 'percentage'),
    ];
  }
  if (section === 'profit') {
    return [
      metric('net_sales', 'Net sales', report.profit.netSales, comparison?.profit.netSales, 'currency'),
      metric('cogs', 'COGS', report.profit.netCost, comparison?.profit.netCost, 'currency'),
      metric('gross_profit', 'Gross profit', report.profit.grossProfit, comparison?.profit.grossProfit, 'currency'),
      metric('profit_margin', 'Profit margin', report.profit.grossMarginPercent, comparison?.profit.grossMarginPercent, 'percentage'),
    ];
  }
  if (section === 'products') {
    const currentSales = report.sales.topProducts.reduce((sum, item) => sum + Number(item.sales), 0);
    const previousSales = comparison?.sales.topProducts.reduce((sum, item) => sum + Number(item.sales), 0);
    const currentQuantity = report.sales.topProducts.reduce((sum, item) => sum + Number(item.quantity), 0);
    const previousQuantity = comparison?.sales.topProducts.reduce((sum, item) => sum + Number(item.quantity), 0);
    const currentProfit = report.sales.topProducts.reduce((sum, item) => sum + Number(item.profit ?? 0), 0);
    const previousProfit = comparison?.sales.topProducts.reduce((sum, item) => sum + Number(item.profit ?? 0), 0);
    return [
      metric('product_sales', 'Product sales', currentSales, previousSales, 'currency'),
      metric('quantity_sold', 'Quantity sold', currentQuantity, previousQuantity, 'number'),
      metric('products_sold', 'Products sold', report.sales.topProducts.length, comparison?.sales.topProducts.length, 'number'),
      metric('gross_profit', 'Gross profit', currentProfit, previousProfit, 'currency'),
    ];
  }
  return [
    metric('gross_sales', 'Gross sales', report.kpis.grossSales, comparison?.kpis.grossSales, 'currency'),
    metric('total_discounts', 'Total discounts', report.kpis.discounts, comparison?.kpis.discounts, 'currency'),
    metric('refund_amount', 'Refund amount', report.kpis.customerRefunds, comparison?.kpis.customerRefunds, 'currency'),
    metric('net_sales', 'Net sales', report.kpis.netSales, comparison?.kpis.netSales, 'currency'),
  ];
}

function ReportStandardsPanel({
  definition,
  report,
  comparisonReport,
  comparisonMode,
  comparisonLabel,
  isRefreshing,
  updatedAt,
  onRefresh,
}: {
  definition?: ReportDefinition;
  report: ReportsWorkspace;
  comparisonReport?: ReportsWorkspace;
  comparisonMode: ComparisonPeriod;
  comparisonLabel: string;
  isRefreshing: boolean;
  updatedAt: number;
  onRefresh(): void;
}) {
  const { width } = useWindowDimensions();
  const phone = width < 640;
  const [showDefinitions, setShowDefinitions] = useState(false);
  const section = (Object.entries(SECTION_REPORT_IDS).find(([, id]) => id === definition?.reportId)?.[0] ?? 'overview') as ReportSection;
  const comparisons = reportComparisonMetrics(report, comparisonReport, section);
  const refreshLabel =
    definition?.refreshStrategy === 'five_minutes'
      ? 'Every 5 minutes'
      : definition?.refreshStrategy === 'on_demand'
        ? 'On demand'
        : 'Real-time';

  return (
    <View className="gap-3 rounded-2xl border border-slate-100 bg-white p-4" style={softCardShadow}>
      <View className={`${phone ? 'gap-3' : 'flex-row items-start justify-between gap-4'}`}>
        <View className="min-w-0 flex-1">
          <View className="flex-row flex-wrap items-center gap-2">
            <Text className="text-lg font-semibold text-slate-950">
              {definition?.reportName ?? 'Business report'}
            </Text>
            <View className="rounded-full bg-[#E8F5EE] px-2.5 py-1">
              <Text className="text-[10px] font-semibold uppercase tracking-wide text-brand-800">
                {definition?.status ?? 'active'}
              </Text>
            </View>
          </View>
          <Text className="mt-1 text-xs leading-5 text-slate-600">
            {definition?.purpose ?? 'Operational report using standardized Ximo metrics.'}
          </Text>
          <Text className="mt-2 text-[11px] text-slate-400">
            Report ID: {definition?.reportId ?? 'workspace'} · Module: {definition?.module ?? 'Reports'} · Version {definition?.version ?? '1.0'}
          </Text>
        </View>
        <View className="flex-row flex-wrap items-center gap-2">
          <View className="rounded-xl bg-slate-50 px-3 py-2">
            <Text className="text-[10px] uppercase tracking-wide text-slate-400">Last updated</Text>
            <Text className="mt-0.5 text-xs font-medium text-slate-700">
              {updatedAt ? new Date(updatedAt).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : 'Waiting'}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh report"
            onPress={onRefresh}
            className="min-h-11 flex-row items-center rounded-xl border border-slate-200 bg-white px-3.5 active:bg-slate-50"
          >
            <Feather name="refresh-cw" size={14} color="#1A593B" />
            <Text className="ml-2 text-xs font-semibold text-brand-800">
              {isRefreshing ? 'Refreshing…' : 'Refresh'}
            </Text>
          </Pressable>
        </View>
      </View>

      <View className="flex-row flex-wrap gap-2">
        <View className="rounded-full bg-slate-50 px-3 py-1.5">
          <Text className="text-[11px] text-slate-600">{refreshLabel}</Text>
        </View>
        <View className="rounded-full bg-slate-50 px-3 py-1.5">
          <Text className="text-[11px] text-slate-600">
            {report.metadata?.timezone ?? 'Asia/Manila'} · {report.metadata?.currency ?? 'PHP'}
          </Text>
        </View>
        <View className="rounded-full bg-slate-50 px-3 py-1.5">
          <Text className="text-[11px] text-slate-600">Completed transactions only</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => setShowDefinitions((value) => !value)}
          className="flex-row items-center rounded-full bg-[#E8F5EE] px-3 py-1.5"
        >
          <Feather name="book-open" size={12} color="#1A593B" />
          <Text className="ml-1.5 text-[11px] font-medium text-brand-800">
            {showDefinitions ? 'Hide definitions' : 'Metric definitions'}
          </Text>
        </Pressable>
      </View>

      <View className="flex-row flex-wrap gap-2">
        {comparisons.map((item) => {
          const delta =
            item.comparisonValue === null
              ? null
              : item.comparisonValue === 0
                ? item.value === 0
                  ? 0
                  : 100
                : ((item.value - item.comparisonValue) / Math.abs(item.comparisonValue)) * 100;
          const display =
            item.format === 'currency'
              ? formatMoney(item.value)
              : item.format === 'percentage'
                ? `${item.value.toFixed(1)}%`
                : item.value.toLocaleString('en-PH', { maximumFractionDigits: 2 });
          return (
            <View
              key={item.id}
              className="min-w-[150px] flex-1 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3"
              style={{ flexBasis: phone ? '46%' : '22%' }}
            >
              <Text className="text-[10px] font-medium uppercase tracking-wide text-slate-500" numberOfLines={1}>
                {item.label}
              </Text>
              <Text className="mt-1 text-lg font-semibold text-slate-950" numberOfLines={1}>{display}</Text>
              {comparisonMode !== 'none' ? (
                <Text className={`mt-1 text-[11px] font-medium ${delta !== null && delta < 0 ? 'text-rose-600' : 'text-brand-700'}`}>
                  {delta === null ? 'Loading comparison…' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% vs ${comparisonLabel}`}
                </Text>
              ) : (
                <Text className="mt-1 text-[11px] text-slate-400">Comparison off</Text>
              )}
            </View>
          );
        })}
      </View>

      {showDefinitions ? (
        <View className="gap-2 border-t border-slate-100 pt-3">
          {(definition?.metrics ?? []).map((metricId) => {
            const item = REPORT_METRICS[metricId];
            if (!item) return null;
            return (
              <View key={metricId} className="rounded-xl bg-slate-50 px-3 py-2.5">
                <Text className="text-xs font-semibold text-slate-800">{item.label}</Text>
                <Text className="mt-0.5 text-[11px] leading-4 text-slate-500">{item.description}</Text>
                <Text className="mt-1 text-[11px] font-medium text-brand-800">{item.formula}</Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function ReportsContent({ initialSection = 'sales' }: { initialSection?: ReportSection }) {
  const { width } = useWindowDimensions();
  const phone = width < 640;
  // Account for desktop sidebar so the report stays centered in the content pane.
  const sidebarOffset = width >= 1100 ? 272 : 0;
  const workspaceMaxWidth = Math.min(1480, Math.max(phone ? width - 24 : 720, width - sidebarOffset - 48));
  const branch = useBranchStore((state) => state.activeBranch);
  const { currentUser, session, loading: sessionLoading } = useSession();
  const { showAlert } = useIosAlert();
  const canViewProfit = (currentUser?.permissions ?? []).includes('reports:view_profit');
  const canViewAudit =
    (currentUser?.permissions ?? []).includes('audit:read') &&
    (currentUser?.modules ?? []).includes('audit');
  const canViewAllBranches =
    (currentUser?.permissions ?? []).includes('reports:view_all_branches') ||
    (currentUser?.permissions ?? []).includes('sales:read_all');
  const canViewRepacking =
    (currentUser?.modules ?? []).includes('production') ||
    (currentUser?.modules ?? []).includes('recipes');
  const visibleSections = useMemo(
    () =>
      SECTIONS.filter((item) => {
        if (item.key === 'profit') return canViewProfit;
        if (item.key === 'audit') return canViewAudit;
        if (item.key === 'repacking') return canViewRepacking;
        return true;
      }),
    [canViewAudit, canViewProfit, canViewRepacking],
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
  const [calendarSession, setCalendarSession] = useState(0);
  const [customRange, setCustomRange] = useState(defaultCustomRange);
  const [draftFrom, setDraftFrom] = useState(defaultCustomRange.from);
  const [draftTo, setDraftTo] = useState(defaultCustomRange.to);
  const [dateRangeError, setDateRangeError] = useState('');
  const [exportMenuVisible, setExportMenuVisible] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [comparisonMode, setComparisonMode] = useState<ComparisonPeriod>('previous_period');
  const [reportBranchId, setReportBranchId] = useState<string | 'all' | null>(branch?.id ?? null);

  useEffect(() => {
    if (!reportBranchId && branch?.id) setReportBranchId(branch.id);
  }, [branch?.id, reportBranchId]);

  const reportBranchName =
    reportBranchId === 'all'
      ? 'All accessible branches'
      : currentUser?.branches.find((item) => item.id === reportBranchId)?.name ??
        branch?.name ??
        'Selected branch';

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
  const comparisonRange = useMemo(
    () => comparisonDateRange(range, comparisonMode),
    [comparisonMode, range],
  );
  const comparisonLabel =
    comparisonMode === 'previous_month'
      ? 'previous month'
      : comparisonMode === 'previous_year'
        ? 'previous year'
        : 'previous period';
  const reportDefinition = useMemo(
    () => REPORT_CATALOG.find((item) => item.reportId === SECTION_REPORT_IDS[section]),
    [section],
  );

  const exportMetadata = useMemo(
    () => ({
      organizationName: currentUser?.organization.name ?? 'Ximo POS',
      branchName: reportBranchName,
      rangeLabel,
      from: range.from,
      to: range.to,
      generatedAt: new Date(),
    }),
    [currentUser?.organization.name, range.from, range.to, rangeLabel, reportBranchName],
  );

  const query = useQuery({
    queryKey: ['reports-workspace', period, reportBranchId, range.from, range.to, session?.user?.id],
    enabled: !sessionLoading && Boolean(session?.access_token) && Boolean(reportBranchId),
    queryFn: () =>
      api<ReportsWorkspace>(
        `/reports/workspace?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(
          range.to,
        )}${reportBranchId === 'all' ? '' : `&branchId=${reportBranchId}`}`,
      ),
    refetchInterval:
      section === 'purchasing' || section === 'products' ? 300_000 : section === 'profit' ? false : 60_000,
  });

  const comparisonQuery = useQuery({
    queryKey: [
      'reports-workspace-comparison',
      comparisonMode,
      reportBranchId,
      comparisonRange?.from,
      comparisonRange?.to,
      session?.user?.id,
    ],
    enabled:
      comparisonMode !== 'none' &&
      Boolean(comparisonRange) &&
      !sessionLoading &&
      Boolean(session?.access_token) &&
      Boolean(reportBranchId),
    queryFn: () =>
      api<ReportsWorkspace>(
        `/reports/workspace?from=${encodeURIComponent(comparisonRange!.from)}&to=${encodeURIComponent(
          comparisonRange!.to,
        )}${reportBranchId === 'all' ? '' : `&branchId=${reportBranchId}`}`,
      ),
    staleTime: 60_000,
  });

  const inventoryExportRef = useRef<(() => InventoryExportData) | null>(null);

  const handleWorkspaceExport = async (format: 'xlsx' | 'pdf' | 'csv') => {
    if (!query.data || exporting) return;
    setExporting(true);
    try {
      let output: { bytes: Uint8Array; fileName: string };
      if (format === 'csv') {
        output = buildReportsCsv(query.data, exportMetadata, section);
      } else if (section === 'inventory' && inventoryExportRef.current) {
        const invData = inventoryExportRef.current();
        output =
          format === 'xlsx'
            ? buildInventoryExportExcel(invData, exportMetadata)
            : await buildInventoryExportPdf(invData, exportMetadata);
      } else {
        output =
          format === 'xlsx'
            ? buildReportsExcel(query.data, exportMetadata, section)
            : await buildReportsPdf(query.data, exportMetadata);
      }
      await saveReportExport(output.bytes, output.fileName, format);
      setExportMenuVisible(false);
      showAlert({
        type: 'success',
        title: 'Export ready',
        message: `${output.fileName} has been downloaded.`,
      });
    } catch (error) {
      showAlert({
        type: 'error',
        title: 'Export failed',
        message: error instanceof Error ? error.message : 'Could not export reports.',
      });
    } finally {
      setExporting(false);
    }
  };

  const productsQuery = useQuery({
    queryKey: ['reports-products-list', reportBranchId, session?.user?.id],
    enabled:
      !sessionLoading &&
      Boolean(session?.access_token) &&
      Boolean(reportBranchId) &&
      reportBranchId !== 'all',
    queryFn: () =>
      api<any[]>(`/products?branchId=${reportBranchId}&includeInactive=true&pageSize=100`),
  });

  const inventoryItemsQuery = useQuery({
    queryKey: ['reports-inventory-items', reportBranchId, session?.user?.id],
    enabled:
      !sessionLoading &&
      Boolean(session?.access_token) &&
      Boolean(reportBranchId) &&
      reportBranchId !== 'all' &&
      section === 'inventory',
    queryFn: () =>
      api<any>(`/inventory?branchId=${reportBranchId}&pageSize=100`).catch(() => ({ data: [] })),
  });

  const inventoryMovementsQuery = useQuery({
    queryKey: ['reports-inventory-movements', reportBranchId, session?.user?.id],
    enabled:
      !sessionLoading &&
      Boolean(session?.access_token) &&
      Boolean(reportBranchId) &&
      reportBranchId !== 'all' &&
      section === 'inventory',
    queryFn: () =>
      api<any>(`/inventory/history?branchId=${reportBranchId}&pageSize=100`).catch(() => ({ data: [] })),
  });

  const productionProductsQuery = useQuery({
    queryKey: ['reports-production-products', reportBranchId, session?.user?.id],
    enabled:
      !sessionLoading &&
      Boolean(session?.access_token) &&
      Boolean(reportBranchId) &&
      reportBranchId !== 'all' &&
      section === 'inventory',
    queryFn: () =>
      api<any[]>(`/inventory/production-products?branchId=${reportBranchId}`).catch(() => []),
  });

  const productPerformanceQuery = useQuery({
    queryKey: ['reports-product-performance', period, reportBranchId, range.from, range.to, session?.user?.id],
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
          formulaDescription?: string;
          isSensitive?: boolean;
        }>;
        rows: ProductPerformanceRow[];
      }>(
        `/reports/products?from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}${
          reportBranchId && reportBranchId !== 'all' ? `&branchId=${reportBranchId}` : ''
        }`,
      );
    },
  });

  return (
    <Screen>
      <Header
        title={activeMetricDrilldown ? activeMetricDrilldown.title : 'Reports'}
        subtitle={
          activeMetricDrilldown
            ? `${rangeLabel} · ${reportBranchName}`
            : reportBranchName
        }
        showBack={!phone}
        backLabel="More"
        fallbackHref="/(tabs)/more"
        action={null}
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
        <View
          className="gap-4"
          style={{
            maxWidth: activeMetricDrilldown
              ? Math.min(1680, Math.max(width - sidebarOffset - 32, phone ? width - 24 : 960))
              : workspaceMaxWidth,
            width: '100%',
            alignSelf: 'center',
          }}
        >
          {!activeMetricDrilldown ? (
            <View className="flex-row flex-wrap items-end justify-between gap-3">
              <View className="min-w-[220px] flex-1">
                <Text className="text-2xl font-semibold text-slate-900">Reports</Text>
                <Text className="mt-1 text-sm text-slate-500">
                  Store performance for {rangeLabel}
                  {reportBranchName ? ` · ${reportBranchName}` : ''}.
                </Text>
              </View>
              <View className="flex-row flex-wrap items-center gap-2">
                {canViewAllBranches && (currentUser?.branches.length ?? 0) > 1 ? (
                  <View className="max-w-full rounded-xl border border-slate-200 bg-white p-1">
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View className="flex-row items-center gap-1">
                        {[
                          { id: 'all', name: 'All branches' },
                          ...(currentUser?.branches ?? []),
                        ].map((item) => {
                          const selected = reportBranchId === item.id;
                          return (
                            <Pressable
                              key={item.id}
                              accessibilityRole="button"
                              accessibilityState={{ selected }}
                              onPress={() => {
                                setReportBranchId(item.id);
                                setActiveMetricDrilldown(null);
                              }}
                              className={`min-h-8 justify-center rounded-lg px-2.5 ${
                                selected ? 'bg-[#E8F5EE]' : ''
                              }`}
                            >
                              <Text
                                className={`text-xs font-medium ${
                                  selected ? 'text-brand-800' : 'text-slate-500'
                                }`}
                              >
                                {item.name}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </ScrollView>
                  </View>
                ) : null}
                {PERIOD_PRESETS.slice(0, 4).map((item) => {
                  const selected = item.key === period;
                  return (
                    <Pressable
                      key={item.key}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => {
                        setPeriod(item.key);
                        setActiveMetricDrilldown(null);
                      }}
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
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Export reports"
                  disabled={!query.data || exporting}
                  onPress={() => setExportMenuVisible(true)}
                  className={`min-h-10 flex-row items-center rounded-xl px-3.5 ${
                    !query.data || exporting ? 'bg-slate-300' : 'bg-slate-900'
                  }`}
                >
                  <Feather name="download" size={15} color="#FFFFFF" />
                  <Text className="ml-2 text-[13px] font-medium text-white">
                    {exporting ? 'Exporting…' : 'Export'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {!activeMetricDrilldown ? (
            <View className="rounded-2xl border border-slate-100 bg-white p-2">
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View className="flex-row items-center gap-2">
                  <Text className="px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Compare
                  </Text>
                  {([
                    ['none', 'Off'],
                    ['previous_period', 'Previous period'],
                    ['previous_month', 'Previous month'],
                    ['previous_year', 'Previous year'],
                  ] as Array<[ComparisonPeriod, string]>).map(([key, label]) => {
                    const selected = comparisonMode === key;
                    return (
                      <Pressable
                        key={key}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => setComparisonMode(key)}
                        className={`min-h-9 justify-center rounded-xl px-3 ${selected ? 'bg-[#E8F5EE]' : 'bg-slate-50'}`}
                      >
                        <Text className={`text-xs font-medium ${selected ? 'text-brand-800' : 'text-slate-500'}`}>
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            </View>
          ) : null}

          {activeMetricDrilldown ? (
            <MetricDrilldownView
              config={activeMetricDrilldown}
              rangeLabel={rangeLabel}
              branchName={reportBranchName}
              organizationName={currentUser?.organization.name ?? 'Ximo POS'}
              onBack={() => setActiveMetricDrilldown(null)}
            />
          ) : (
            <>
              <View className="rounded-2xl border border-slate-100 bg-white p-1">
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View className="flex-row items-center gap-1">
                    {visibleSections.map((item) => {
                      const selected = item.key === section;
                      return (
                        <Pressable
                          key={item.key}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          onPress={() => setSection(item.key)}
                          className={`min-h-10 flex-row items-center justify-center rounded-xl px-4 ${
                            selected ? 'bg-brand-700' : 'active:bg-slate-50'
                          }`}
                        >
                          <Feather
                            name={item.icon}
                            size={14}
                            color={selected ? '#FFFFFF' : '#94A3B8'}
                          />
                          <Text
                            className={`ml-2 text-[13px] font-medium ${
                              selected ? 'text-white' : 'text-slate-500'
                            }`}
                          >
                            {item.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </ScrollView>
              </View>

              {query.data ? (
                <ReportStandardsPanel
                  definition={reportDefinition}
                  report={query.data}
                  comparisonReport={comparisonQuery.data}
                  comparisonMode={comparisonMode}
                  comparisonLabel={comparisonLabel}
                  isRefreshing={query.isRefetching || comparisonQuery.isFetching}
                  updatedAt={query.dataUpdatedAt}
                  onRefresh={() => {
                    void query.refetch();
                    if (comparisonMode !== 'none') void comparisonQuery.refetch();
                  }}
                />
              ) : null}

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
                    <OverviewReport
                      report={query.data}
                      from={range.from}
                      to={range.to}
                      setSection={setSection}
                      onOpenDetail={handleOpenDetail}
                    />
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
                      report={query.data!}
                      productsList={productsQuery.data ?? []}
                      inventoryItems={
                        Array.isArray(inventoryItemsQuery.data)
                          ? inventoryItemsQuery.data
                          : inventoryItemsQuery.data?.data ?? []
                      }
                      inventoryMovements={
                        Array.isArray(inventoryMovementsQuery.data)
                          ? inventoryMovementsQuery.data
                          : inventoryMovementsQuery.data?.data ?? []
                      }
                      productionProducts={productionProductsQuery.data ?? []}
                      isLoadingMovements={inventoryMovementsQuery.isLoading}
                      onOpenDetail={handleOpenDetail}
                      exportRef={inventoryExportRef}
                    />
                  ) : null}
                  {section === 'purchasing' ? (
                    <PurchasingReport report={query.data} onOpenDetail={handleOpenDetail} />
                  ) : null}
                  {section === 'profit' ? (
                    <ProfitReport
                      report={query.data}
                      from={range.from}
                      to={range.to}
                      onOpenDetail={handleOpenDetail}
                    />
                  ) : null}
                  {section === 'cash' ? (
                    <CashReport report={query.data} onOpenDetail={handleOpenDetail} />
                  ) : null}
                  {section === 'audit' ? (
                    <AuditReport report={query.data} onOpenDetail={handleOpenDetail} />
                  ) : null}
                  {section === 'repacking' ? (
                    <RepackingReport report={query.data} onOpenDetail={handleOpenDetail} />
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </View>
      </ScrollView>

      <Modal
        visible={exportMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setExportMenuVisible(false)}
      >
        <View className="flex-1 items-center justify-center bg-black/40 p-4">
          <Pressable
            className="absolute inset-0"
            accessibilityRole="button"
            onPress={() => setExportMenuVisible(false)}
          />
          <View
            className="w-full overflow-hidden rounded-2xl bg-white p-5"
            style={{ maxWidth: 400, ...softCardShadow }}
          >
            <View className="mb-4 flex-row items-start justify-between gap-3">
              <View className="min-w-0 flex-1">
                <Text className="text-lg font-semibold text-slate-900">Export reports</Text>
                <Text className="mt-1 text-xs text-slate-500">
                  Download {rangeLabel} for {exportMetadata.branchName}.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => setExportMenuVisible(false)}
                className="h-9 w-9 items-center justify-center rounded-full bg-slate-100"
              >
                <Feather name="x" size={16} color="#64748B" />
              </Pressable>
            </View>
            <View className="gap-2">
              <Pressable
                accessibilityRole="button"
                disabled={exporting || !query.data}
                onPress={() => void handleWorkspaceExport('csv')}
                className="min-h-12 flex-row items-center rounded-xl border border-slate-100 bg-slate-50 px-4 active:bg-slate-100"
              >
                <View className="h-9 w-9 items-center justify-center rounded-xl bg-[#F4F0E6]">
                  <Feather name="list" size={16} color="#8A6A2F" />
                </View>
                <View className="ml-3 min-w-0 flex-1">
                  <Text className="text-sm font-semibold text-slate-900">CSV data</Text>
                  <Text className="mt-0.5 text-xs text-slate-500">
                    Current report tab for data tools and imports
                  </Text>
                </View>
                <Feather name="download" size={16} color="#8A6A2F" />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={exporting || !query.data}
                onPress={() => void handleWorkspaceExport('xlsx')}
                className="min-h-12 flex-row items-center rounded-xl border border-slate-100 bg-slate-50 px-4 active:bg-slate-100"
              >
                <View className="h-9 w-9 items-center justify-center rounded-xl bg-[#E8F5EE]">
                  <Feather name="file-text" size={16} color="#1A593B" />
                </View>
                <View className="ml-3 min-w-0 flex-1">
                  <Text className="text-sm font-semibold text-slate-900">Excel workbook</Text>
                  <Text className="mt-0.5 text-xs text-slate-500">
                    Summary, Sales, Inventory, Purchasing, Profit, Cash, Audit, Repacking
                  </Text>
                </View>
                <Feather name="download" size={16} color="#1A593B" />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={exporting || !query.data}
                onPress={() => void handleWorkspaceExport('pdf')}
                className="min-h-12 flex-row items-center rounded-xl border border-slate-100 bg-slate-50 px-4 active:bg-slate-100"
              >
                <View className="h-9 w-9 items-center justify-center rounded-xl bg-[#EAF4FB]">
                  <Feather name="file" size={16} color="#1D6B8A" />
                </View>
                <View className="ml-3 min-w-0 flex-1">
                  <Text className="text-sm font-semibold text-slate-900">PDF report</Text>
                  <Text className="mt-0.5 text-xs text-slate-500">
                    Printable multi-page business report
                  </Text>
                </View>
                <Feather name="download" size={16} color="#1D6B8A" />
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={dateRangeVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDateRangeVisible(false)}
      >
        <View className={`flex-1 items-center justify-center bg-black/40 ${phone ? 'p-3' : 'p-6'}`}>
          <View
            className="max-h-[92%] w-full overflow-hidden rounded-2xl bg-white"
            style={{ maxWidth: width >= 760 ? 720 : 440, ...softCardShadow }}
          >
            <ScrollView contentContainerClassName="p-5 gap-4" keyboardShouldPersistTaps="handled">
              <View className="flex-row items-start justify-between gap-3">
                <View className="min-w-0 flex-1">
                  <Text className="text-lg font-semibold text-slate-950">Select date range</Text>
                  <Text className="mt-1 text-xs leading-4 text-slate-500">
                    Calendar picker for every report. Tap a start date, then an end date.
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setDateRangeVisible(false)}
                  className="h-9 w-9 items-center justify-center rounded-full bg-slate-100"
                >
                  <Feather name="x" size={16} color="#81776E" />
                </Pressable>
              </View>

              <View>
                <Text className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  Quick presets
                </Text>
                <View className="flex-row flex-wrap gap-2">
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
                          setActiveMetricDrilldown(null);
                          if (p.key !== 'custom') setDateRangeVisible(false);
                        }}
                        className={`rounded-full px-3.5 py-2 ${
                          isSel ? 'bg-brand-700' : 'bg-slate-50 active:bg-slate-100'
                        }`}
                      >
                        <Text className={`text-xs font-semibold ${isSel ? 'text-white' : 'text-slate-700'}`}>
                          {p.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View>
                <Text className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  Calendar
                </Text>
                <DateRangeCalendar
                  key={calendarSession}
                  from={draftFrom}
                  to={draftTo}
                  onChange={({ from, to }) => {
                    setDraftFrom(from);
                    setDraftTo(to);
                    setDateRangeError('');
                  }}
                />
              </View>

              {dateRangeError ? (
                <View className="rounded-2xl bg-red-50 px-3 py-2.5">
                  <Text className="text-xs font-medium text-red-700">{dateRangeError}</Text>
                </View>
              ) : null}

              <View className={`gap-2 ${phone ? '' : 'flex-row'}`}>
                <View className={phone ? '' : 'flex-1'}>
                  <Button
                    title="Cancel"
                    variant="secondary"
                    onPress={() => setDateRangeVisible(false)}
                  />
                </View>
                <View className={phone ? '' : 'flex-1'}>
                  <Button
                    title="Apply range"
                    onPress={() => {
                      if (!isValidDateInput(draftFrom) || !isValidDateInput(draftTo)) {
                        setDateRangeError('Select a valid start and end date on the calendar.');
                        return;
                      }
                      if (dateAtLocalMidnight(draftFrom) > dateAtLocalMidnight(draftTo)) {
                        setDateRangeError('Start date cannot be later than end date.');
                        return;
                      }
                      setCustomRange({ from: draftFrom, to: draftTo });
                      setPeriod('custom');
                      setActiveMetricDrilldown(null);
                      setDateRangeVisible(false);
                    }}
                  />
                </View>
              </View>
            </ScrollView>
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
