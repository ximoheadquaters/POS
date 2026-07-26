import type { CashMovementInput, CloseShiftInput, OpenShiftInput } from '@ximo/shared';
import { minorToMoney, moneyToMinor } from '@ximo/shared';
import type { Database } from '../database/types.js';
import { conflict, forbidden, notFound } from '../shared/errors.js';

interface ShiftActor {
  userId: string;
  organizationId: string;
}

export class ShiftService {
  constructor(private readonly database: Database) {}

  open(actor: ShiftActor, branchId: string, input: OpenShiftInput) {
    return this.database.transaction(async (tx) => {
      const register = await tx.query(
        `select 1 from registers where id = $1 and organization_id = $2
         and branch_id = $3 and is_active for update`,
        [input.registerId, actor.organizationId, branchId],
      );
      if (!register.rowCount) throw notFound('Register');
      const active = await tx.query(
        `select 1 from register_shifts where organization_id = $1 and status = 'open'
         and (register_id = $2 or cashier_id = $3)`,
        [actor.organizationId, input.registerId, actor.userId],
      );
      if (active.rowCount)
        throw conflict('SHIFT_ALREADY_OPEN', 'Register or cashier already has an open shift');
      const shift = await tx.query(
        `insert into register_shifts (
          organization_id, branch_id, register_id, cashier_id, starting_cash
         ) values ($1,$2,$3,$4,$5)
         returning id, status, starting_cash::text as "startingCash", opened_at as "openedAt"`,
        [actor.organizationId, branchId, input.registerId, actor.userId, input.startingCash],
      );
      await tx.query(
        `insert into audit_logs (
          organization_id, branch_id, actor_id, action, entity_type, entity_id, after_data
         ) values ($1,$2,$3,'shift.opened','register_shift',$4,$5::jsonb)`,
        [actor.organizationId, branchId, actor.userId, shift.rows[0]!.id, JSON.stringify(input)],
      );
      return shift.rows[0];
    });
  }

  cashMovement(actor: ShiftActor, branchId: string, input: CashMovementInput) {
    return this.database.transaction(async (tx) => {
      const shift = await tx.query(
        `select 1 from register_shifts where id = $1 and organization_id = $2
         and branch_id = $3 and cashier_id = $4 and status = 'open' for update`,
        [input.shiftId, actor.organizationId, branchId, actor.userId],
      );
      if (!shift.rowCount) throw forbidden('SHIFT_ACCESS_DENIED', 'No matching active shift');
      const movement = await tx.query(
        `insert into cash_movements (
          organization_id, branch_id, shift_id, type, amount, reason, created_by
         ) values ($1,$2,$3,$4,$5,$6,$7) returning id, type, amount::text, reason, created_at as "createdAt"`,
        [
          actor.organizationId,
          branchId,
          input.shiftId,
          input.type,
          input.amount,
          input.reason,
          actor.userId,
        ],
      );
      await tx.query(
        `insert into audit_logs (
          organization_id, branch_id, actor_id, action, entity_type, entity_id, after_data
         ) values ($1,$2,$3,'cash.moved','cash_movement',$4,$5::jsonb)`,
        [actor.organizationId, branchId, actor.userId, movement.rows[0]!.id, JSON.stringify(input)],
      );
      return movement.rows[0];
    });
  }

  close(actor: ShiftActor, shiftId: string, input: CloseShiftInput) {
    return this.database.transaction(async (tx) => {
      const result = await tx.query<{
        id: string;
        branch_id: string;
        starting_cash: string;
        cash_sales: string;
        cash_in: string;
        cash_out: string;
      }>(
        `select rs.id, rs.branch_id, rs.starting_cash::text, rs.cash_sales::text,
          coalesce((
            select sum(cm.amount) from cash_movements cm
            where cm.shift_id = rs.id and cm.type = 'cash_in'
          ),0)::text as cash_in,
          coalesce((
            select sum(cm.amount) from cash_movements cm
            where cm.shift_id = rs.id and cm.type = 'cash_out'
          ),0)::text as cash_out
         from register_shifts rs
         where rs.id = $1 and rs.organization_id = $2 and rs.cashier_id = $3 and rs.status = 'open'
         for update of rs`,
        [shiftId, actor.organizationId, actor.userId],
      );
      const shift = result.rows[0];
      if (!shift) throw notFound('Active shift');
      const expected =
        moneyToMinor(shift.starting_cash) +
        moneyToMinor(shift.cash_sales) +
        moneyToMinor(shift.cash_in) -
        moneyToMinor(shift.cash_out);
      const actual = moneyToMinor(input.actualCash);
      const variance = actual - expected;
      const closed = await tx.query(
        `update register_shifts set status = 'closed', expected_cash = $2, actual_cash = $3,
          variance = $4, notes = $5, closed_at = now(), updated_at = now()
         where id = $1
         returning id, status, expected_cash::text as "expectedCash",
          actual_cash::text as "actualCash", variance::text, closed_at as "closedAt"`,
        [
          shiftId,
          minorToMoney(expected),
          input.actualCash,
          minorToMoney(variance),
          input.notes ?? null,
        ],
      );
      await tx.query(
        `insert into audit_logs (
          organization_id, branch_id, actor_id, action, entity_type, entity_id, after_data
         ) values ($1,$2,$3,'shift.closed','register_shift',$4,$5::jsonb)`,
        [
          actor.organizationId,
          shift.branch_id,
          actor.userId,
          shiftId,
          JSON.stringify(closed.rows[0]),
        ],
      );
      return closed.rows[0];
    });
  }
}
