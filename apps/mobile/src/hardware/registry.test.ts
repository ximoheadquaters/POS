import type { ReceiptPrinterDriver } from './types';
import {
  getHardwareDriver,
  getHardwareStatuses,
  registerHardwareDriver,
  resetHardwareDrivers,
} from './registry';

afterEach(() => resetHardwareDrivers());

describe('hardware registry', () => {
  it('keeps modules disabled until the platform enables them', async () => {
    const statuses = await getHardwareStatuses([]);
    expect(statuses).toHaveLength(5);
    expect(statuses.every((status) => status.state === 'unavailable')).toBe(true);
  });

  it('supports keyboard-wedge barcode scanners without a native driver', async () => {
    const statuses = await getHardwareStatuses(['barcode_scanner']);
    expect(statuses.find((status) => status.code === 'barcode_scanner')).toMatchObject({
      state: 'ready',
      driverName: 'Keyboard scanner',
    });
  });

  it('allows a vendor driver to be registered without changing checkout code', async () => {
    const printer: ReceiptPrinterDriver = {
      status: async () => ({
        state: 'ready',
        driverName: 'Test printer',
        detail: 'Connected',
      }),
      test: async () => undefined,
      print: async () => undefined,
    };
    registerHardwareDriver('receipt_printer', printer);

    expect(getHardwareDriver('receipt_printer')).toBe(printer);
    await expect(getHardwareStatuses(['receipt_printer'])).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'receipt_printer',
          state: 'ready',
          driverName: 'Test printer',
        }),
      ]),
    );
  });
});
