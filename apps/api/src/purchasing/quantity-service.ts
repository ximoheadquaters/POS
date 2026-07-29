function toThousandths(value: number): bigint {
  return BigInt(Math.round(value * 1_000));
}

function moneyToCents(value: string): bigint {
  const normalized = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error('Money must be a positive amount with up to two decimal places');
  }
  const [whole, fraction = ''] = normalized.split('.');
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
}

function centsToMoney(cents: bigint): string {
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

function purchaseLineCents(quantity: number, unitCost: string): bigint {
  return (toThousandths(quantity) * moneyToCents(unitCost) + 500n) / 1_000n;
}

export function purchaseQuantityToBase(quantity: number, unitsPerBase: number): number {
  const scaled = toThousandths(quantity) * toThousandths(unitsPerBase);
  return Number((scaled + 500n) / 1_000n) / 1_000;
}

export function remainingToReceive(ordered: number, received: number): number {
  return Math.max(0, Number(toThousandths(ordered) - toThousandths(received)) / 1_000);
}

export function remainingToReturn(received: number, returned: number): number {
  return Math.max(0, Number(toThousandths(received) - toThousandths(returned)) / 1_000);
}

export function exceedsAvailable(requested: number, available: number): boolean {
  return toThousandths(requested) > toThousandths(available);
}

export function purchaseLineAmount(quantity: number, unitCost: string): string {
  return centsToMoney(purchaseLineCents(quantity, unitCost));
}

export function purchaseReturnTotal(lines: Array<{ quantity: number; unitCost: string }>): string {
  return centsToMoney(
    lines.reduce((total, line) => total + purchaseLineCents(line.quantity, line.unitCost), 0n),
  );
}
