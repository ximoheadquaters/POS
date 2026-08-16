import {
  DEFAULT_RECEIPT_PRINTER_SETTINGS,
  getReceiptPrinterSettings,
  saveReceiptPrinterSettings,
} from './receipt-printer-settings';

describe('receipt printer settings', () => {
  it('uses the safe defaults for an unconfigured device', async () => {
    await expect(
      getReceiptPrinterSettings('unconfigured-org', 'unconfigured-branch'),
    ).resolves.toEqual(DEFAULT_RECEIPT_PRINTER_SETTINGS);
  });

  it('stores settings separately for each organization and branch on the device', async () => {
    await saveReceiptPrinterSettings(
      { ...DEFAULT_RECEIPT_PRINTER_SETTINGS, paperSize: '58mm', includeFooter: false },
      'settings-org',
      'branch-a',
    );

    await expect(getReceiptPrinterSettings('settings-org', 'branch-a')).resolves.toMatchObject({
      paperSize: '58mm',
      includeFooter: false,
    });
    await expect(getReceiptPrinterSettings('settings-org', 'branch-b')).resolves.toEqual(
      DEFAULT_RECEIPT_PRINTER_SETTINGS,
    );
  });
});
