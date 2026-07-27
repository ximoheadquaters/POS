import type { HardwareModuleCode } from '@ximo/shared';

export const HARDWARE_CAPABILITIES: ReadonlyArray<{
  code: HardwareModuleCode;
  name: string;
  symbol: string;
  description: string;
}> = [
  {
    code: 'barcode_scanner',
    name: 'Barcode scanner',
    symbol: 'B',
    description: 'Scan products into the cart using keyboard or vendor-native scanner input.',
  },
  {
    code: 'receipt_printer',
    name: 'Receipt printer',
    symbol: 'P',
    description: 'Print completed sale receipts from the embedded or external printer.',
  },
  {
    code: 'cash_drawer',
    name: 'Cash drawer',
    symbol: 'D',
    description: 'Open a connected drawer safely after cash checkout.',
  },
  {
    code: 'payment_terminal',
    name: 'Payment terminal',
    symbol: 'T',
    description: 'Send card payments through a certified terminal integration.',
  },
  {
    code: 'customer_display',
    name: 'Customer display',
    symbol: 'C',
    description: 'Show the live cart and total on a customer-facing display.',
  },
];
