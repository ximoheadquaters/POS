import { Router } from 'express';
import { branchSchema, uuidSchema } from '@ximo/shared';
import type { Queryable } from '../../database/types.js';
import { requirePermission } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validation.js';
import { notFound } from '../../shared/errors.js';
import { sendData } from '../../shared/http.js';

export function branchesRouter(database: Queryable): Router {
  const router = Router();
  router.get('/', requirePermission('branches:read'), async (request, response) => {
    const rows = await database.query(
      `select id, name, code, address, phone, is_active as "isActive"
       from branches where organization_id = $1 order by name`,
      [request.authUser!.organization.id],
    );
    sendData(response, rows.rows);
  });
  router.post(
    '/',
    requirePermission('branches:manage'),
    validateBody(branchSchema),
    async (request, response) => {
      const input = request.body;
      const result = await database.query(
        `insert into branches (organization_id,name,code,address,phone,is_active)
         values ($1,$2,$3,$4,$5,$6)
         returning id,name,code,address,phone,is_active as "isActive"`,
        [
          request.authUser!.organization.id,
          input.name,
          input.code,
          input.address ?? null,
          input.phone ?? null,
          input.isActive,
        ],
      );
      sendData(response, result.rows[0], 201);
    },
  );
  router.patch(
    '/:id',
    requirePermission('branches:manage'),
    validateBody(branchSchema.partial()),
    async (request, response) => {
      const id = uuidSchema.parse(request.params.id);
      const current = await database.query<Record<string, unknown>>(
        'select * from branches where id = $1 and organization_id = $2',
        [id, request.authUser!.organization.id],
      );
      if (!current.rows[0]) throw notFound('Branch');
      const value = { ...current.rows[0], ...request.body };
      const result = await database.query(
        `update branches set name=$3,code=$4,address=$5,phone=$6,is_active=$7
         where id=$1 and organization_id=$2
         returning id,name,code,address,phone,is_active as "isActive"`,
        [
          id,
          request.authUser!.organization.id,
          value.name,
          value.code,
          value.address ?? null,
          value.phone ?? null,
          value.isActive ?? value.is_active,
        ],
      );
      sendData(response, result.rows[0]);
    },
  );
  router.put(
    '/:branchId/users/:userId',
    requirePermission('users:manage'),
    async (request, response) => {
      const branchId = uuidSchema.parse(request.params.branchId);
      const userId = uuidSchema.parse(request.params.userId);
      const organizationId = request.authUser!.organization.id;
      const result = await database.query(
        `insert into user_branches (organization_id,user_id,branch_id)
         select $1,p.id,b.id from profiles p join branches b on b.organization_id=p.organization_id
         where p.organization_id=$1 and p.id=$2 and b.id=$3
         on conflict do nothing returning user_id`,
        [organizationId, userId, branchId],
      );
      if (!result.rowCount) {
        const exists = await database.query(
          `select 1 from user_branches where organization_id=$1 and user_id=$2 and branch_id=$3`,
          [organizationId, userId, branchId],
        );
        if (!exists.rowCount) throw notFound('User or branch');
      }
      sendData(response, { assigned: true });
    },
  );
  return router;
}
