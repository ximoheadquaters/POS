import { HARDWARE_MODULE_CODES, type HardwareModuleCode, type ModuleCode } from '@ximo/shared';
import type {
  BarcodeScannerDriver,
  CashDrawerDriver,
  CustomerDisplayDriver,
  HardwareDriverMap,
  HardwareStatus,
  PaymentTerminalDriver,
  ReceiptPrinterDriver,
} from './types';

export class HardwareUnavailableError extends Error {
  constructor(
    public readonly code: HardwareModuleCode,
    message = 'This hardware driver is not configured on this device.',
  ) {
    super(message);
    this.name = 'HardwareUnavailableError';
  }
}

const unavailableStatus = (driverName: string) => async () => ({
  state: 'not_configured' as const,
  driverName,
  detail: 'Module enabled, but no compatible device driver is installed.',
});

const unavailableTest = (code: HardwareModuleCode) => async () => {
  throw new HardwareUnavailableError(code);
};

const keyboardScanner: BarcodeScannerDriver = {
  mode: 'keyboard',
  async status() {
    return {
      state: 'ready',
      driverName: 'Keyboard scanner',
      detail: 'Ready for scanners that type a barcode and send Enter.',
    };
  },
  async test() {
    return Promise.resolve();
  },
};

const unavailableReceiptPrinter: ReceiptPrinterDriver = {
  status: unavailableStatus('No receipt-printer driver'),
  test: unavailableTest('receipt_printer'),
  async print() {
    throw new HardwareUnavailableError('receipt_printer');
  },
};

const unavailableCashDrawer: CashDrawerDriver = {
  status: unavailableStatus('No cash-drawer driver'),
  test: unavailableTest('cash_drawer'),
  async open() {
    throw new HardwareUnavailableError('cash_drawer');
  },
};

const unavailablePaymentTerminal: PaymentTerminalDriver = {
  status: unavailableStatus('No payment-terminal driver'),
  test: unavailableTest('payment_terminal'),
  async charge() {
    throw new HardwareUnavailableError('payment_terminal');
  },
};

const unavailableCustomerDisplay: CustomerDisplayDriver = {
  status: unavailableStatus('No customer-display driver'),
  test: unavailableTest('customer_display'),
  async show() {
    throw new HardwareUnavailableError('customer_display');
  },
  async clear() {
    throw new HardwareUnavailableError('customer_display');
  },
};

const defaultDrivers: HardwareDriverMap = {
  barcode_scanner: keyboardScanner,
  receipt_printer: unavailableReceiptPrinter,
  cash_drawer: unavailableCashDrawer,
  payment_terminal: unavailablePaymentTerminal,
  customer_display: unavailableCustomerDisplay,
};

let drivers: HardwareDriverMap = { ...defaultDrivers };

export function registerHardwareDriver<K extends HardwareModuleCode>(
  code: K,
  driver: HardwareDriverMap[K],
) {
  drivers[code] = driver;
}

export function getHardwareDriver<K extends HardwareModuleCode>(code: K): HardwareDriverMap[K] {
  return drivers[code];
}

export async function getHardwareStatuses(modules: ModuleCode[]): Promise<HardwareStatus[]> {
  const enabled = new Set(modules);
  return Promise.all(
    HARDWARE_MODULE_CODES.map(async (code) => {
      if (!enabled.has(code)) {
        return {
          code,
          state: 'unavailable' as const,
          driverName: 'Module disabled',
          detail: 'Enable this module for the organization in the Ximo platform administrator.',
        };
      }
      return { code, ...(await drivers[code].status()) };
    }),
  );
}

export function resetHardwareDrivers() {
  drivers = { ...defaultDrivers };
}
