import { Router } from 'express';
import { returnSchema, uuidSchema } from '@ximo/shared';
import type { Database } from '../../database/types.js';
import { requireBranchAccess, requireModule, requirePermission } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validation.js';
import { sendData } from '../../shared/http.js';
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
