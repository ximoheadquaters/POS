import { Router } from 'express';
import { z } from 'zod';
import {
  createEmployeeSchema,
  roleCodeSchema,
  uuidSchema,
  type EmployeeRoleCode,
  type RoleCode,
} from '@ximo/shared';
import type { AuthActions } from '../../auth/types.js';
import type { Database } from '../../database/types.js';
import { requirePermission } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validation.js';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors.js';
import { sendData } from '../../shared/http.js';

const updateUserSchema = z.object({
  role: roleCodeSchema.optional(),
  isActive: z.boolean().optional(),
  branchIds: z.array(uuidSchema).optional(),
});

function assignableRoles(actorRole: RoleCode): readonly EmployeeRoleCode[] {
  if (actorRole === 'owner' || actorRole === 'administrator') {
    return ['manager', 'cashier', 'inventory_staff'];
  }
  if (actorRole === 'manager') return ['cashier', 'inventory_staff'];
  return [];
}

function assertCanManageRole(actorRole: RoleCode, targetRole: RoleCode) {
  if (!assignableRoles(actorRole).includes(targetRole as EmployeeRoleCode)) {
    throw forbidden(
      'ROLE_MANAGEMENT_DENIED',
      'You cannot create or modify an employee with this role',
    );
  }
}

export function usersRouter(database: Database, authActions: AuthActions): Router {
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
  router.post(
    '/',
    requirePermission('users:manage'),
    validateBody(createEmployeeSchema),
    async (request, response) => {
      assertCanManageRole(request.authUser!.role, request.body.role);
      const organizationId = request.authUser!.organization.id;
      const branches = await database.query<{ id: string; name: string; code: string }>(
        `select id,name,code from branches
         where organization_id=$1 and is_active and id=any($2::uuid[])
         order by name`,
        [organizationId, request.body.branchIds],
      );
      if (branches.rowCount !== request.body.branchIds.length) {
        throw badRequest('INVALID_BRANCH_ASSIGNMENT', 'One or more selected branches are invalid');
      }

      const authUser = await authActions.createUser({
        email: request.body.email,
        password: request.body.temporaryPassword,
        displayName: request.body.displayName,
      });
      try {
        const employee = await database.transaction(async (tx) => {
          const profile = await tx.query(
            `insert into profiles (id,organization_id,role_id,display_name,email)
             select $1,$2,r.id,$3,$4 from roles r
             where r.organization_id=$2 and r.code=$5
             returning id,display_name as "displayName",email,is_active as "isActive"`,
            [
              authUser.id,
              organizationId,
              request.body.displayName,
              authUser.email,
              request.body.role,
            ],
          );
          if (!profile.rows[0]) throw notFound('Role');
          await tx.query(
            `insert into user_branches (organization_id,user_id,branch_id)
             select $1,$2,b.id from branches b
             where b.organization_id=$1 and b.id=any($3::uuid[])`,
            [organizationId, authUser.id, request.body.branchIds],
          );
          const auditData = {
            displayName: request.body.displayName,
            email: authUser.email,
            role: request.body.role,
            branchIds: request.body.branchIds,
          };
          await tx.query(
            `insert into audit_logs (
              organization_id,actor_id,action,entity_type,entity_id,after_data
             ) values ($1,$2,'user.created','profile',$3,$4::jsonb)`,
            [organizationId, request.authUser!.id, authUser.id, JSON.stringify(auditData)],
          );
          return {
            ...profile.rows[0],
            role: request.body.role,
            branches: branches.rows,
          };
        });
        sendData(response, employee, 201);
      } catch (error) {
        try {
          await authActions.deleteUser(authUser.id);
        } catch {
          // Preserve the database error. An orphaned Auth user can be removed by an administrator.
        }
        throw error;
      }
    },
  );
  router.patch(
    '/:id',
    requirePermission('users:manage'),
    validateBody(updateUserSchema),
    async (request, response) => {
      const userId = uuidSchema.parse(request.params.id);
      const organizationId = request.authUser!.organization.id;
      if (userId === request.authUser!.id) {
        throw badRequest(
          'SELF_MANAGEMENT_DENIED',
          'Use another administrator to modify your account',
        );
      }
      const result = await database.transaction(async (tx) => {
        const existing = await tx.query<{ role: RoleCode }>(
          `select r.code as role from profiles p join roles r on r.id=p.role_id
           where p.id=$1 and p.organization_id=$2 for update of p`,
          [userId, organizationId],
        );
        const target = existing.rows[0];
        if (!target) throw notFound('User');
        assertCanManageRole(request.authUser!.role, target.role);
        if (request.body.role) {
          assertCanManageRole(request.authUser!.role, request.body.role);
          await tx.query(
            `update profiles set role_id=(select id from roles where organization_id=$2 and code=$3),
             updated_at=now() where id=$1 and organization_id=$2`,
            [userId, organizationId, request.body.role],
          );
        }
        if (request.body.isActive !== undefined) {
          if (!request.body.isActive) {
            const activeShift = await tx.query(
              `select 1 from register_shifts
               where organization_id=$1 and cashier_id=$2 and status='open'`,
              [organizationId, userId],
            );
            if (activeShift.rowCount) {
              throw conflict(
                'USER_HAS_OPEN_SHIFT',
                'Close this employee’s active shift before deactivating the account',
              );
            }
          }
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
