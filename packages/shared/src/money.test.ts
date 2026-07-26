import { describe, expect, it } from 'vitest';
import { minorToMoney, moneyToMinor, sumMoney } from './money.js';

describe('money utilities', () => {
  it('uses integer minor units without floating point drift', () => {
    expect(sumMoney(['0.10', '0.20'])).toBe('0.30');
    expect(moneyToMinor('90071992547409.91')).toBe(9007199254740991n);
    expect(minorToMoney(-505n)).toBe('-5.05');
  });
});
