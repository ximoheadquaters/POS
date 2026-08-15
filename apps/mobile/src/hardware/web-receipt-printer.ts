import type { ReceiptPrintJob, ReceiptPrinterDriver } from './types';

function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function money(value: string | undefined, currency = 'PHP'): string {
  const amount = Number(value ?? '0');
  const formatted = amount.toFixed(2);
  const prefix = currency === 'PHP' ? 'PHP ' : `${currency} `;
  return `${prefix}${formatted}`;
}

export function buildReceiptHtml(job: ReceiptPrintJob): string {
  const paperSize = job.paperSize ?? '58mm';
  const is58mm = paperSize === '58mm';
  const is80mm = paperSize === '80mm';
  const includeBranchAddress = job.includeBranchAddress !== false;
  const includeCashierName = job.includeCashierName !== false;
  const includeTaxBreakdown = job.includeTaxBreakdown !== false;
  const includeFooter = job.includeFooter !== false;

  const itemRows = (job.items ?? [])
    .map(
      (item) => `
        <div class="item-name">${escapeHtml(item.productName)}</div>
        <div class="row item-detail">
          <span>${escapeHtml(item.quantity)} x ${escapeHtml(money(item.unitPrice, job.currency))}</span>
          <strong>${escapeHtml(money(item.lineTotal, job.currency))}</strong>
        </div>`,
    )
    .join('');
  const paymentRows = (job.payments ?? [])
    .map(
      (payment) => `
        <div class="row">
          <span>${escapeHtml(payment.method.replaceAll('_', ' ').toUpperCase())}</span>
          <span>${escapeHtml(money(payment.amount, job.currency))}</span>
        </div>`,
    )
    .join('');
  const completedAt = job.completedAt ? new Date(job.completedAt) : new Date();
  const date = Number.isNaN(completedAt.getTime())
    ? job.completedAt
    : completedAt.toLocaleString('en-PH');

  const pageCss = is58mm
    ? `@page { size: 58mm auto; margin: 0; }
       html { margin: 0; padding: 0; width: 58mm; background: #fff; }
       body { margin: 0 auto; padding: 2mm 2mm 5mm 2mm; width: 52mm; max-width: 52mm; height: max-content; min-height: fit-content; color: #000; background: #fff; font: 10px/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; -webkit-print-color-adjust: exact; }
       h1 { margin: 0; font-size: 15px; text-align: center; font-weight: 800; }
       .divider { margin: 5px 0; border-top: 1px dashed #000; }
       .row { display: flex; justify-content: space-between; gap: 4px; }
       .item-name { margin-top: 4px; font-weight: 700; font-size: 10px; overflow-wrap: anywhere; }
       .item-detail { padding-left: 2px; font-size: 9.5px; }
       .total { margin-top: 4px; font-size: 13px; font-weight: 800; }
       .footer { margin-top: 8px; text-align: center; font-size: 9.5px; }
       @media print {
         html, body { width: 52mm; max-width: 52mm; height: max-content; margin: 0 auto; }
       }`
    : is80mm
      ? `@page { size: 80mm auto; margin: 4mm; }
       html, body { margin: 0; padding: 0; width: 72mm; color: #000; background: #fff; }
       body { font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; -webkit-print-color-adjust: exact; height: max-content; }
       h1 { margin: 0; font-size: 18px; text-align: center; }
       .divider { margin: 8px 0; border-top: 1px dashed #000; }
       .row { display: flex; justify-content: space-between; gap: 8px; }
       .item-name { margin-top: 6px; font-weight: 700; overflow-wrap: anywhere; }
       .item-detail { padding-left: 6px; }
       .total { margin-top: 4px; font-size: 15px; font-weight: 800; }
       .footer { margin-top: 10px; text-align: center; font-size: 9.5px; }
       @media print {
         body { width: 72mm; max-width: 72mm; height: max-content; margin: 0 auto; }
        }`
      : `@page { size: auto; margin: 12mm; }
         html, body { margin: 0; padding: 0; color: #000; background: #fff; }
         body { width: 100%; max-width: 186mm; margin: 0 auto; font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; -webkit-print-color-adjust: exact; }
         h1 { margin: 0; font-size: 24px; text-align: center; }
         .divider { margin: 12px 0; border-top: 1px dashed #000; }
         .row { display: flex; justify-content: space-between; gap: 12px; }
         .item-name { margin-top: 8px; font-weight: 700; overflow-wrap: anywhere; }
         .item-detail { padding-left: 10px; }
         .total { margin-top: 6px; font-size: 18px; font-weight: 800; }
         .footer { margin-top: 16px; text-align: center; }
         @media print { body { width: 100%; max-width: 186mm; margin: 0 auto; } }`;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Receipt ${escapeHtml(job.receiptNumber)}</title>
    <style>
      * { box-sizing: border-box; }
      .center { text-align: center; }
      .muted { color: #333; }
      ${pageCss}
    </style>
  </head>
  <body>
    <h1>${escapeHtml(job.businessName ?? 'Ximo POS')}</h1>
    ${job.branchName ? `<div class="center">${escapeHtml(job.branchName)}</div>` : ''}
    ${includeBranchAddress && job.branchAddress ? `<div class="center muted">${escapeHtml(job.branchAddress)}</div>` : ''}
    <div class="divider"></div>
    <div>Receipt: ${escapeHtml(job.receiptNumber)}</div>
    <div>Date: ${escapeHtml(date)}</div>
    ${includeCashierName && job.cashierName ? `<div>Cashier: ${escapeHtml(job.cashierName)}</div>` : ''}
    <div class="divider"></div>
    ${itemRows || '<div class="center muted">Sale item details unavailable</div>'}
    <div class="divider"></div>
    ${
      job.subtotal
        ? `<div class="row"><span>Subtotal</span><span>${escapeHtml(money(job.subtotal, job.currency))}</span></div>`
        : ''
    }
    ${
      job.discountTotal && job.discountTotal !== '0.00'
        ? `<div class="row"><span>Discount</span><span>-${escapeHtml(money(job.discountTotal, job.currency))}</span></div>`
        : ''
    }
    ${
      includeTaxBreakdown && job.taxTotal
        ? `<div class="row"><span>Tax</span><span>${escapeHtml(money(job.taxTotal, job.currency))}</span></div>`
        : ''
    }
    <div class="row total"><span>TOTAL</span><span>${escapeHtml(money(job.total, job.currency))}</span></div>
    ${paymentRows ? `<div class="divider"></div>${paymentRows}` : ''}
    <div class="row"><span>Change</span><span>${escapeHtml(money(job.changeDue, job.currency))}</span></div>
    ${includeFooter ? '<div class="divider"></div><div class="footer">Thank you!</div><div class="footer muted">Powered by Ximo POS</div>' : ''}
  </body>
</html>`;
}

function browserDocument(): Document | null {
  return typeof globalThis.document === 'undefined' ? null : globalThis.document;
}

async function printHtml(html: string): Promise<void> {
  const document = browserDocument();
  if (!document?.body) {
    throw new Error('Browser printing is only available in the Ximo POS website.');
  }

  await new Promise<void>((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.title = 'Receipt print preview';
    frame.style.position = 'fixed';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    frame.style.right = '0';
    frame.style.bottom = '0';

    const cleanup = () => frame.remove();
    frame.onload = () => {
      try {
        const printWindow = frame.contentWindow;
        if (!printWindow) throw new Error('The browser could not create a print preview.');
        printWindow.onafterprint = cleanup;
        printWindow.focus();
        globalThis.setTimeout(() => {
          try {
            printWindow.print();
            resolve();
          } catch (err) {
            cleanup();
            reject(err);
          }
        }, 150);
        globalThis.setTimeout(cleanup, 60_000);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    document.body.appendChild(frame);
    frame.srcdoc = html;
  });
}

export const browserReceiptPrinter: ReceiptPrinterDriver = {
  async status() {
    const ready = Boolean(browserDocument()?.body);
    return {
      state: ready ? 'ready' : 'not_configured',
      driverName: ready ? 'Browser print dialog' : 'No receipt-printer driver',
      detail: ready
        ? 'Uses the system print dialog. Select any printer installed on this computer.'
        : 'Install a compatible receipt-printer driver for this device.',
    };
  },
  async test(settings) {
    await printHtml(
      buildReceiptHtml({
        saleId: 'test',
        receiptNumber: 'TEST-RECEIPT',
        paperSize: settings?.paperSize,
        includeBranchAddress: settings?.includeBranchAddress,
        includeCashierName: settings?.includeCashierName,
        includeTaxBreakdown: settings?.includeTaxBreakdown,
        includeFooter: settings?.includeFooter,
        businessName: 'Ximo POS',
        branchName: 'Printer test',
        branchAddress: 'This line confirms the branch address fits the selected paper width.',
        cashierName: 'Test cashier',
        currency: 'PHP',
        total: '100.00',
        changeDue: '0.00',
        items: [
          {
            productName: 'Sample product',
            quantity: 1,
            unitPrice: '100.00',
            lineTotal: '100.00',
          },
        ],
        payments: [{ method: 'cash', amount: '100.00' }],
      }),
    );
  },
  async print(job) {
    await printHtml(buildReceiptHtml(job));
  },
};
