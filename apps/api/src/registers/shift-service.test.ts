import { describe, expect, it } from 'vitest';
import { minorToMoney, moneyToMinor } from '@ximo/shared';

describe('register closure arithmetic', () => {
  it('calculates shortage and overage in exact minor units', () => {
    const expected =
      moneyToMinor('1000.00') +
      moneyToMinor('550.25') +
      moneyToMinor('50.00') -
      moneyToMinor('25.00');
    expect(minorToMoney(expected)).toBe('1575.25');
    expect(minorToMoney(moneyToMinor('1570.00') - expected)).toBe('-5.25');
    expect(minorToMoney(moneyToMinor('1580.50') - expected)).toBe('5.25');
  });
});
