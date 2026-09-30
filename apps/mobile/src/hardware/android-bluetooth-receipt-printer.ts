import { requireOptionalNativeModule } from 'expo';
import { PermissionsAndroid, Platform } from 'react-native';
import { buildEscPosReceipt, bytesToBase64 } from './escpos-receipt';
import type { ReceiptPrintJob, ReceiptPrinterDriver } from './types';

export interface PairedPrinter {
  name: string;
  address: string;
}

interface BluetoothPrinterModule {
  getPairedDevices(): Promise<PairedPrinter[]>;
  printBase64(address: string, payload: string): Promise<void>;
}

function module(): BluetoothPrinterModule {
  const printer = Platform.OS === 'android'
    ? requireOptionalNativeModule<BluetoothPrinterModule>('XimoBluetoothPrinter')
    : null;
  if (!printer) throw new Error('Bluetooth printing requires a new Ximo POS APK with the printer driver.');
  return printer;
}

async function requestBluetoothPermission(): Promise<void> {
  if (Platform.OS !== 'android') throw new Error('Bluetooth printing is available only on Android.');
  if (Number(Platform.Version) < 31) return;
  const permission = 'android.permission.BLUETOOTH_CONNECT' as typeof PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT;
  const result = await PermissionsAndroid.request(permission, {
    title: 'Connect to receipt printer',
    message: 'Allow Ximo POS to use your paired PT-210 Bluetooth receipt printer.',
    buttonPositive: 'Allow',
    buttonNegative: 'Cancel',
  });
  if (result !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error('Nearby devices permission is needed to print. Allow it in Android Settings and retry.');
  }
}

export async function getPairedBluetoothPrinters(): Promise<PairedPrinter[]> {
  await requestBluetoothPermission();
  return module().getPairedDevices();
}

async function send(address: string | undefined, job: ReceiptPrintJob): Promise<void> {
  if (!address) throw new Error('Select your paired PT-210 in Hardware devices and save the printer settings.');
  await requestBluetoothPermission();
  try {
    await module().printBase64(address, bytesToBase64(buildEscPosReceipt(job)));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not print over Bluetooth: ${detail}`);
  }
}

export const androidBluetoothReceiptPrinter: ReceiptPrinterDriver = {
  async status() {
    const installed = Platform.OS === 'android' && Boolean(requireOptionalNativeModule('XimoBluetoothPrinter'));
    return {
      state: installed ? 'ready' as const : 'not_configured' as const,
      driverName: installed ? 'Android Bluetooth thermal printer' : 'Bluetooth printer driver missing',
      detail: installed
        ? 'Select a paired 58 mm ESC/POS printer below, save, then print a test receipt.'
        : 'Install a new APK that includes the Ximo Bluetooth printer driver.',
    };
  },
  async test(settings) {
    await send(settings?.bluetoothDeviceAddress, {
      saleId: 'test',
      receiptNumber: 'TEST-RECEIPT',
      businessName: 'Ximo POS',
      branchName: 'PT-210 printer test',
      branchAddress: 'Bluetooth receipt printing',
      cashierName: 'Test cashier',
      currency: 'PHP',
      total: '100.00',
      changeDue: '0.00',
      items: [{ productName: 'Sample product', quantity: 1, unitPrice: '100.00', lineTotal: '100.00' }],
      payments: [{ method: 'cash', amount: '100.00' }],
      ...settings,
    });
  },
  async print(job) {
    await send(job.bluetoothDeviceAddress, job);
  },
};
