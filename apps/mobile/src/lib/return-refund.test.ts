import { describe, expect, it } from 'vitest';
import { calculateReturnRefund } from './return-refund';

describe('calculateReturnRefund', () => {
  it('includes the prorated tax in a partial item refund', () => {
    const result = calculateReturnRefund(
      [
        {
          id: 'sale-item-1',
          quantity: 2,
          lineTotal: '224.00',
          taxTotal: '24.00',
        },
      ],
      { 'sale-item-1': '1' },
    );

    expect(result).toEqual({
      refundTotal: '112.00',
      taxRefundTotal: '12.00',
    });
  });

  it('uses the paid line total so discounts are preserved', () => {
    const result = calculateReturnRefund(
      [
        {
          id: 'sale-item-1',
          quantity: 2,
          lineTotal: '204.00',
          taxTotal: '24.00',
        },
      ],
      { 'sale-item-1': '1' },
    );

    expect(result.refundTotal).toBe('102.00');
  });
});
