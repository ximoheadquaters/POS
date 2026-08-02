import { Router } from 'express';
import { branchSchema, uuidSchema } from '@ximo/shared';
import { z } from 'zod';
import type { Database } from '../../database/types.js';
import { requirePermission } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validation.js';
import { conflict, notFound } from '../../shared/errors.js';
import { sendData } from '../../shared/http.js';

const updateBranchSchema = branchSchema.partial().extend({ isActive: z.boolean().optional() });

export function branchesRouter(database: Database): Router {
  const router = Router();
  router.get('/', requirePermission('branches:read'), async (request, response) => {
    const rows = await database.query(
      `select b.id,b.name,b.code,b.address,b.phone,b.is_active as "isActive",
        (select count(*)::int from user_branches ub where ub.branch_id=b.id) as "staffCount",
        (select count(*)::int from branch_inventory bi where bi.branch_id=b.id) as "inventoryItems",
        (select count(*)::int from registers r where r.branch_id=b.id) as "registerCount",
        (select count(*)::int from register_shifts rs
          where rs.branch_id=b.id and rs.status='open') as "openShiftCount",
        b.created_at as "createdAt",b.updated_at as "updatedAt"
       from branches b where b.organization_id=$1
       order by b.is_active desc,b.name`,
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
      const organizationId = request.authUser!.organization.id;
      const created = await database.transaction(async (transaction) => {
        const duplicate = await transaction.query(
          'select id from branches where organization_id=$1 and code=$2',
          [organizationId, input.code],
        );
        if (duplicate.rowCount) {
          throw conflict('BRANCH_CODE_EXISTS', 'A branch already uses this branch code.');
        }
        const result = await transaction.query(
          `insert into branches (organization_id,name,code,address,phone,is_active)
           values ($1,$2,$3,$4,$5,$6)
           returning id,name,code,address,phone,is_active as "isActive",
             created_at as "createdAt",updated_at as "updatedAt"`,
          [
            organizationId,
            input.name,
            input.code,
            input.address || null,
            input.phone || null,
            input.isActive,
          ],
        );
        const branch = result.rows[0]!;
        await transaction.query(
          `insert into audit_logs (
            organization_id,actor_id,branch_id,action,entity_type,entity_id,after_data
           ) values ($1,$2,$3,'branch.created','branch',$3,$4::jsonb)`,
          [organizationId, request.authUser!.id, branch.id, JSON.stringify(branch)],
        );
        return branch;
      });
      sendData(response, created, 201);
    },
  );
  router.patch(
    '/:id',
    requirePermission('branches:manage'),
    validateBody(updateBranchSchema),
    async (request, response) => {
      const id = uuidSchema.parse(request.params.id);
      const organizationId = request.authUser!.organization.id;
      const updated = await database.transaction(async (transaction) => {
        const current = await transaction.query<{
          id: string;
          name: string;
          code: string;
          address: string | null;
          phone: string | null;
          isActive: boolean;
        }>(
          `select id,name,code,address,phone,is_active as "isActive"
           from branches where id=$1 and organization_id=$2 for update`,
          [id, organizationId],
        );
        const before = current.rows[0];
        if (!before) throw notFound('Branch');
        const value = { ...before, ...request.body };
        if (value.code !== before.code) {
          const duplicate = await transaction.query(
            'select id from branches where organization_id=$1 and code=$2 and id<>$3',
            [organizationId, value.code, id],
          );
          if (duplicate.rowCount) {
            throw conflict('BRANCH_CODE_EXISTS', 'A branch already uses this branch code.');
          }
        }
        if (before.isActive && value.isActive === false) {
          const [otherActive, openShifts] = await Promise.all([
            transaction.query(
              'select count(*)::int as count from branches where organization_id=$1 and is_active and id<>$2',
              [organizationId, id],
            ),
            transaction.query(
              `select count(*)::int as count from register_shifts
               where organization_id=$1 and branch_id=$2 and status='open'`,
              [organizationId, id],
            ),
          ]);
          if (Number(openShifts.rows[0]?.count ?? 0) > 0) {
            throw conflict(
              'BRANCH_HAS_OPEN_SHIFTS',
              'Close every open cashier shift before deactivating this branch.',
            );
          }
          if (Number(otherActive.rows[0]?.count ?? 0) === 0) {
            throw conflict(
              'LAST_ACTIVE_BRANCH',
              'An organization must keep at least one active branch.',
            );
          }
        }
        const result = await transaction.query(
          `update branches set name=$3,code=$4,address=$5,phone=$6,is_active=$7,updated_at=now()
           where id=$1 and organization_id=$2
           returning id,name,code,address,phone,is_active as "isActive",
             created_at as "createdAt",updated_at as "updatedAt"`,
          [
            id,
            organizationId,
            value.name,
            value.code,
            value.address || null,
            value.phone || null,
            value.isActive,
          ],
        );
        const branch = result.rows[0]!;
        await transaction.query(
          `insert into audit_logs (
            organization_id,actor_id,branch_id,action,entity_type,entity_id,before_data,after_data
           ) values ($1,$2,$3,'branch.updated','branch',$3,$4::jsonb,$5::jsonb)`,
          [
            organizationId,
            request.authUser!.id,
            id,
            JSON.stringify(before),
            JSON.stringify(branch),
          ],
        );
        return branch;
      });
      sendData(response, updated);
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
