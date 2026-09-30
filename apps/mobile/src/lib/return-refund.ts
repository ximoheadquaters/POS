import { minorToMoney, moneyToMinor } from '@ximo/shared';

export interface RefundableSaleItem {
  id: string;
  quantity: number;
  lineTotal: string;
  taxTotal: string;
}

function quantityToThousandths(value: number): bigint {
  return BigInt(Math.round(value * 1_000));
}

function prorateMoney(total: string, selectedQuantity: number, soldQuantity: number): bigint {
  if (selectedQuantity <= 0 || soldQuantity <= 0) return 0n;
  return (
    (moneyToMinor(total) * quantityToThousandths(selectedQuantity)) /
    quantityToThousandths(soldQuantity)
  );
}

export function calculateReturnRefund(
  items: RefundableSaleItem[],
  quantities: Record<string, string>,
) {
  let refundMinor = 0n;
  let taxRefundMinor = 0n;

  for (const item of items) {
    const selectedQuantity = Number((quantities[item.id] ?? '0').replace(',', '.'));
    if (!Number.isFinite(selectedQuantity) || selectedQuantity <= 0) continue;

    // lineTotal is the amount actually paid after discounts and including tax.
    // Prorating it keeps the preview identical to the amount refunded by the API.
    refundMinor += prorateMoney(item.lineTotal, selectedQuantity, item.quantity);
    taxRefundMinor += prorateMoney(item.taxTotal, selectedQuantity, item.quantity);
  }

  return {
    refundTotal: minorToMoney(refundMinor),
    taxRefundTotal: minorToMoney(taxRefundMinor),
  };
}
