import { requireNativeModule } from 'expo';

export interface PairedBluetoothDevice {
  name: string;
  address: string;
}

export interface PrinterModule {
  getPairedDevices(): Promise<PairedBluetoothDevice[]>;
  printBase64(address: string, payload: string): Promise<void>;
}

export default requireNativeModule<PrinterModule>('XimoBluetoothPrinter');
