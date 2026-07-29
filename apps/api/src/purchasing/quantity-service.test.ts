import { describe, expect, it } from 'vitest';
import {
  exceedsAvailable,
  purchaseLineAmount,
  purchaseQuantityToBase,
  purchaseReturnTotal,
  remainingToReceive,
  remainingToReturn,
} from './quantity-service.js';

describe('purchasing quantity conversion', () => {
  it('converts received packs into the shared base inventory unit', () => {
    expect(purchaseQuantityToBase(3, 10)).toBe(30);
    expect(purchaseQuantityToBase(1.25, 1_000)).toBe(1_250);
    expect(purchaseQuantityToBase(0.333, 3)).toBe(0.999);
  });

  it('calculates partial receiving and return availability without floating point drift', () => {
    expect(remainingToReceive(10, 3.25)).toBe(6.75);
    expect(remainingToReturn(3.25, 1.1)).toBe(2.15);
    expect(exceedsAvailable(2.151, 2.15)).toBe(true);
    expect(exceedsAvailable(2.15, 2.15)).toBe(false);
  });

  it('calculates immutable return values with exact per-line cent rounding', () => {
    expect(purchaseLineAmount(1.125, '40.00')).toBe('45.00');
    expect(purchaseLineAmount(0.333, '10.00')).toBe('3.33');
    expect(
      purchaseReturnTotal([
        { quantity: 1.125, unitCost: '40.00' },
        { quantity: 0.333, unitCost: '10.00' },
      ]),
    ).toBe('48.33');
  });
});
