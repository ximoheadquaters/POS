import { Router } from 'express';
import { returnSchema, uuidSchema } from '@ximo/shared';
import type { Database } from '../../database/types.js';
import { requireBranchAccess, requireModule, requirePermission } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validation.js';
import { sendData } from '../../shared/http.js';
import { forbidden } from '../../shared/errors.js';
import { ReturnService } from '../../returns/return-service.js';

export function returnsRouter(database: Database): Router {
  const router = Router();
  const service = new ReturnService(database);
  router.use(requireModule('returns'), requirePermission('returns:create'));
  router.post(
    '/sales/:saleId',
    requireBranchAccess('body'),
    validateBody(returnSchema),
    async (request, response) => {
      const approval = await database.query(
        `select p.id from profiles p
         join roles r on r.id=p.role_id and r.organization_id=p.organization_id
         where p.organization_id=$1 and p.is_active=true
           and r.code in ('owner','administrator','manager') and p.pin=$3
           and (r.code in ('owner','administrator') or exists (
             select 1 from user_branches ub
             where ub.user_id=p.id and ub.organization_id=p.organization_id and ub.branch_id=$2
           ))
         limit 1`,
        [request.authUser!.organization.id, request.body.branchId, request.body.managerPin],
      );
      if (!approval.rowCount) {
        throw forbidden('INVALID_MANAGER_PIN', 'Manager PIN is incorrect or not authorized for this branch.');
      }
      const result = await service.create(
        { userId: request.authUser!.id, organizationId: request.authUser!.organization.id },
        uuidSchema.parse(request.params.saleId),
        request.body,
      );
      sendData(response, result, 201);
    },
  );
  return router;
}
