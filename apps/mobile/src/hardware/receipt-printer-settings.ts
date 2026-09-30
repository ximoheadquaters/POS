import { appStorage } from '../lib/storage';
import { Platform } from 'react-native';
import type { ReceiptPrintJob, ReceiptPrinterSettings } from './types';

const STORAGE_PREFIX = 'ximo.hardware.receipt-printer.v1';

export const DEFAULT_RECEIPT_PRINTER_SETTINGS: ReceiptPrinterSettings = {
  version: 1,
  printingMethod: Platform.OS === 'android' ? 'bluetooth' : 'system_dialog',
  paperSize: Platform.OS === 'android' ? '58mm' : '80mm',
  autoPrintAfterSale: false,
  includeBranchAddress: true,
  includeCashierName: true,
  includeTaxBreakdown: true,
  includeFooter: true,
};

function settingsKey(organizationId?: string, branchId?: string): string {
  return [STORAGE_PREFIX, organizationId || 'organization', branchId || 'device'].join(':');
}

function normalizeSettings(value: unknown): ReceiptPrinterSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_RECEIPT_PRINTER_SETTINGS };

  const candidate = value as Partial<ReceiptPrinterSettings>;
  const paperSize = ['58mm', '80mm', 'full_page'].includes(String(candidate.paperSize))
    ? (candidate.paperSize as ReceiptPrinterSettings['paperSize'])
    : DEFAULT_RECEIPT_PRINTER_SETTINGS.paperSize;

  return {
    ...DEFAULT_RECEIPT_PRINTER_SETTINGS,
    ...candidate,
    version: 1,
    printingMethod: Platform.OS === 'android' ? 'bluetooth' : 'system_dialog',
    paperSize: Platform.OS === 'android' ? '58mm' : paperSize,
    bluetoothDeviceAddress: typeof candidate.bluetoothDeviceAddress === 'string'
      ? candidate.bluetoothDeviceAddress
      : undefined,
  };
}

export async function getReceiptPrinterSettings(
  organizationId?: string,
  branchId?: string,
): Promise<ReceiptPrinterSettings> {
  const raw = await appStorage.getItem(settingsKey(organizationId, branchId));
  if (!raw) return { ...DEFAULT_RECEIPT_PRINTER_SETTINGS };

  try {
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_RECEIPT_PRINTER_SETTINGS };
  }
}

export async function saveReceiptPrinterSettings(
  settings: ReceiptPrinterSettings,
  organizationId?: string,
  branchId?: string,
): Promise<ReceiptPrinterSettings> {
  const normalized = normalizeSettings(settings);
  await appStorage.setItem(settingsKey(organizationId, branchId), JSON.stringify(normalized));
  return normalized;
}

export function applyReceiptPrinterSettings(
  settings: ReceiptPrinterSettings,
): Pick<
  ReceiptPrintJob,
  | 'paperSize'
  | 'bluetoothDeviceAddress'
  | 'includeBranchAddress'
  | 'includeCashierName'
  | 'includeTaxBreakdown'
  | 'includeFooter'
> {
  return {
    paperSize: settings.paperSize,
    bluetoothDeviceAddress: settings.bluetoothDeviceAddress,
    includeBranchAddress: settings.includeBranchAddress,
    includeCashierName: settings.includeCashierName,
    includeTaxBreakdown: settings.includeTaxBreakdown,
    includeFooter: settings.includeFooter,
  };
}
