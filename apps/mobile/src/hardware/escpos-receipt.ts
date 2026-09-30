import type { ReceiptPrintJob } from './types';

const ESC = 0x1b;
const WIDTH = 32; // PT-210: 58 mm / 384-dot paper.

function ascii(value: string): string {
  return value.normalize('NFKD').replace(/[^\x20-\x7e]/g, '?');
}

function lines(value: string): string[] {
  const words = ascii(value).trim().split(/\s+/);
  const result: string[] = [];
  let line = '';
  for (const word of words) {
    if (!word) continue;
    if (line && `${line} ${word}`.length > WIDTH) {
      result.push(line);
      line = '';
    }
    if (word.length > WIDTH) {
      if (line) result.push(line);
      for (let start = 0; start < word.length; start += WIDTH) {
        result.push(word.slice(start, start + WIDTH));
      }
      line = '';
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) result.push(line);
  return result.length ? result : [''];
}

function row(left: string, right: string): string {
  const rightText = ascii(right);
  const available = Math.max(1, WIDTH - rightText.length - 1);
  const leftText = ascii(left).slice(0, available);
  return leftText + ' '.repeat(Math.max(1, WIDTH - leftText.length - rightText.length)) + rightText;
}

function money(value: string | undefined): string {
  const amount = Number(value ?? '0');
  return `PHP ${Number.isFinite(amount) ? amount.toFixed(2) : '0.00'}`;
}

export function buildEscPosReceipt(job: ReceiptPrintJob): number[] {
  const bytes: number[] = [ESC, 0x40];
  const command = (...values: number[]) => bytes.push(...values);
  const write = (value: string) => {
    for (const character of ascii(value)) bytes.push(character.charCodeAt(0));
    bytes.push(0x0a);
  };
  const divider = () => write('-'.repeat(WIDTH));
  command(ESC, 0x61, 1);
  command(ESC, 0x45, 1);
  lines(job.businessName ?? 'Ximo POS').forEach(write);
  command(ESC, 0x45, 0);
  if (job.branchName) lines(job.branchName).forEach(write);
  if (job.includeBranchAddress !== false && job.branchAddress) lines(job.branchAddress).forEach(write);
  command(ESC, 0x61, 0);
  divider();
  lines(`Receipt: ${job.receiptNumber}`).forEach(write);
  const completedAt = job.completedAt ? new Date(job.completedAt) : new Date();
  if (!Number.isNaN(completedAt.getTime())) write(`Date: ${completedAt.toLocaleString('en-PH')}`);
  if (job.includeCashierName !== false && job.cashierName) lines(`Cashier: ${job.cashierName}`).forEach(write);
  divider();
  if (!job.items?.length) write('Sale item details unavailable');
  for (const item of job.items ?? []) {
    lines(item.productName).forEach(write);
    write(row(`${item.quantity} x ${money(item.unitPrice)}`, money(item.lineTotal)));
  }
  divider();
  if (job.subtotal) write(row('Subtotal', money(job.subtotal)));
  if (job.discountTotal && Number(job.discountTotal) !== 0) write(row('Discount', `-${money(job.discountTotal)}`));
  if (job.includeTaxBreakdown !== false && job.taxTotal) write(row('Tax', money(job.taxTotal)));
  command(ESC, 0x45, 1);
  write(row('TOTAL', money(job.total)));
  command(ESC, 0x45, 0);
  if (job.payments?.length) {
    divider();
    job.payments.forEach((payment) => write(row(payment.method.replaceAll('_', ' ').toUpperCase(), money(payment.amount))));
  }
  write(row('Change', money(job.changeDue)));
  if (job.includeFooter !== false) {
    divider();
    command(ESC, 0x61, 1);
    write('Thank you!');
    write('Powered by Ximo POS');
  }
  command(0x0a, 0x0a, 0x0a);
  return bytes;
}

export function bytesToBase64(bytes: number[]): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const value = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    result += alphabet[(value >> 18) & 63] + alphabet[(value >> 12) & 63];
    result += i + 1 < bytes.length ? alphabet[(value >> 6) & 63] : '=';
    result += i + 2 < bytes.length ? alphabet[value & 63] : '=';
  }
  return result;
}
