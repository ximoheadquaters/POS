import { z } from 'zod';

export const moneyStringSchema = z
  .string()
  .regex(
    /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/,
    'Expected a positive decimal amount with at most 2 decimals',
  );

export function moneyToMinor(value?: string | null): bigint {
  if (!value || typeof value !== 'string') return 0n;
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

export function minorToMoney(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 100n;
  const cents = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${cents}`;
}

export function sumMoney(values: string[]): string {
  return minorToMoney(values.reduce((total, value) => total + moneyToMinor(value), 0n));
}

export function formatMoney(value: string | number, currency: string = 'PHP'): string {
  const num = typeof value === 'number' ? value : Number(value);
  const symbol = currency === 'PHP' ? '₱' : '$';
  return `${symbol}${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

