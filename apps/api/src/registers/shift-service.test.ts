import { describe, expect, it } from 'vitest';
import { minorToMoney, moneyToMinor } from '@ximo/shared';
import type { QueryResultRow } from 'pg';
import { ShiftService } from './shift-service.js';
import { AuthorizationDatabase, result } from '../test/fakes.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';
const registerId = '33333333-3333-4333-8333-333333333333';
const managerId = '44444444-4444-4444-8444-444444444444';
const cashierId = '55555555-5555-4555-8555-555555555555';
const shiftId = '66666666-6666-4666-8666-666666666666';

class ShiftDatabase extends AuthorizationDatabase {
  cashierAvailable = true;

  override async query<T extends QueryResultRow>(text: string, values?: readonly unknown[]) {
    this.calls.push(values ? { text, values } : { text });
    if (text.includes('join roles role')) {
      return result(this.cashierAvailable ? [{ allowed: true } as unknown as T] : []);
    }
    if (text.includes('select 1 from registers')) {
      return result([{ available: true } as unknown as T]);
    }
    if (text.includes('select 1 from register_shifts')) return result<T>([]);
    if (text.includes('insert into register_shifts')) {
      return result([{ id: shiftId, status: 'open' } as unknown as T]);
    }
    return result<T>([]);
  }
}

describe('shift assignment', () => {
  it('allows a manager to open a shift for an active cashier in the branch', async () => {
    const database = new ShiftDatabase();
    const shift = await new ShiftService(database).open(
      { userId: managerId, organizationId, canAssignCashier: true },
      branchId,
      { registerId, startingCash: '0.00', cashierId },
    );

    expect(shift).toMatchObject({ id: shiftId, cashierId });
    const insert = database.calls.find((call) => call.text.includes('insert into register_shifts'));
    expect(insert?.values?.[3]).toBe(cashierId);
  });

  it('rejects another-user assignment without manager authorization', async () => {
    const database = new ShiftDatabase();
    await expect(new ShiftService(database).open(
      { userId: managerId, organizationId },
      branchId,
      { registerId, startingCash: '0.00', cashierId },
    )).rejects.toMatchObject({ code: 'SHIFT_ASSIGNMENT_DENIED' });
    expect(database.calls).toHaveLength(0);
  });

  it('rejects a cashier who is inactive or outside the selected branch', async () => {
    const database = new ShiftDatabase();
    database.cashierAvailable = false;
    await expect(new ShiftService(database).open(
      { userId: managerId, organizationId, canAssignCashier: true },
      branchId,
      { registerId, startingCash: '0.00', cashierId },
    )).rejects.toMatchObject({ status: 404 });
    expect(database.calls.some((call) => call.text.includes('insert into register_shifts'))).toBe(false);
  });
});

describe('register closure arithmetic', () => {
  it('calculates shortage and overage in exact minor units', () => {
    const expected =
      moneyToMinor('1000.00') +
      moneyToMinor('550.25') +
      moneyToMinor('50.00') -
      moneyToMinor('25.00') -
      moneyToMinor('20.00');
    expect(minorToMoney(expected)).toBe('1555.25');
    expect(minorToMoney(moneyToMinor('1550.00') - expected)).toBe('-5.25');
    expect(minorToMoney(moneyToMinor('1560.50') - expected)).toBe('5.25');
  });
});
