import type { HardwareModuleCode } from '@ximo/shared';

export type HardwareConnectionState = 'ready' | 'not_configured' | 'unavailable';

export interface HardwareStatus {
  code: HardwareModuleCode;
  state: HardwareConnectionState;
  driverName: string;
  detail: string;
}

export interface BaseHardwareDriver {
  status(): Promise<Omit<HardwareStatus, 'code'>>;
  test(): Promise<void>;
}

export interface BarcodeScannerDriver extends BaseHardwareDriver {
  mode: 'keyboard' | 'native';
}

export type ReceiptPaperSize = '58mm' | '80mm' | 'full_page';

export interface ReceiptPrinterSettings {
  version: 1;
  printingMethod: 'system_dialog';
  paperSize: ReceiptPaperSize;
  autoPrintAfterSale: boolean;
  includeBranchAddress: boolean;
  includeCashierName: boolean;
  includeTaxBreakdown: boolean;
  includeFooter: boolean;
}

export interface ReceiptPrintJob {
  saleId: string;
  receiptNumber: string;
  paperSize?: ReceiptPaperSize;
  includeBranchAddress?: boolean;
  includeCashierName?: boolean;
  includeTaxBreakdown?: boolean;
  includeFooter?: boolean;
  businessName?: string;
  branchName?: string;
  branchAddress?: string | null;
  cashierName?: string;
  completedAt?: string;
  currency?: string;
  subtotal?: string;
  discountTotal?: string;
  taxTotal?: string;
  total: string;
  changeDue: string;
  items?: Array<{
    productName: string;
    quantity: number;
    unitPrice: string;
    lineTotal: string;
  }>;
  payments?: Array<{
    method: string;
    amount: string;
  }>;
}

export interface ReceiptPrinterDriver extends BaseHardwareDriver {
  test(settings?: ReceiptPrinterSettings): Promise<void>;
  print(job: ReceiptPrintJob): Promise<void>;
}

export interface CashDrawerDriver extends BaseHardwareDriver {
  open(): Promise<void>;
}

export interface PaymentTerminalRequest {
  amount: string;
  currency: string;
  idempotencyKey: string;
}

export interface PaymentTerminalResult {
  approved: boolean;
  reference: string;
}

export interface PaymentTerminalDriver extends BaseHardwareDriver {
  charge(request: PaymentTerminalRequest): Promise<PaymentTerminalResult>;
}

export interface CustomerDisplaySnapshot {
  itemCount: number;
  total: string;
  currency: string;
}

export interface CustomerDisplayDriver extends BaseHardwareDriver {
  show(snapshot: CustomerDisplaySnapshot): Promise<void>;
  clear(): Promise<void>;
}

export interface HardwareDriverMap {
  barcode_scanner: BarcodeScannerDriver;
  receipt_printer: ReceiptPrinterDriver;
  cash_drawer: CashDrawerDriver;
  payment_terminal: PaymentTerminalDriver;
  customer_display: CustomerDisplayDriver;
}
