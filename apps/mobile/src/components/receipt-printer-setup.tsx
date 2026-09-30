import Feather from '@expo/vector-icons/Feather';
import { Platform, Pressable, Switch, Text, View } from 'react-native';
import { useState } from 'react';
import { getPairedBluetoothPrinters, type PairedPrinter } from '@/hardware/android-bluetooth-receipt-printer';
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

function ToggleCard({
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
    <View className="flex-1 min-w-[240px] flex-row items-center justify-between rounded-xl border border-slate-100 bg-slate-50/70 p-3.5">
      <View className="flex-1 pr-3">
        <Text className="text-xs font-bold text-slate-900">{label}</Text>
        <Text className="mt-0.5 text-[11px] leading-4 text-slate-500">{detail}</Text>
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
  const [pairedPrinters, setPairedPrinters] = useState<PairedPrinter[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [printerError, setPrinterError] = useState<string | null>(null);
  const isAndroid = Platform.OS === 'android';
  const loadPrinters = async () => {
    setLoadingPrinters(true);
    setPrinterError(null);
    try {
      setPairedPrinters(await getPairedBluetoothPrinters());
    } catch (error) {
      setPrinterError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingPrinters(false);
    }
  };
  const update = <K extends keyof ReceiptPrinterSettings>(
    key: K,
    nextValue: ReceiptPrinterSettings[K],
  ) => onChange({ ...value, [key]: nextValue });
  const resolvedSaveLabel = saveLabel ?? (saving ? 'Saving…' : 'Save Printer Settings');
  const saveDisabled = saving;

  return (
    <View className="mt-3 gap-4">
      {/* Printing Method */}
      <View>
        <Text className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
          Printing Method
        </Text>
        <View className="flex-row items-center rounded-xl border border-brand-200 bg-brand-50/80 p-3.5">
          <View className="h-9 w-9 items-center justify-center rounded-lg bg-brand-100">
            <Feather name={isAndroid ? 'bluetooth' : 'monitor'} size={16} color="#1A593B" />
          </View>
          <View className="ml-3 flex-1">
            <Text className="text-xs font-bold text-brand-950">{isAndroid ? 'Bluetooth Thermal Printer' : 'System Print Dialog'}</Text>
            <Text className="mt-0.5 text-[11px] text-slate-600">
              {isAndroid
                ? 'Print directly to a paired 58 mm ESC/POS printer such as the PT-210.'
                : 'Uses system print dialog. Supports any thermal, USB, network, or desktop printer.'}
            </Text>
          </View>
          <View className="flex-row items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5">
            <Feather name="check" size={12} color="#1A593B" />
            <Text className="text-[10px] font-bold text-brand-900">Active</Text>
          </View>
        </View>
      </View>

      {isAndroid ? (
        <View>
          <Text className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Paired Printer</Text>
          <Pressable
            accessibilityRole="button"
            disabled={loadingPrinters}
            onPress={loadPrinters}
            className="min-h-11 self-start justify-center rounded-xl border border-brand-200 bg-brand-50 px-4"
          >
            <Text className="text-xs font-bold text-brand-900">{loadingPrinters ? 'Loading paired devices…' : 'Show paired Bluetooth devices'}</Text>
          </Pressable>
          {printerError ? <Text className="mt-2 text-xs text-red-700">{printerError}</Text> : null}
          {!pairedPrinters.length && !printerError ? (
            <Text className="mt-2 text-xs text-slate-500">
              {value.bluetoothDeviceAddress ? `Selected device: ${value.bluetoothDeviceAddress}` : 'Pair the PT-210 in Android Bluetooth settings first, then tap the button above.'}
            </Text>
          ) : null}
          {pairedPrinters.map((printer) => {
            const selected = value.bluetoothDeviceAddress === printer.address;
            return (
              <Pressable
                key={printer.address}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => update('bluetoothDeviceAddress', printer.address)}
                className={`mt-2 min-h-12 justify-center rounded-xl border px-4 ${selected ? 'border-brand-600 bg-brand-50' : 'border-slate-200 bg-white'}`}
              >
                <Text className="text-xs font-bold text-slate-900">{printer.name}{selected ? '  ✓' : ''}</Text>
                <Text className="text-[11px] text-slate-500">{printer.address}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* Paper Size */}
      <View>
        <Text className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
          Paper Width / Size
        </Text>
        <View className="flex-row flex-wrap gap-2.5">
          {PAPER_OPTIONS.filter((option) => !isAndroid || option.value === '58mm').map((option) => {
            const selected = value.paperSize === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => update('paperSize', option.value)}
                className={`min-w-[130px] flex-1 rounded-xl border px-3.5 py-3 ${
                  selected ? 'border-brand-600 bg-brand-50/90 shadow-sm' : 'border-slate-200 bg-white active:bg-slate-50'
                }`}
              >
                <View className="flex-row items-center justify-between">
                  <Text
                    className={`text-xs font-bold ${selected ? 'text-brand-900' : 'text-slate-800'}`}
                  >
                    {option.label}
                  </Text>
                  {selected ? <Feather name="check-circle" size={14} color="#1A593B" /> : null}
                </View>
                <Text className="mt-1 text-[11px] text-slate-500">{option.detail}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Receipt Contents */}
      <View>
        <Text className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
          Receipt Layout & Elements
        </Text>
        <View className="flex-row flex-wrap gap-2.5">
          <ToggleCard
            label="Branch Address"
            detail="Show selling branch address below store name"
            value={value.includeBranchAddress}
            onChange={(next) => update('includeBranchAddress', next)}
          />
          <ToggleCard
            label="Cashier Name"
            detail="Show cashier name who processed checkout"
            value={value.includeCashierName}
            onChange={(next) => update('includeCashierName', next)}
          />
          <ToggleCard
            label="Tax Breakdown"
            detail="Separate tax totals on taxable items"
            value={value.includeTaxBreakdown}
            onChange={(next) => update('includeTaxBreakdown', next)}
          />
          <ToggleCard
            label="Receipt Footer"
            detail="Include thank-you message & branding"
            value={value.includeFooter}
            onChange={(next) => update('includeFooter', next)}
          />
          <ToggleCard
            label="Auto-Print On Checkout"
            detail={isAndroid ? 'Print directly after payment' : 'Open print dialog automatically after payment'}
            value={value.autoPrintAfterSale}
            onChange={(next) => update('autoPrintAfterSale', next)}
          />
        </View>
      </View>

      {/* Actions */}
      <View className="mt-1 flex-row flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: testing }}
          disabled={testing}
          onPress={onTest}
          style={Platform.OS === 'web' ? ({ cursor: testing ? 'default' : 'pointer' } as object) : undefined}
          className={`min-h-11 min-w-[150px] flex-row items-center justify-center rounded-xl border border-brand-200 bg-brand-50 px-4 active:bg-brand-100 ${
            testing ? 'opacity-50' : ''
          }`}
        >
          <Feather name="printer" size={15} color="#1A593B" />
          <Text className="ml-2 text-xs font-bold text-brand-800">
            {testing ? 'Printing…' : 'Print Test Receipt'}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save Printer Settings"
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
          className={`min-h-11 min-w-[170px] flex-row items-center justify-center rounded-xl bg-brand-700 px-5 active:bg-brand-800 ${
            saveDisabled ? 'opacity-50' : ''
          }`}
        >
          <Feather name="check" size={15} color="#FFFFFF" />
          <Text className="ml-2 text-xs font-bold text-white">{resolvedSaveLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}
