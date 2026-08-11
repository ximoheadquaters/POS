import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { DateRangeCalendar } from '@/components/date-range-calendar';
import { Button, ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { useBranchStore } from '@/store/branch';
import { useSession } from '@/providers/session';

interface ShiftSummary {
  shiftCount: number;
  openShiftCount: number;
  cashSales: string;
  cashRefunds: string;
  cashIn: string;
  cashOut: string;
  expectedCash: string;
  actualCash: string;
  variance: string;
}

interface ShiftRow {
  id: string;
  status: 'open' | 'closed';
  openedAt: string;
  closedAt?: string;
  branchName: string;
  registerName: string;
  cashierName: string;
  cashSales: string;
  cashRefunds: string;
  expectedCash?: string;
  actualCash?: string;
  variance?: string;
  transactions: number;
}

interface ShiftReportResponse {
  summary: ShiftSummary;
  shifts: ShiftRow[];
  total: number;
}

type ShiftPeriod = 'today' | '7d' | '30d' | 'all' | 'custom';

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
  return `${fmt(from)} – ${fmt(toExclusive)}`;
}

const PERIOD_PRESETS: Array<{
  key: ShiftPeriod;
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
    key: '7d',
    label: '7 days',
    getRange: () => {
      const to = new Date();
      const from = new Date(to);
      from.setDate(from.getDate() - 6);
      return { from: localDateInput(from), to: localDateInput(to) };
    },
  },
  {
    key: '30d',
    label: '30 days',
    getRange: () => {
      const to = new Date();
      const from = new Date(to);
      from.setDate(from.getDate() - 29);
      return { from: localDateInput(from), to: localDateInput(to) };
    },
  },
  {
    key: 'all',
    label: 'All time',
    getRange: () => ({ from: '2000-01-01', to: localDateInput(new Date()) }),
  },
];

function ShiftReportsContent() {
  const { width } = useWindowDimensions();
  const phone = width < 640;
  const { currentUser } = useSession();
  const branch = useBranchStore((state) => state.activeBranch);
  const defaultCustomRange = useMemo(() => {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 29);
    return { from: localDateInput(from), to: localDateInput(to) };
  }, []);
  const [period, setPeriod] = useState<ShiftPeriod>('30d');
  const [customRange, setCustomRange] = useState(defaultCustomRange);
  const [dateRangeVisible, setDateRangeVisible] = useState(false);
  const [calendarSession, setCalendarSession] = useState(0);
  const [draftFrom, setDraftFrom] = useState(defaultCustomRange.from);
  const [draftTo, setDraftTo] = useState(defaultCustomRange.to);
  const [dateRangeError, setDateRangeError] = useState('');
  const isModuleEnabled = currentUser?.modules.includes('registers');

  const range = useMemo(() => {
    if (period === 'custom') {
      const from = dateAtLocalMidnight(customRange.from);
      const to = dateAtLocalMidnight(customRange.to);
      to.setDate(to.getDate() + 1);
      return { from: from.toISOString(), to: to.toISOString() };
    }
    const preset = PERIOD_PRESETS.find((p) => p.key === period);
    const r = preset ? preset.getRange() : PERIOD_PRESETS[2]!.getRange();
    const from = dateAtLocalMidnight(r.from);
    const to = dateAtLocalMidnight(r.to);
    to.setDate(to.getDate() + 1);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [customRange.from, customRange.to, period]);

  const rangeLabel = useMemo(() => readableDateRange(range.from, range.to), [range.from, range.to]);

  const query = useQuery({
    queryKey: ['shift-reports', branch?.id, range.from, range.to],
    queryFn: () =>
      api<ShiftReportResponse>(
        `/reports/shifts?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(
          range.to,
        )}&page=1&pageSize=100&branchId=${branch!.id}`,
      ),
    enabled: Boolean(isModuleEnabled && branch?.id),
  });

  if (!isModuleEnabled) {
    return (
      <Screen>
        <Header title="Shift History" showBack backLabel="Back" />
        <View className="flex-1 items-center justify-center p-8">
          <View className="mb-4 h-14 w-14 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50">
            <Feather name="lock" size={26} color="#B45309" />
          </View>
          <Text className="text-xl font-bold text-slate-900">Module Access Disabled</Text>
          <Text className="mt-2 max-w-xs text-center text-xs leading-relaxed text-slate-500">
            The Registers & Shifts module is disabled for your organization. Contact your administrator
            or store owner to enable register management.
          </Text>
          <View className="mt-6 w-full max-w-xs">
            <Button title="Return to POS" onPress={() => router.push('/(tabs)/pos')} />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Header
        title="Cash and shift reports"
        subtitle={`${rangeLabel} · ${branch?.name ?? 'All accessible branches'}`}
        showBack
        backLabel="Reports"
        fallbackHref="/reports"
      />
      <View className="border-b border-slate-200 bg-white p-4">
        <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Date range
        </Text>
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
          className="min-h-12 flex-row items-center rounded-2xl border border-brand-200 bg-brand-50 px-3.5 active:bg-brand-100"
        >
          <View className="mr-3 h-9 w-9 items-center justify-center rounded-xl bg-brand-700">
            <Feather name="calendar" size={16} color="#FFFFFF" />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-semibold text-slate-950" numberOfLines={1}>
              {rangeLabel}
            </Text>
            <Text className="mt-0.5 text-[11px] text-brand-800">Tap to pick dates on the calendar</Text>
          </View>
          <Feather name="chevron-right" size={18} color="#1A593B" />
        </Pressable>
        <View className="mt-3 flex-row flex-wrap gap-1.5">
          {PERIOD_PRESETS.map((item) => {
            const selected = item.key === period;
            return (
              <Pressable
                key={item.key}
                onPress={() => setPeriod(item.key)}
                className={`min-h-9 items-center justify-center rounded-full px-3.5 ${
                  selected ? 'bg-brand-700' : 'bg-slate-100 active:bg-slate-200'
                }`}
              >
                <Text className={`text-xs font-medium ${selected ? 'text-white' : 'text-slate-700'}`}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {query.data ? (
          <View className="mt-4 flex-row flex-wrap gap-2">
            {[
              ['Cash sales', query.data.summary.cashSales],
              ['Cash refunds', query.data.summary.cashRefunds],
              ['Cash in', query.data.summary.cashIn],
              ['Cash out', query.data.summary.cashOut],
              ['Counted cash', query.data.summary.actualCash],
              ['Variance', query.data.summary.variance],
            ].map(([label, value]) => (
              <View key={label} className="w-[32%] min-w-28 rounded-xl bg-slate-50 p-3">
                <Text className="text-xs text-slate-500">{label}</Text>
                <Text className="mt-1 font-semibold text-slate-900">{formatMoney(value)}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
      {query.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState message={query.error.message} retry={() => void query.refetch()} />
      ) : (
        <FlatList
          data={query.data?.shifts ?? []}
          keyExtractor={(item) => item.id}
          contentContainerClassName="gap-2 p-4 pb-12"
          renderItem={({ item }) => (
            <Pressable
              onPress={() =>
                router.push({ pathname: '/shift-report/[id]', params: { id: item.id } })
              }
              className="flex-row items-center rounded-2xl border border-slate-100 bg-white p-4"
            >
              <View
                className={`mr-3 h-11 w-11 items-center justify-center rounded-xl ${
                  item.status === 'open' ? 'bg-amber-100' : 'bg-brand-50'
                }`}
              >
                <Feather
                  name="monitor"
                  size={18}
                  color={item.status === 'open' ? '#92400E' : '#1A593B'}
                />
              </View>
              <View className="flex-1">
                <Text className="font-medium text-slate-900">
                  {item.registerName} · {item.cashierName}
                </Text>
                <Text className="mt-1 text-xs text-slate-500">
                  {new Date(item.openedAt).toLocaleString()} · {item.transactions} transactions
                </Text>
                <Text className="mt-1 text-xs capitalize text-brand-700">{item.status}</Text>
              </View>
              <View className="items-end">
                <Text className="font-semibold text-slate-900">{formatMoney(item.cashSales)}</Text>
                {item.status === 'closed' ? (
                  <Text
                    className={`mt-1 text-xs ${
                      Number(item.variance) === 0 ? 'text-brand-700' : 'text-red-600'
                    }`}
                  >
                    Variance {formatMoney(item.variance ?? '0')}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          )}
        />
      )}

      <Modal
        visible={dateRangeVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDateRangeVisible(false)}
      >
        <View className={`flex-1 items-center justify-center bg-black/40 ${phone ? 'p-3' : 'p-6'}`}>
          <View
            className="max-h-[92%] w-full overflow-hidden rounded-3xl bg-white"
            style={{ maxWidth: width >= 760 ? 720 : 440 }}
          >
            <ScrollView contentContainerClassName="gap-4 p-5" keyboardShouldPersistTaps="handled">
              <View className="flex-row items-start justify-between gap-3">
                <View className="min-w-0 flex-1">
                  <Text className="text-lg font-semibold text-slate-950">Select date range</Text>
                  <Text className="mt-1 text-xs leading-4 text-slate-500">
                    Tap a start date, then an end date on the calendar.
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
                          setDateRangeVisible(false);
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

export default function ShiftReportsScreen() {
  return (
    <AppSidebarProvider>
      <ShiftReportsContent />
    </AppSidebarProvider>
  );
}
