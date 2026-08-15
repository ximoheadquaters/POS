import Feather from '@expo/vector-icons/Feather';
import { Platform, Pressable, Switch, Text, View } from 'react-native';
import type { ReceiptPaperSize, ReceiptPrinterSettings } from '@/hardware/types';

const PAPER_OPTIONS: ReadonlyArray<{
  value: ReceiptPaperSize;
  label: string;
  detail: string;
}> = [
  { value: '58mm', label: '58 mm', detail: 'Small thermal roll' },
  { value: '80mm', label: '80 mm', detail: 'Standard receipt' },
  { value: 'full_page', label: 'Full page', detail: 'A4 or Letter' },
];

function ToggleRow({
  label,
  detail,
  value,
  onChange,
}: {
  label: string;
  detail: string;
  value: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <View className="min-h-16 flex-row items-center border-t border-slate-100 py-3">
      <View className="flex-1 pr-4">
        <Text className="text-sm font-semibold text-slate-900">{label}</Text>
        <Text className="mt-0.5 text-xs leading-4 text-slate-500">{detail}</Text>
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ false: '#CBD5E1', true: '#A7D7C5' }}
        thumbColor={value ? '#1A593B' : '#FFFFFF'}
      />
    </View>
  );
}

export function ReceiptPrinterSetup({
  value,
  onChange,
  onSave,
  onTest,
  saving,
  testing,
  saveLabel,
}: {
  value: ReceiptPrinterSettings;
  onChange(value: ReceiptPrinterSettings): void;
  onSave(): void;
  onTest(): void;
  saving: boolean;
  testing: boolean;
  saveLabel?: string;
}) {
  const update = <K extends keyof ReceiptPrinterSettings>(
    key: K,
    nextValue: ReceiptPrinterSettings[K],
  ) => onChange({ ...value, [key]: nextValue });
  const resolvedSaveLabel = saveLabel ?? (saving ? 'Saving…' : 'Save printer settings');
  const saveDisabled = saving;

  return (
    <View className="mt-4 gap-0">
      <View className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <View className="flex-row items-start bg-slate-50 px-4 py-4">
          <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-brand-50">
            <Feather name="printer" size={19} color="#1A593B" />
          </View>
          <View className="flex-1">
            <Text className="text-sm font-bold text-slate-900">Receipt printer setup</Text>
            <Text className="mt-1 text-xs leading-4 text-slate-500">
              Saved on this device for this branch and available while offline.
            </Text>
          </View>
        </View>

        <View className="px-4 py-4">
          <Text className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Printing method
          </Text>
          <View className="mt-2 flex-row items-center rounded-xl border border-brand-200 bg-brand-50 p-3">
            <Feather name="monitor" size={17} color="#1A593B" />
            <View className="ml-3 flex-1">
              <Text className="text-sm font-semibold text-brand-900">System print dialog</Text>
              <Text className="mt-0.5 text-xs leading-4 text-slate-600">
                Select any printer installed on this computer or device.
              </Text>
            </View>
            <Feather name="check-circle" size={18} color="#1A593B" />
          </View>

          <Text className="mt-5 text-xs font-bold uppercase tracking-wider text-slate-500">
            Receipt paper
          </Text>
          <View className="mt-2 flex-row flex-wrap gap-2">
            {PAPER_OPTIONS.map((option) => {
              const selected = value.paperSize === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => update('paperSize', option.value)}
                  className={`min-h-16 min-w-28 flex-1 rounded-xl border px-3 py-3 ${
                    selected ? 'border-brand-700 bg-brand-50' : 'border-slate-200 bg-white'
                  }`}
                >
                  <Text
                    className={`text-sm font-bold ${selected ? 'text-brand-900' : 'text-slate-800'}`}
                  >
                    {option.label}
                  </Text>
                  <Text className="mt-0.5 text-xs text-slate-500">{option.detail}</Text>
                </Pressable>
              );
            })}
          </View>

          <View className="mt-5">
            <Text className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500">
              Receipt contents
            </Text>
            <ToggleRow
              label="Branch address"
              detail="Show the selling branch address below the business name."
              value={value.includeBranchAddress}
              onChange={(next) => update('includeBranchAddress', next)}
            />
            <ToggleRow
              label="Cashier name"
              detail="Identify the employee who completed the sale."
              value={value.includeCashierName}
              onChange={(next) => update('includeCashierName', next)}
            />
            <ToggleRow
              label="Tax breakdown"
              detail="Show the tax total separately when the sale has tax."
              value={value.includeTaxBreakdown}
              onChange={(next) => update('includeTaxBreakdown', next)}
            />
            <ToggleRow
              label="Receipt footer"
              detail="Include the thank-you and Ximo POS footer."
              value={value.includeFooter}
              onChange={(next) => update('includeFooter', next)}
            />
            <ToggleRow
              label="Print automatically after payment"
              detail="Open the system print dialog when the completed-sale screen loads."
              value={value.autoPrintAfterSale}
              onChange={(next) => update('autoPrintAfterSale', next)}
            />
          </View>
        </View>
      </View>

      <View className="mt-3 rounded-2xl border border-slate-200 bg-white px-4 py-4">
        <View className="flex-row flex-wrap gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: testing }}
            disabled={testing}
            onPress={onTest}
            style={Platform.OS === 'web' ? ({ cursor: testing ? 'default' : 'pointer' } as object) : undefined}
            className={`min-h-11 min-w-[160px] flex-1 flex-row items-center justify-center rounded-xl border border-brand-200 bg-brand-50 px-4 ${testing ? 'opacity-50' : ''}`}
          >
            <Feather name="printer" size={16} color="#1A593B" />
            <Text className="ml-2 text-sm font-bold text-brand-800">
              {testing ? 'Opening print dialog…' : 'Print test receipt'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save printer settings"
            accessibilityState={{ disabled: saveDisabled }}
            disabled={saveDisabled}
            onPress={() => {
              if (saveDisabled) return;
              onSave();
            }}
            style={
              Platform.OS === 'web'
                ? ({ cursor: saveDisabled ? 'default' : 'pointer' } as object)
                : undefined
            }
            className={`min-h-11 min-w-[160px] flex-1 flex-row items-center justify-center rounded-xl bg-brand-700 px-4 active:bg-brand-800 ${
              saveDisabled ? 'opacity-50' : ''
            }`}
          >
            <Feather name="save" size={16} color="#FFFFFF" />
            <Text className="ml-2 text-sm font-bold text-white">{resolvedSaveLabel}</Text>
          </Pressable>
        </View>

        <Text className="mt-3 text-xs leading-4 text-slate-500">
          Ximo formats the receipt, but your browser still controls the physical printer, margins,
          copies, and final print confirmation.
        </Text>
      </View>
    </View>
  );
}
