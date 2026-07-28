import { buildReceiptHtml } from './web-receipt-printer';

describe('browser receipt formatter', () => {
  it('renders an 80mm receipt with sale totals and items', () => {
    const html = buildReceiptHtml({
      saleId: 'sale-1',
      receiptNumber: 'BCD-0001',
      businessName: 'Ximo Store',
      currency: 'PHP',
      total: '125.00',
      changeDue: '5.00',
      items: [
        {
          productName: 'Rice',
          quantity: 2,
          unitPrice: '60.00',
          lineTotal: '120.00',
        },
      ],
      payments: [{ method: 'cash', amount: '125.00' }],
    });

    expect(html).toContain('@page { size: 80mm auto;');
    expect(html).toContain('Ximo Store');
    expect(html).toContain('Rice');
    expect(html).toContain('BCD-0001');
    expect(html).toContain('TOTAL');
  });

  it('escapes receipt data before adding it to printable HTML', () => {
    const html = buildReceiptHtml({
      saleId: 'sale-1',
      receiptNumber: '<script>alert(1)</script>',
      total: '1.00',
      changeDue: '0.00',
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
