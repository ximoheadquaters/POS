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
import { Redirect, router } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { api } from '@/lib/api';
import { formatMoney, todayRange } from '@/lib/format';
import { useSession } from '@/providers/session';
import { useBranchStore } from '@/store/branch';
import { useConnectivityStore } from '@/store/connectivity';
import { ExpandableSection, ErrorState, Header, LoadingState, OfflineState, Screen } from '@/components/ui';

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

const METRIC_TONES = {
  standard: { bg: 'bg-white', accent: '#637169' },
  positive: { bg: 'bg-white', accent: '#1A593B' },
  warning: { bg: 'bg-white', accent: '#926315' },
} as const;

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
  compact = false,
}: {
  label: string;
  value: string;
  note?: string;
  icon: ComponentProps<typeof Feather>['name'];
  tone: (typeof METRIC_TONES)[keyof typeof METRIC_TONES];
  width: number | `${number}%`;
  compact?: boolean;
}) {
  return (
    <View
      className={`rounded-2xl border border-slate-200/70 ${compact ? 'p-3' : 'p-4'} ${tone.bg}`}
      style={{ width, minWidth: compact ? 132 : 140, flexGrow: 1 }}
    >
      <View className={`${compact ? 'mb-3' : 'mb-4'} flex-row items-center justify-between`}>
        <Text className="text-[12px] font-semibold text-slate-500">{label}</Text>
        <View className={`${compact ? 'h-7 w-7' : 'h-8 w-8'} items-center justify-center rounded-lg bg-slate-50`}>
          <Feather name={icon} size={15} color={tone.accent} />
        </View>
      </View>
      <Text
        className={`${compact ? 'text-[22px]' : 'text-[26px]'} font-semibold tracking-tight text-slate-900`}
        numberOfLines={1}
      >
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
      : [
          0,
          Math.round((series.length - 1) / 3),
          Math.round(((series.length - 1) * 2) / 3),
          series.length - 1,
        ];

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
        <path d={areaPath} fill="#EDF4EF" />
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
            <circle
              cx={active.x}
              cy={active.y}
              r={5}
              fill="#1A593B"
              stroke="#FFFFFF"
              strokeWidth="2"
            />
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
  const connectivityInitialized = useConnectivityStore((state) => state.initialized);
  const isOnline = useConnectivityStore((state) => state.isOnline);
  const [period, setPeriod] = useState<PeriodKey>('today');
  const range = useMemo(() => periodRange(period), [period]);
  const phone = width < 720;
  const desktop = width >= 1100;

  const canViewDashboard =
    Boolean(
      currentUser?.modules.includes('dashboard') || currentUser?.modules.includes('reports'),
    ) &&
    (currentUser?.role === 'owner' ||
      currentUser?.role === 'administrator' ||
      currentUser?.role === 'manager' ||
      Boolean(currentUser?.permissions.includes('reports:read')));
  const canRequestReports =
    Boolean(branch?.id) && canViewDashboard && (!connectivityInitialized || isOnline);

  const summaryQuery = useQuery({
    queryKey: ['dashboard', period, range.from.slice(0, 10), branch?.id],
    queryFn: () =>
      api<Summary>(
        `/reports/summary?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}&branchId=${branch!.id}`,
      ),
    enabled: canRequestReports,
  });

  // The trend endpoint is noticeably heavier than the summary. Empty workspaces do not
  // display a chart, so avoid fetching it until there is activity to show.
  const hasSalesActivity =
    Number(summaryQuery.data?.transactions ?? 0) > 0 ||
    Number(summaryQuery.data?.salesTotal ?? 0) > 0;

  const chartRange = useMemo(() => periodRange('7d'), []);
  const trendQuery = useQuery({
    queryKey: ['dashboard-trend', chartRange.from.slice(0, 10), branch?.id],
    queryFn: () =>
      api<WorkspaceTrend>(
        `/reports/workspace?from=${encodeURIComponent(chartRange.from)}&to=${encodeURIComponent(
          chartRange.to,
        )}&branchId=${branch!.id}`,
      ),
    enabled: canRequestReports && hasSalesActivity,
  });

  if (!canViewDashboard) {
    return <Redirect href="/(tabs)/pos" />;
  }

  if (connectivityInitialized && !isOnline && !summaryQuery.data) {
    return (
      <Screen>
        <Header title="Dashboard" subtitle={branch?.name} />
        <OfflineState
          title="Dashboard unavailable"
          message="The POS server is unavailable. Reconnect to load today’s activity."
          retry={() => void summaryQuery.refetch()}
        />
      </Screen>
    );
  }

  if (summaryQuery.isError) {
    return (
      <Screen>
        <Header title="Dashboard" subtitle={branch?.name} />
        <ErrorState
          message={summaryQuery.error.message}
          retry={() => void summaryQuery.refetch()}
        />
      </Screen>
    );
  }

  if (summaryQuery.isLoading || !summaryQuery.data) {
    return (
      <Screen>
        <Header title="Dashboard" subtitle={branch?.name} />
        <LoadingState label="Loading Today’s Activity…" />
      </Screen>
    );
  }

  const data = summaryQuery.data;
  // Reports can be returned while a workspace is still reconciling. Treat omitted
  // collection fields as empty rather than allowing one incomplete field to take down
  // the whole dashboard.
  const lowStock = Array.isArray(data.lowStock) ? data.lowStock : [];
  const paymentMethods = Array.isArray(data.salesByPaymentMethod)
    ? data.salesByPaymentMethod
    : [];
  const bestSellingProducts = Array.isArray(data.bestSellingProducts)
    ? data.bestSellingProducts
    : [];
  const lowStockCount = lowStock.length;
  const paymentTotal = paymentMethods.reduce((sum, item) => sum + Number(item.total), 0);
  const metricWidth = phone ? '48%' : desktop ? '23.5%' : '48%';
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
        contentContainerClassName={phone ? 'p-3 pb-6' : 'p-5 pb-12'}
        contentContainerStyle={{ maxWidth: 1280, width: '100%', alignSelf: 'center' }}
      >
        <View className={`${phone ? 'mb-4 gap-3' : 'mb-6 gap-4'} flex-row flex-wrap items-center justify-between`}>
          <View className={phone ? 'basis-full' : 'min-w-[220px] flex-1'}>
            <Text className={`${phone ? 'text-[22px]' : 'text-[26px]'} font-semibold tracking-tight text-slate-900`}>
              Welcome back, {firstName(currentUser?.displayName)}
            </Text>
            <Text className={`${phone ? 'text-[13px]' : 'text-sm'} mt-1 text-slate-500`}>
              A quick view of {branch?.name ?? 'your store'}{' '}
              {period === 'today' ? 'today' : 'this week'}.
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
                  className={`min-h-10 items-center justify-center rounded-xl ${phone ? 'px-3' : 'px-3.5'} ${
                    selected ? 'bg-brand-700' : 'border border-slate-200 bg-white'
                  }`}
                >
                  <Text
                    className={`text-[13px] font-medium ${selected ? 'text-white' : 'text-slate-600'}`}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/reports/overview')}
              className={`min-h-10 flex-row items-center rounded-xl border border-slate-200 bg-white ${phone ? 'px-3' : 'px-3.5'}`}
            >
              <Text className="text-[13px] font-medium text-slate-700">Reports</Text>
              <Feather name="arrow-right" size={14} color="#637169" style={{ marginLeft: 6 }} />
            </Pressable>
          </View>
        </View>

        <View className={`${phone ? 'mb-4 gap-2' : 'mb-5 gap-3'} flex-row flex-wrap`}>
          <MetricCard
            label="Net Sales"
            value={formatMoney(data.salesTotal)}
            note={range.label}
            icon="activity"
            tone={METRIC_TONES.positive}
            width={metricWidth}
            compact={phone}
          />
          <MetricCard
            label="Transactions"
            value={String(data.transactions)}
            note={`${formatMoney(data.averageTransaction)} avg`}
            icon="shopping-bag"
            tone={METRIC_TONES.standard}
            width={metricWidth}
            compact={phone}
          />
          <MetricCard
            label="Average Sale"
            value={formatMoney(data.averageTransaction)}
            note={`${data.transactions} checkouts`}
            icon="credit-card"
            tone={METRIC_TONES.standard}
            width={metricWidth}
            compact={phone}
          />
          <MetricCard
            label="Low Stock"
            value={String(lowStockCount)}
            note={lowStockCount ? 'Needs attention' : 'All clear'}
            icon="alert-circle"
            tone={lowStockCount ? METRIC_TONES.warning : METRIC_TONES.standard}
            width={metricWidth}
            compact={phone}
          />
        </View>

        {!hasSalesActivity ? (
          <View className={`mb-4 flex-row flex-wrap items-center rounded-2xl border border-slate-200/70 bg-white ${phone ? 'gap-3 p-4' : 'gap-5 p-6'}`}>
            <View className="h-12 w-12 items-center justify-center rounded-xl bg-brand-50">
              <Feather name="shopping-cart" size={21} color="#1A593B" />
            </View>
            <View className={`${phone ? 'min-w-0' : 'min-w-[220px]'} flex-1`}>
              <Text className="text-lg font-semibold text-slate-900">
                Ready for your first sale
              </Text>
              <Text className="mt-1 text-sm leading-5 text-slate-500">
                Complete a checkout and sales activity will appear here.
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/(tabs)/pos')}
              className="min-h-11 flex-row items-center justify-center rounded-xl bg-brand-700 px-5 active:bg-brand-800"
            >
              <Text className="text-sm font-semibold text-white">Go to POS</Text>
              <Feather name="arrow-right" size={15} color="#FFFFFF" style={{ marginLeft: 7 }} />
            </Pressable>
          </View>
        ) : (
          <View className={`${phone ? 'mb-3 gap-3' : 'mb-4 gap-4'} flex-row flex-wrap`}>
            <View
              className={`rounded-2xl border border-slate-100 bg-white ${phone ? 'p-4' : 'p-5'}`}
              style={{ width: phone ? '100%' : '63%', flexGrow: 1 }}
            >
              <View className="mb-3 flex-row items-center justify-between gap-3">
                <View>
                  <Text className="text-[15px] font-semibold text-slate-900">Sales trend</Text>
                  <Text className="mt-0.5 text-xs text-slate-500">Last 7 days</Text>
                </View>
                <View className="flex-row items-center gap-3">
                  <View className="flex-row items-center gap-1.5">
                    <View className="h-2 w-2 rounded-full bg-brand-700" />
                    <Text className="text-xs text-slate-500">Sales</Text>
                  </View>
                </View>
              </View>
              {trendQuery.isLoading ? (
                <LoadingState label="Loading Trend…" />
              ) : trendQuery.isError ? (
                <ErrorState
                  message="Sales trend could not be loaded."
                  retry={() => void trendQuery.refetch()}
                />
              ) : (
                <SummaryChart trend={trendQuery.data?.sales?.trend ?? []} />
              )}
            </View>

            <View
              className={`rounded-2xl border border-slate-100 bg-white ${phone ? 'p-4' : 'p-5'}`}
              style={{
                width: phone ? '100%' : '34%',
                minWidth: phone ? undefined : 280,
                flexGrow: 1,
              }}
            >
              <View className="mb-4 flex-row items-center justify-between">
                <Text className="text-[15px] font-semibold text-slate-900">Top products</Text>
                <Pressable onPress={() => router.push('/reports/overview')}>
                  <Feather name="more-horizontal" size={18} color="#94A3B8" />
                </Pressable>
              </View>
              {bestSellingProducts.length ? (
                <View className="gap-3">
                  {bestSellingProducts.slice(0, 6).map((product, index) => (
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
        )}

        <View className={`${phone ? 'gap-3' : 'gap-4'} flex-row flex-wrap`}>
          <View
            className={`rounded-2xl border border-slate-100 bg-white ${phone ? 'p-4' : 'p-5'}`}
            style={{ width: panelWidth, flexGrow: 1, alignSelf: 'flex-start' }}
          >
            <View className="mb-4 flex-row items-center justify-between">
              <View>
                <Text className="text-[15px] font-semibold text-slate-900">Needs attention</Text>
                <Text className="mt-0.5 text-xs text-slate-500">Products running low</Text>
              </View>
              <Pressable onPress={() => router.push('/(tabs)/inventory')}>
                <Text className="text-sm font-medium text-brand-700">View All</Text>
              </Pressable>
            </View>
            {lowStock.length ? (
              <View className="gap-2.5">
                {lowStock.slice(0, 5).map((item, index) => {
                  const outOfStock = Number(item.quantity) <= 0;
                  return (
                    <View
                      key={`${item.name}-${item.branchName}-${index}`}
                      className={`flex-row items-center justify-between rounded-xl border border-slate-200 bg-white ${phone ? 'px-3 py-2.5' : 'px-3.5 py-3'}`}
                    >
                      <View className="min-w-0 flex-1 pr-3">
                        <Text className="text-sm font-medium text-slate-900" numberOfLines={1}>
                          {item.name}
                        </Text>
                        <Text className="mt-0.5 text-xs text-slate-500" numberOfLines={1}>
                          {item.branchName}
                        </Text>
                      </View>
                      <View
                        className={`rounded-full px-2.5 py-1 ${
                          outOfStock ? 'bg-rose-50' : 'bg-slate-100'
                        }`}
                      >
                        <Text
                          className={`text-[11px] font-semibold ${
                            outOfStock ? 'text-rose-700' : 'text-slate-700'
                          }`}
                        >
                          {item.quantity} {item.unit || 'left'}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : (
              <Text className="rounded-xl bg-brand-50 p-4 text-sm text-brand-800">
                All tracked products are above their alert levels.
              </Text>
            )}
          </View>

          {hasSalesActivity ? (
            <View
              className={`rounded-2xl border border-slate-100 bg-white ${phone ? 'p-4' : 'p-5'}`}
              style={{ width: panelWidth, flexGrow: 1, alignSelf: 'flex-start' }}
            >
              <ExpandableSection title="Sales details" summary="Gross profit and payment methods">
                <View className="mb-4 flex-row items-center justify-between">
                  <View>
                    <Text className="text-[15px] font-semibold text-slate-900">Gross profit</Text>
                    <Text className="mt-0.5 text-xs text-slate-500">
                      Profit and payment methods
                    </Text>
                  </View>
                  <Text className="text-sm font-semibold text-slate-900">
                    {formatMoney(data.grossProfit)}
                  </Text>
                </View>
                {paymentMethods.length ? (
                  <View className="gap-3">
                    {paymentMethods.map((payment) => {
                      const pct =
                        paymentTotal > 0
                          ? Math.round((Number(payment.total) / paymentTotal) * 100)
                          : 0;
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
                          <Text className="text-[11px] text-slate-400">{pct}% Of Payments</Text>
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <Text className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                    Payment details will appear after your first checkout.
                  </Text>
                )}
              </ExpandableSection>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}
