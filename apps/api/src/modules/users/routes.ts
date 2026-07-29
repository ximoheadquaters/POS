import { Router } from 'express';
import { z } from 'zod';
import {
  PERMISSIONS,
  createEmployeeSchema,
  roleCodeSchema,
  uuidSchema,
  type EmployeeRoleCode,
  type Permission,
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

const updateRolePermissionsSchema = z.object({
  permissions: z
    .array(z.enum(PERMISSIONS))
    .max(PERMISSIONS.length)
    .refine((values) => new Set(values).size === values.length, 'Select each permission only once'),
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

function assertCanManagePermissions(actorRole: RoleCode) {
  if (actorRole !== 'owner' && actorRole !== 'administrator') {
    throw forbidden(
      'ROLE_PERMISSION_MANAGEMENT_DENIED',
      'Only owners and administrators can change role permissions',
    );
  }
}

function assertCanAssignBranches(
  actorRole: RoleCode,
  actorBranchIds: string[],
  requestedBranchIds: string[],
) {
  if (actorRole === 'owner' || actorRole === 'administrator') return;
  const allowed = new Set(actorBranchIds);
  if (requestedBranchIds.some((branchId) => !allowed.has(branchId))) {
    throw forbidden(
      'BRANCH_ASSIGNMENT_DENIED',
      'You can only assign employees to branches you can access',
    );
  }
}

const userSelect = `
  select p.id,p.display_name as "displayName",p.email,p.is_active as "isActive",r.code as role,
    coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'code',b.code)
      order by b.name) filter (where b.id is not null),'[]') as branches
  from profiles p join roles r on r.id=p.role_id
  left join user_branches ub on ub.user_id=p.id
  left join branches b on b.id=ub.branch_id`;

export function usersRouter(database: Database, authActions: AuthActions): Router {
  const router = Router();
  router.get('/', requirePermission('users:read'), async (request, response) => {
    const result = await database.query(
      `${userSelect}
       where p.organization_id=$1 group by p.id,r.code order by p.display_name`,
      [request.authUser!.organization.id],
    );
    sendData(response, result.rows);
  });
  router.get('/roles', requirePermission('users:read'), async (request, response) => {
    const organizationId = request.authUser!.organization.id;
    const [roles, permissions] = await Promise.all([
      database.query<{
        id: string;
        code: RoleCode;
        name: string;
        isSystem: boolean;
        userCount: number;
        permissions: Permission[];
      }>(
        `select r.id,r.code,r.name,r.is_system as "isSystem",
          count(distinct pr.id)::int as "userCount",
          coalesce(array_agg(distinct pe.code order by pe.code)
            filter (where pe.code is not null),'{}') as permissions
         from roles r
         left join profiles pr on pr.role_id=r.id and pr.organization_id=r.organization_id
         left join role_permissions rp on rp.role_id=r.id
         left join permissions pe on pe.id=rp.permission_id
         where r.organization_id=$1
         group by r.id
         order by case r.code
           when 'owner' then 1 when 'administrator' then 2 when 'manager' then 3
           when 'cashier' then 4 when 'inventory_staff' then 5 else 6 end,r.name`,
        [organizationId],
      ),
      database.query<{ code: Permission; description: string }>(
        'select code,description from permissions order by code',
      ),
    ]);
    const canManagePermissions =
      request.authUser!.role === 'owner' || request.authUser!.role === 'administrator';
    sendData(response, {
      roles: roles.rows.map((role) => ({
        ...role,
        editable: canManagePermissions && role.code !== 'owner' && role.code !== 'administrator',
        assignable: assignableRoles(request.authUser!.role).includes(role.code as EmployeeRoleCode),
      })),
      permissions: permissions.rows,
    });
  });
  router.patch(
    '/roles/:id',
    requirePermission('users:manage'),
    validateBody(updateRolePermissionsSchema),
    async (request, response) => {
      assertCanManagePermissions(request.authUser!.role);
      const roleId = uuidSchema.parse(request.params.id);
      const organizationId = request.authUser!.organization.id;
      const permissions = request.body.permissions as Permission[];
      const updated = await database.transaction(async (tx) => {
        const existing = await tx.query<{ code: RoleCode; name: string }>(
          `select code,name from roles
           where id=$1 and organization_id=$2 for update`,
          [roleId, organizationId],
        );
        const role = existing.rows[0];
        if (!role) throw notFound('Role');
        if (role.code === 'owner' || role.code === 'administrator') {
          throw forbidden(
            'SYSTEM_ROLE_LOCKED',
            'Owner and administrator permissions are locked to full access',
          );
        }
        await tx.query('delete from role_permissions where role_id=$1', [roleId]);
        if (permissions.length) {
          const inserted = await tx.query(
            `insert into role_permissions (role_id,permission_id)
             select $1,p.id from permissions p where p.code=any($2::text[])`,
            [roleId, permissions],
          );
          if (inserted.rowCount !== permissions.length) {
            throw badRequest('INVALID_PERMISSION', 'One or more permissions are invalid');
          }
        }
        await tx.query(
          `insert into audit_logs (
            organization_id,actor_id,action,entity_type,entity_id,after_data
           ) values ($1,$2,'role.permissions_updated','role',$3,$4::jsonb)`,
          [
            organizationId,
            request.authUser!.id,
            roleId,
            JSON.stringify({ code: role.code, permissions }),
          ],
        );
        return { id: roleId, code: role.code, name: role.name, permissions };
      });
      sendData(response, updated);
    },
  );
  router.get('/:id', requirePermission('users:read'), async (request, response) => {
    const userId = uuidSchema.parse(request.params.id);
    const result = await database.query(
      `${userSelect}
       where p.organization_id=$1 and p.id=$2 group by p.id,r.code`,
      [request.authUser!.organization.id, userId],
    );
    if (!result.rows[0]) throw notFound('User');
    sendData(response, result.rows[0]);
  });
  router.post(
    '/',
    requirePermission('users:manage'),
    validateBody(createEmployeeSchema),
    async (request, response) => {
      assertCanManageRole(request.authUser!.role, request.body.role);
      const organizationId = request.authUser!.organization.id;
      assertCanAssignBranches(
        request.authUser!.role,
        request.authUser!.branches.map((branch) => branch.id),
        request.body.branchIds,
      );
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
        const existing = await tx.query<{ role: RoleCode; branchIds: string[] }>(
          `select r.code as role,
            coalesce((select array_agg(ub.branch_id) from user_branches ub
              where ub.user_id=p.id and ub.organization_id=p.organization_id),'{}')
              as "branchIds"
           from profiles p join roles r on r.id=p.role_id
           where p.id=$1 and p.organization_id=$2 for update of p`,
          [userId, organizationId],
        );
        const target = existing.rows[0];
        if (!target) throw notFound('User');
        assertCanManageRole(request.authUser!.role, target.role);
        assertCanAssignBranches(
          request.authUser!.role,
          request.authUser!.branches.map((branch) => branch.id),
          target.branchIds,
        );
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
          assertCanAssignBranches(
            request.authUser!.role,
            request.authUser!.branches.map((branch) => branch.id),
            request.body.branchIds,
          );
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
