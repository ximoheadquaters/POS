import { Router } from 'express';
import { z } from 'zod';
import { roleCodeSchema, uuidSchema } from '@ximo/shared';
import type { Database } from '../../database/types.js';
import { requirePermission } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validation.js';
import { notFound } from '../../shared/errors.js';
import { sendData } from '../../shared/http.js';

const updateUserSchema = z.object({
  role: roleCodeSchema.optional(),
  isActive: z.boolean().optional(),
  branchIds: z.array(uuidSchema).optional(),
});

export function usersRouter(database: Database): Router {
  const router = Router();
  router.get('/', requirePermission('users:read'), async (request, response) => {
    const result = await database.query(
      `select p.id,p.display_name as "displayName",p.email,p.is_active as "isActive",r.code as role,
        coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'code',b.code))
          filter (where b.id is not null),'[]') as branches
       from profiles p join roles r on r.id=p.role_id
       left join user_branches ub on ub.user_id=p.id left join branches b on b.id=ub.branch_id
       where p.organization_id=$1 group by p.id,r.code order by p.display_name`,
      [request.authUser!.organization.id],
    );
    sendData(response, result.rows);
  });
  router.patch(
    '/:id',
    requirePermission('users:manage'),
    validateBody(updateUserSchema),
    async (request, response) => {
      const userId = uuidSchema.parse(request.params.id);
      const organizationId = request.authUser!.organization.id;
      const result = await database.transaction(async (tx) => {
        const exists = await tx.query(
          'select 1 from profiles where id=$1 and organization_id=$2 for update',
          [userId, organizationId],
        );
        if (!exists.rowCount) throw notFound('User');
        if (request.body.role) {
          await tx.query(
            `update profiles set role_id=(select id from roles where organization_id=$2 and code=$3),
             updated_at=now() where id=$1 and organization_id=$2`,
            [userId, organizationId, request.body.role],
          );
        }
        if (request.body.isActive !== undefined) {
          await tx.query(
            'update profiles set is_active=$3,updated_at=now() where id=$1 and organization_id=$2',
            [userId, organizationId, request.body.isActive],
          );
        }
        if (request.body.branchIds) {
          await tx.query('delete from user_branches where user_id=$1 and organization_id=$2', [
            userId,
            organizationId,
          ]);
          for (const branchId of request.body.branchIds) {
            const inserted = await tx.query(
              `insert into user_branches (organization_id,user_id,branch_id)
               select $1,$2,b.id from branches b where b.id=$3 and b.organization_id=$1`,
              [organizationId, userId, branchId],
            );
            if (!inserted.rowCount) throw notFound('Branch');
          }
        }
        await tx.query(
          `insert into audit_logs (
            organization_id,actor_id,action,entity_type,entity_id,after_data
           ) values ($1,$2,'user.updated','profile',$3,$4::jsonb)`,
          [organizationId, request.authUser!.id, userId, JSON.stringify(request.body)],
        );
        return { id: userId, updated: true };
      });
      sendData(response, result);
    },
  );
  return router;
}
