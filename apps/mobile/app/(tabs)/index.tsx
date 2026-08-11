import { useMemo, useState, type ComponentProps } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { api } from '@/lib/api';
import { formatMoney, todayRange } from '@/lib/format';
import { useSession } from '@/providers/session';
import { useBranchStore } from '@/store/branch';
import { ErrorState, Header, LoadingState, Screen } from '@/components/ui';

type PeriodKey = 'today' | '7d';

interface Summary {
  salesTotal: string;
  transactions: number;
  averageTransaction: string;
  grossProfit: string;
  salesByPaymentMethod: Array<{ method: string; total: string }>;
  bestSellingProducts: Array<{ name: string; quantity: number; total?: string; unit?: string }>;
  lowStock: Array<{ name: string; branchName: string; quantity: number; unit?: string }>;
  salesByBranch?: Array<{ name: string; total: string; transactions: number }>;
}

interface WorkspaceTrend {
  sales: {
    trend: Array<{ date: string; sales: string; transactions: number }>;
  };
}

const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 days' },
];

const METRIC_TONES = [
  { bg: 'bg-[#E8F5EE]', accent: '#1A593B' },
  { bg: 'bg-[#EAF4FB]', accent: '#1D6B8A' },
  { bg: 'bg-[#F4F0E6]', accent: '#8A6A2F' },
  { bg: 'bg-[#EEF2FF]', accent: '#3F5B9A' },
  { bg: 'bg-[#FCEEEE]', accent: '#A13D3D' },
] as const;

function periodRange(period: PeriodKey): { from: string; to: string; label: string } {
  if (period === 'today') {
    const range = todayRange();
    return { ...range, label: 'Today' };
  }
  const to = new Date();
  to.setHours(0, 0, 0, 0);
  to.setDate(to.getDate() + 1);
  const from = new Date(to);
  from.setDate(from.getDate() - 7);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    label: 'Last 7 days',
  };
}

function firstName(displayName: string | undefined): string {
  const trimmed = displayName?.trim() ?? '';
  if (!trimmed) return 'there';
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

function MetricCard({
  label,
  value,
  note,
  icon,
  tone,
  width,
}: {
  label: string;
  value: string;
  note?: string;
  icon: ComponentProps<typeof Feather>['name'];
  tone: (typeof METRIC_TONES)[number];
  width: number | `${number}%`;
}) {
  return (
    <View className={`rounded-2xl p-4 ${tone.bg}`} style={{ width, minWidth: 150, flexGrow: 1 }}>
      <View className="mb-3 flex-row items-center justify-between">
        <Text className="text-[12px] font-medium text-slate-600">{label}</Text>
        <View className="h-8 w-8 items-center justify-center rounded-xl bg-white/70">
          <Feather name={icon} size={15} color={tone.accent} />
        </View>
      </View>
      <Text className="text-2xl font-semibold text-slate-900" numberOfLines={1}>
        {value}
      </Text>
      {note ? <Text className="mt-1.5 text-xs text-slate-500">{note}</Text> : null}
    </View>
  );
}

function SummaryChart({
  trend,
}: {
  trend: Array<{ date: string; sales: string; transactions: number }>;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const series = trend.length ? trend : [];
  const maxSales = Math.max(...series.map((item) => Number(item.sales)), 1);
  const chartWidth = 560;
  const chartHeight = 220;
  const leftPad = 36;
  const rightPad = 12;
  const topPad = 18;
  const bottomPad = 28;
  const plotWidth = chartWidth - leftPad - rightPad;
  const plotHeight = chartHeight - topPad - bottomPad;

  const points = series.map((item, index) => {
    const x =
      series.length > 1
        ? leftPad + (index / (series.length - 1)) * plotWidth
        : leftPad + plotWidth / 2;
    const y = topPad + plotHeight - (Number(item.sales) / maxSales) * plotHeight;
    return { x, y, item };
  });

  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ');
  const areaPath = points.length
    ? `${linePath} L ${points.at(-1)!.x.toFixed(1)} ${topPad + plotHeight} L ${points[0]!.x.toFixed(1)} ${topPad + plotHeight} Z`
    : '';

  const labelIndexes =
    series.length <= 7
      ? series.map((_, i) => i)
      : [0, Math.round((series.length - 1) / 3), Math.round(((series.length - 1) * 2) / 3), series.length - 1];

  if (!series.length) {
    return (
      <View className="items-center justify-center rounded-xl bg-slate-50 py-16">
        <Text className="text-sm text-slate-500">No sales activity for this period.</Text>
      </View>
    );
  }

  const active = hovered !== null ? points[hovered] : null;

  return (
    <View>
      <svg
        width="100%"
        height={chartHeight}
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        style={{ cursor: 'crosshair', touchAction: 'pan-y' }}
        onMouseMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - bounds.left;
          const ratio = plotWidth > 0 ? (x - leftPad) / plotWidth : 0;
          const index = Math.round(ratio * Math.max(series.length - 1, 0));
          setHovered(Math.min(series.length - 1, Math.max(0, index)));
        }}
        onMouseLeave={() => setHovered(null)}
      >
        <defs>
          <linearGradient id="dashAreaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1A593B" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#1A593B" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = topPad + plotHeight - ratio * plotHeight;
          return (
            <g key={ratio}>
              <line
                x1={leftPad}
                y1={y}
                x2={chartWidth - rightPad}
                y2={y}
                stroke="#E8EDE9"
                strokeWidth="1"
              />
              <text x={leftPad - 6} y={y + 3} textAnchor="end" fontSize="9" fill="#94A3B8">
                {formatMoney((maxSales * ratio).toFixed(0)).replace(/\.00$/, '')}
              </text>
            </g>
          );
        })}
        <path d={areaPath} fill="url(#dashAreaFill)" />
        <path
          d={linePath}
          fill="none"
          stroke="#1A593B"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {labelIndexes.map((index) => {
          const point = points[index];
          if (!point) return null;
          return (
            <text
              key={point.item.date}
              x={point.x}
              y={chartHeight - 8}
              textAnchor="middle"
              fontSize="10"
              fill="#94A3B8"
            >
              {new Date(`${point.item.date}T12:00:00`).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
            </text>
          );
        })}
        {active ? (
          <g style={{ pointerEvents: 'none' }}>
            <line
              x1={active.x}
              y1={topPad}
              x2={active.x}
              y2={topPad + plotHeight}
              stroke="#94A3B8"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <circle cx={active.x} cy={active.y} r={5} fill="#1A593B" stroke="#FFFFFF" strokeWidth="2" />
            <rect
              x={Math.min(Math.max(active.x - 52, 4), chartWidth - 108)}
              y={Math.max(4, active.y - 42)}
              width={104}
              height={34}
              rx={8}
              fill="#0F172A"
              opacity={0.94}
            />
            <text
              x={Math.min(Math.max(active.x - 52, 4), chartWidth - 108) + 10}
              y={Math.max(4, active.y - 42) + 14}
              fontSize="9"
              fill="#CBD5E1"
            >
              {new Date(`${active.item.date}T12:00:00`).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
            </text>
            <text
              x={Math.min(Math.max(active.x - 52, 4), chartWidth - 108) + 10}
              y={Math.max(4, active.y - 42) + 27}
              fontSize="11"
              fontWeight="600"
              fill="#86EFAC"
            >
              {formatMoney(active.item.sales)}
            </text>
          </g>
        ) : null}
      </svg>
    </View>
  );
}

export default function DashboardScreen() {
  const { width } = useWindowDimensions();
  const { currentUser } = useSession();
  const branch = useBranchStore((state) => state.activeBranch);
  const [period, setPeriod] = useState<PeriodKey>('today');
  const range = useMemo(() => periodRange(period), [period]);
  const phone = width < 720;
  const desktop = width >= 1100;

  const summaryQuery = useQuery({
    queryKey: ['dashboard', period, range.from.slice(0, 10), branch?.id],
    queryFn: () =>
      api<Summary>(
        `/reports/summary?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}&branchId=${branch!.id}`,
      ),
    enabled:
      Boolean(branch?.id) &&
      ((currentUser?.modules.includes('dashboard') || currentUser?.modules.includes('reports')) ?? false),
  });

  const chartRange = useMemo(() => periodRange('7d'), []);
  const trendQuery = useQuery({
    queryKey: ['dashboard-trend', chartRange.from.slice(0, 10), branch?.id],
    queryFn: () =>
      api<WorkspaceTrend>(
        `/reports/workspace?from=${encodeURIComponent(chartRange.from)}&to=${encodeURIComponent(
          chartRange.to,
        )}&branchId=${branch!.id}`,
      ),
    enabled:
      Boolean(branch?.id) &&
      ((currentUser?.modules.includes('dashboard') || currentUser?.modules.includes('reports')) ?? false),
  });

  const canViewDashboard =
    currentUser?.modules.includes('dashboard') || currentUser?.modules.includes('reports');

  if (!canViewDashboard) {
    return (
      <Screen>
        <Header title="Dashboard" subtitle={branch?.name} />
        <View className="p-5">
          <Text className="rounded-2xl bg-white p-5 text-slate-600">
            Dashboard reporting is not included in this plan. POS and product functions remain
            available.
          </Text>
        </View>
      </Screen>
    );
  }

  if (summaryQuery.isLoading) {
    return (
      <Screen>
        <Header title="Dashboard" subtitle={branch?.name} />
        <LoadingState label="Loading today’s activity…" />
      </Screen>
    );
  }

  if (summaryQuery.isError) {
    return (
      <Screen>
        <Header title="Dashboard" subtitle={branch?.name} />
        <ErrorState message={summaryQuery.error.message} retry={() => void summaryQuery.refetch()} />
      </Screen>
    );
  }

  const data = summaryQuery.data!;
  const lowStockCount = data.lowStock.length;
  const paymentCount = data.salesByPaymentMethod.length;
  const metricWidth = phone ? '48%' : desktop ? '18.5%' : '31%';
  const panelWidth = phone ? '100%' : '48.8%';

  return (
    <Screen>
      <Header title="Dashboard" subtitle={branch?.name} />
      <ScrollView
        refreshControl={
          <RefreshControl
            tintColor="#1A593B"
            colors={['#1A593B']}
            refreshing={summaryQuery.isRefetching}
            onRefresh={() => {
              void summaryQuery.refetch();
              void trendQuery.refetch();
            }}
          />
        }
        contentContainerClassName="p-5 pb-12"
        contentContainerStyle={{ maxWidth: 1280, width: '100%', alignSelf: 'center' }}
      >
        <View className="mb-5 flex-row flex-wrap items-end justify-between gap-3">
          <View className="min-w-[220px] flex-1">
            <Text className="text-2xl font-semibold text-slate-900">
              Welcome back, {firstName(currentUser?.displayName)}
            </Text>
            <Text className="mt-1 text-sm text-slate-500">
              Here&apos;s what&apos;s happening with your store {period === 'today' ? 'today' : 'this week'}.
            </Text>
          </View>
          <View className="flex-row flex-wrap items-center gap-2">
            {PERIODS.map((item) => {
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
                  <Text className={`text-[13px] font-medium ${selected ? 'text-white' : 'text-slate-600'}`}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/reports/overview')}
              className="min-h-10 flex-row items-center rounded-xl bg-slate-900 px-3.5"
            >
              <Text className="text-[13px] font-medium text-white">View reports</Text>
              <Feather name="arrow-right" size={14} color="#FFFFFF" style={{ marginLeft: 6 }} />
            </Pressable>
          </View>
        </View>

        <View className="mb-5 flex-row flex-wrap gap-3">
          <MetricCard
            label="Net sales"
            value={formatMoney(data.salesTotal)}
            note={range.label}
            icon="activity"
            tone={METRIC_TONES[0]}
            width={metricWidth}
          />
          <MetricCard
            label="Transactions"
            value={String(data.transactions)}
            note={`${formatMoney(data.averageTransaction)} avg`}
            icon="shopping-bag"
            tone={METRIC_TONES[1]}
            width={metricWidth}
          />
          <MetricCard
            label="Average sale"
            value={formatMoney(data.averageTransaction)}
            note={`${data.transactions} checkouts`}
            icon="credit-card"
            tone={METRIC_TONES[2]}
            width={metricWidth}
          />
          <MetricCard
            label="Gross profit"
            value={formatMoney(data.grossProfit)}
            note="After cost of goods"
            icon="trending-up"
            tone={METRIC_TONES[3]}
            width={metricWidth}
          />
          <MetricCard
            label="Low stock"
            value={String(lowStockCount)}
            note={lowStockCount ? 'Needs attention' : 'All clear'}
            icon="alert-circle"
            tone={METRIC_TONES[4]}
            width={metricWidth}
          />
        </View>

        <View className="mb-4 flex-row flex-wrap gap-4">
          <View
            className="rounded-2xl border border-slate-100 bg-white p-5"
            style={{ width: phone ? '100%' : '63%', flexGrow: 1 }}
          >
            <View className="mb-3 flex-row items-center justify-between gap-3">
              <View>
                <Text className="text-[15px] font-semibold text-slate-900">Summary</Text>
                <Text className="mt-0.5 text-xs text-slate-500">Sales trend — last 7 days</Text>
              </View>
              <View className="flex-row items-center gap-3">
                <View className="flex-row items-center gap-1.5">
                  <View className="h-2 w-2 rounded-full bg-brand-700" />
                  <Text className="text-xs text-slate-500">Sales</Text>
                </View>
              </View>
            </View>
            {trendQuery.isLoading ? (
              <LoadingState label="Loading trend…" />
            ) : (
              <SummaryChart trend={trendQuery.data?.sales.trend ?? []} />
            )}
          </View>

          <View
            className="rounded-2xl border border-slate-100 bg-white p-5"
            style={{ width: phone ? '100%' : '34%', minWidth: phone ? undefined : 280, flexGrow: 1 }}
          >
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="text-[15px] font-semibold text-slate-900">Most selling products</Text>
              <Pressable onPress={() => router.push('/reports/overview')}>
                <Feather name="more-horizontal" size={18} color="#94A3B8" />
              </Pressable>
            </View>
            {data.bestSellingProducts.length ? (
              <View className="gap-3">
                {data.bestSellingProducts.slice(0, 6).map((product, index) => (
                  <View key={`${product.name}-${index}`} className="flex-row items-center gap-3">
                    <View className="h-10 w-10 items-center justify-center rounded-xl bg-brand-50">
                      <Text className="text-sm font-semibold text-brand-800">{index + 1}</Text>
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-medium text-slate-900" numberOfLines={1}>
                        {product.name}
                      </Text>
                      <Text className="mt-0.5 text-xs text-slate-500" numberOfLines={1}>
                        {product.total ? formatMoney(product.total) : `${product.quantity} sold`}
                      </Text>
                    </View>
                    <View className="rounded-full bg-slate-100 px-2.5 py-1">
                      <Text className="text-[11px] font-semibold text-slate-700">
                        {product.quantity} {product.unit || 'sold'}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <Text className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                No product sales for this period.
              </Text>
            )}
          </View>
        </View>

        <View className="flex-row flex-wrap gap-4">
          <View className="rounded-2xl border border-slate-100 bg-white p-5" style={{ width: panelWidth, flexGrow: 1 }}>
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="text-[15px] font-semibold text-slate-900">Stock alerts</Text>
              <Pressable onPress={() => router.push('/(tabs)/inventory')}>
                <Text className="text-sm font-medium text-brand-700">View all</Text>
              </Pressable>
            </View>
            {data.lowStock.length ? (
              <View className="gap-2.5">
                {data.lowStock.slice(0, 5).map((item, index) => (
                  <View
                    key={`${item.name}-${item.branchName}-${index}`}
                    className="flex-row items-center justify-between rounded-xl bg-rose-50/70 px-3.5 py-3"
                  >
                    <View className="min-w-0 flex-1 pr-3">
                      <Text className="text-sm font-medium text-slate-900" numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text className="mt-0.5 text-xs text-slate-500" numberOfLines={1}>
                        {item.branchName}
                      </Text>
                    </View>
                    <View className="rounded-full bg-white px-2.5 py-1">
                      <Text className="text-[11px] font-semibold text-rose-700">
                        {item.quantity} {item.unit || 'left'}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <Text className="rounded-xl bg-brand-50 p-4 text-sm text-brand-800">
                All tracked products are above their alert levels.
              </Text>
            )}
          </View>

          <View className="rounded-2xl border border-slate-100 bg-white p-5" style={{ width: panelWidth, flexGrow: 1 }}>
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="text-[15px] font-semibold text-slate-900">Payment mix</Text>
              <Text className="text-xs text-slate-400">{paymentCount || 0} methods</Text>
            </View>
            {data.salesByPaymentMethod.length ? (
              <View className="gap-3">
                {data.salesByPaymentMethod.map((payment) => {
                  const total = data.salesByPaymentMethod.reduce(
                    (sum, item) => sum + Number(item.total),
                    0,
                  );
                  const pct = total > 0 ? Math.round((Number(payment.total) / total) * 100) : 0;
                  return (
                    <View key={payment.method} className="gap-1.5">
                      <View className="flex-row items-center justify-between">
                        <Text className="text-sm font-medium capitalize text-slate-800">
                          {payment.method}
                        </Text>
                        <Text className="text-sm font-semibold text-slate-900">
                          {formatMoney(payment.total)}
                        </Text>
                      </View>
                      <View className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <View
                          className="h-1.5 rounded-full bg-brand-600"
                          style={{ width: `${Math.max(pct, 4)}%` }}
                        />
                      </View>
                      <Text className="text-[11px] text-slate-400">{pct}% of payments</Text>
                    </View>
                  );
                })}
              </View>
            ) : (
              <Text className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                No payments recorded for this period.
              </Text>
            )}
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
