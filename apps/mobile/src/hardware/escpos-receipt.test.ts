import { describe, expect, it } from 'vitest';
import { buildEscPosReceipt, bytesToBase64 } from './escpos-receipt';

const sale = {
  saleId: 'sale-1',
  receiptNumber: 'R-100',
  businessName: 'Ximo POS',
  total: '336.00',
  changeDue: '14.00',
  items: [{ productName: 'Electric Fan', quantity: 1, unitPrice: '300.00', lineTotal: '300.00' }],
};

describe('ESC/POS receipt', () => {
  it('initializes printer and keeps rows within 58 mm paper width', () => {
    const bytes = buildEscPosReceipt(sale);
    const printed = String.fromCharCode(...bytes);
    expect(bytes.slice(0, 2)).toEqual([0x1b, 0x40]);
    expect(printed).toContain('Electric Fan');
    expect(printed).toContain('TOTAL');
    expect(printed.split('\n').filter(Boolean).every((line) => line.replace(/\x1b[\x40-\x7e]./g, '').length <= 32)).toBe(true);
  });

  it('honors optional receipt elements and encodes bytes for native transport', () => {
    const bytes = buildEscPosReceipt({ ...sale, cashierName: 'Jane', includeCashierName: false, includeFooter: false });
    const printed = String.fromCharCode(...bytes);
    expect(printed).not.toContain('Jane');
    expect(printed).not.toContain('Thank you');
    expect(bytesToBase64([0x1b, 0x40, 0x0a])).toBe('G0AK');
  });
});
