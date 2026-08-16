import { buildReceiptHtml } from './web-receipt-printer';

describe('browser receipt formatter', () => {
  it('renders a 58mm receipt by default with sale totals and items', () => {
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

    expect(html).toContain('@page { size: 58mm auto;');
    expect(html).toContain('Ximo Store');
    expect(html).toContain('Rice');
    expect(html).toContain('BCD-0001');
    expect(html).toContain('TOTAL');
  });

  it('renders an 80mm receipt when paperSize is set to 80mm', () => {
    const html = buildReceiptHtml({
      saleId: 'sale-1',
      receiptNumber: 'BCD-0002',
      paperSize: '80mm',
      businessName: 'Ximo Store',
      currency: 'PHP',
      total: '100.00',
      changeDue: '0.00',
    });

    expect(html).toContain('@page { size: 80mm auto;');
  });

  it('renders a full-page receipt and respects optional receipt content', () => {
    const html = buildReceiptHtml({
      saleId: 'sale-1',
      receiptNumber: 'BCD-0003',
      paperSize: 'full_page',
      businessName: 'Ximo Store',
      branchAddress: 'Hidden address',
      cashierName: 'Hidden cashier',
      taxTotal: '12.00',
      includeBranchAddress: false,
      includeCashierName: false,
      includeTaxBreakdown: false,
      includeFooter: false,
      total: '112.00',
      changeDue: '0.00',
    });

    expect(html).toContain('@page { size: auto;');
    expect(html).not.toContain('Hidden address');
    expect(html).not.toContain('Hidden cashier');
    expect(html).not.toContain('<span>Tax</span>');
    expect(html).not.toContain('Thank you!');
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
