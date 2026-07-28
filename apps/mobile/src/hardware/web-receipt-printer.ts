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
  try {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function buildReceiptHtml(job: ReceiptPrintJob): string {
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

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Receipt ${escapeHtml(job.receiptNumber)}</title>
    <style>
      @page { size: 80mm auto; margin: 4mm; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; width: 72mm; color: #000; background: #fff; }
      body { font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      h1 { margin: 0; font-size: 18px; text-align: center; }
      .center { text-align: center; }
      .muted { color: #333; }
      .divider { margin: 8px 0; border-top: 1px dashed #000; }
      .row { display: flex; justify-content: space-between; gap: 8px; }
      .item-name { margin-top: 6px; font-weight: 700; overflow-wrap: anywhere; }
      .item-detail { padding-left: 6px; }
      .total { margin-top: 4px; font-size: 15px; font-weight: 800; }
      .footer { margin-top: 10px; text-align: center; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(job.businessName ?? 'Ximo POS')}</h1>
    ${job.branchName ? `<div class="center">${escapeHtml(job.branchName)}</div>` : ''}
    ${job.branchAddress ? `<div class="center muted">${escapeHtml(job.branchAddress)}</div>` : ''}
    <div class="divider"></div>
    <div>Receipt: ${escapeHtml(job.receiptNumber)}</div>
    <div>Date: ${escapeHtml(date)}</div>
    ${job.cashierName ? `<div>Cashier: ${escapeHtml(job.cashierName)}</div>` : ''}
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
      job.taxTotal
        ? `<div class="row"><span>Tax</span><span>${escapeHtml(money(job.taxTotal, job.currency))}</span></div>`
        : ''
    }
    <div class="row total"><span>TOTAL</span><span>${escapeHtml(money(job.total, job.currency))}</span></div>
    ${paymentRows ? `<div class="divider"></div>${paymentRows}` : ''}
    <div class="row"><span>Change</span><span>${escapeHtml(money(job.changeDue, job.currency))}</span></div>
    <div class="divider"></div>
    <div class="footer">Thank you!</div>
    <div class="footer muted">Powered by Ximo POS</div>
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
        printWindow.print();
        globalThis.setTimeout(cleanup, 60_000);
        resolve();
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
  async test() {
    await printHtml(
      buildReceiptHtml({
        saleId: 'test',
        receiptNumber: 'TEST-RECEIPT',
        businessName: 'Ximo POS',
        branchName: 'Printer test',
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
