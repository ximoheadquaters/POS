import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

function toInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function parseInput(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function formatDay(value: string): string {
  if (!value) return '—';
  return parseInput(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function MonthGrid({
  month,
  from,
  to,
  selectingEnd,
  onSelectDay,
}: {
  month: Date;
  from: string;
  to: string;
  selectingEnd: boolean;
  onSelectDay: (day: string) => void;
}) {
  const weeks = useMemo(() => {
    const first = startOfMonth(month);
    const startPad = first.getDay();
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const days: Array<{ key: string; day?: string; label?: string }> = [];
    for (let i = 0; i < startPad; i += 1) {
      days.push({ key: `pad-${i}` });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(month.getFullYear(), month.getMonth(), day);
      const value = toInput(date);
      days.push({ key: value, day: value, label: String(day) });
    }
    while (days.length % 7 !== 0) {
      days.push({ key: `trail-${days.length}` });
    }
    const rows: Array<typeof days> = [];
    for (let i = 0; i < days.length; i += 7) {
      rows.push(days.slice(i, i + 7));
    }
    return rows;
  }, [month]);

  const today = toInput(new Date());
  const rangeFrom = from;
  const rangeTo = to || from;

  return (
    <View>
      <View className="mb-2 flex-row">
        {WEEKDAYS.map((day) => (
          <View key={day} className="flex-1 items-center py-1">
            <Text className="text-[11px] font-medium text-slate-400">{day}</Text>
          </View>
        ))}
      </View>
      <View className="gap-1">
        {weeks.map((week, weekIndex) => (
          <View key={`week-${weekIndex}`} className="flex-row">
            {week.map((cell) => {
              if (!cell.day || !cell.label) {
                return <View key={cell.key} className="h-11 flex-1" />;
              }

              const isStart = cell.day === rangeFrom;
              const isEnd = Boolean(rangeTo) && cell.day === rangeTo;
              const inMiddle =
                Boolean(rangeFrom && rangeTo) &&
                cell.day > rangeFrom &&
                cell.day < rangeTo;
              const inSelected =
                Boolean(rangeFrom && rangeTo) &&
                cell.day >= rangeFrom &&
                cell.day <= rangeTo;
              const isToday = cell.day === today;
              const isPendingStart = selectingEnd && isStart && rangeFrom === rangeTo;

              return (
                <Pressable
                  key={cell.key}
                  accessibilityRole="button"
                  accessibilityLabel={`Select ${cell.day}`}
                  onPress={() => onSelectDay(cell.day!)}
                  className="h-11 flex-1 items-center justify-center"
                  style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
                >
                  <View
                    className={`h-10 w-full items-center justify-center ${
                      inMiddle || (inSelected && !isStart && !isEnd)
                        ? 'bg-brand-100'
                        : isStart && rangeFrom !== rangeTo
                          ? 'rounded-l-full bg-brand-100'
                          : isEnd && rangeFrom !== rangeTo
                            ? 'rounded-r-full bg-brand-100'
                            : ''
                    }`}
                  >
                    <View
                      className={`h-9 w-9 items-center justify-center rounded-full ${
                        isStart || isEnd || isPendingStart
                          ? 'bg-brand-700'
                          : isToday
                            ? 'border border-brand-300'
                            : ''
                      }`}
                    >
                      <Text
                        className={`text-sm font-semibold ${
                          isStart || isEnd || isPendingStart
                            ? 'text-white'
                            : inSelected
                              ? 'text-brand-900'
                              : isToday
                                ? 'text-brand-700'
                                : 'text-slate-800'
                        }`}
                      >
                        {cell.label}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

export function DateRangeCalendar({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (next: { from: string; to: string }) => void;
}) {
  const [visibleMonth, setVisibleMonth] = useState(() =>
    startOfMonth(from ? parseInput(from) : new Date()),
  );
  /** false = next tap sets start; true = next tap sets end */
  const [selectingEnd, setSelectingEnd] = useState(false);
  const [anchorFrom, setAnchorFrom] = useState(from);
  const [anchorTo, setAnchorTo] = useState(to);

  const handleSelectDay = (day: string) => {
    if (!selectingEnd) {
      setAnchorFrom(day);
      setAnchorTo(day);
      setSelectingEnd(true);
      onChange({ from: day, to: day });
      return;
    }

    let nextFrom = anchorFrom || day;
    let nextTo = day;
    if (day < nextFrom) {
      nextTo = nextFrom;
      nextFrom = day;
    }
    setAnchorFrom(nextFrom);
    setAnchorTo(nextTo);
    setSelectingEnd(false);
    onChange({ from: nextFrom, to: nextTo });
  };

  return (
    <View className="gap-4">
      <View className="flex-row gap-2">
        <View
          className={`min-h-14 flex-1 rounded-2xl border px-3 py-2 ${
            !selectingEnd ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-slate-50'
          }`}
        >
          <Text className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            1 · Start
          </Text>
          <Text className="mt-0.5 text-sm font-semibold text-slate-900">{formatDay(anchorFrom)}</Text>
        </View>
        <View
          className={`min-h-14 flex-1 rounded-2xl border px-3 py-2 ${
            selectingEnd ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-slate-50'
          }`}
        >
          <Text className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            2 · End
          </Text>
          <Text className="mt-0.5 text-sm font-semibold text-slate-900">
            {selectingEnd && anchorFrom === anchorTo ? 'Tap end date' : formatDay(anchorTo)}
          </Text>
        </View>
      </View>

      <View className="flex-row items-center justify-between rounded-2xl bg-slate-50 px-3 py-2.5">
        <Pressable
          accessibilityRole="button"
          onPress={() => setVisibleMonth((m) => addMonths(m, -1))}
          className="h-9 w-9 items-center justify-center rounded-xl bg-white"
        >
          <Feather name="chevron-left" size={18} color="#4C4239" />
        </Pressable>
        <Text className="text-sm font-semibold text-slate-900">{monthLabel(visibleMonth)}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => setVisibleMonth((m) => addMonths(m, 1))}
          className="h-9 w-9 items-center justify-center rounded-xl bg-white"
        >
          <Feather name="chevron-right" size={18} color="#4C4239" />
        </Pressable>
      </View>

      <Text className="text-center text-xs text-slate-500">
        {selectingEnd
          ? 'Tap the end date. Days in between will highlight.'
          : 'Tap the start date, then tap the end date.'}
      </Text>

      <MonthGrid
        month={visibleMonth}
        from={anchorFrom}
        to={anchorTo}
        selectingEnd={selectingEnd}
        onSelectDay={handleSelectDay}
      />
    </View>
  );
}
