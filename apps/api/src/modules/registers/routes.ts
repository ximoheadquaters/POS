import { Router } from 'express';
import { cashMovementSchema, closeShiftSchema, createRegisterSchema, openShiftSchema, uuidSchema } from '@ximo/shared';
import { z } from 'zod';
import type { Database } from '../../database/types.js';
import { requireBranchAccess, requireAnyModule, requirePermission } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validation.js';
import { sendData } from '../../shared/http.js';
import { ShiftService } from '../../registers/shift-service.js';

export function registersRouter(database: Database): Router {
  const router = Router();
  const shifts = new ShiftService(database);
  router.use(requireAnyModule('registers', 'pos'));
  router.get(
    '/',
    requirePermission('registers:read'),
    requireBranchAccess('query'),
    async (request, response) => {
      const result = await database.query(
        `select r.id,r.name,r.code,r.is_active as "isActive",
          rs.id as "activeShiftId",rs.cashier_id as "activeCashierId"
         from registers r left join register_shifts rs on rs.register_id=r.id and rs.status='open'
         where r.organization_id=$1 and r.branch_id=$2 order by r.name`,
        [request.authUser!.organization.id, request.query.branchId],
      );
      sendData(response, result.rows);
    },
  );
  router.post(
    '/',
    requirePermission('registers:manage'),
    requireBranchAccess('body'),
    validateBody(createRegisterSchema),
    async (request, response) => {
      const result = await database.query(
        `insert into registers (organization_id,branch_id,name,code)
         values ($1,$2,$3,$4) returning id,name,code,is_active as "isActive"`,
        [
          request.authUser!.organization.id,
          request.body.branchId,
          request.body.name,
          request.body.code,
        ],
      );
      sendData(response, result.rows[0], 201);
    },
  );
  router.post(
    '/shifts/open',
    requirePermission('shifts:open'),
    requireBranchAccess('body'),
    validateBody(openShiftSchema.extend({ branchId: uuidSchema })),
    async (request, response) => {
      const result = await shifts.open(
        { userId: request.authUser!.id, organizationId: request.authUser!.organization.id },
        request.body.branchId,
        request.body,
      );
      sendData(response, result, 201);
    },
  );
  router.post(
    '/cash-movements',
    requirePermission('cash:move'),
    requireBranchAccess('body'),
    validateBody(cashMovementSchema.extend({ branchId: uuidSchema })),
    async (request, response) => {
      const result = await shifts.cashMovement(
        { userId: request.authUser!.id, organizationId: request.authUser!.organization.id },
        request.body.branchId,
        request.body,
      );
      sendData(response, result, 201);
    },
  );
  router.post(
    '/shifts/:shiftId/close',
    requirePermission('shifts:close'),
    validateBody(closeShiftSchema),
    async (request, response) => {
      const result = await shifts.close(
        { userId: request.authUser!.id, organizationId: request.authUser!.organization.id },
        uuidSchema.parse(request.params.shiftId),
        request.body,
      );
      sendData(response, result);
    },
  );
  return router;
}
