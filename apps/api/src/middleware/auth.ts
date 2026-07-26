import type { NextFunction, Request, Response } from 'express';
import type { ModuleCode, Permission, RoleCode } from '@ximo/shared';
import type { Queryable } from '../database/types.js';
import { forbidden, unauthorized } from '../shared/errors.js';
import type { VerifyToken } from '../auth/types.js';

interface ContextRow {
  id: string;
  email: string;
  display_name: string;
  organization_id: string;
  organization_name: string;
  currency: string;
  timezone: string;
  subscription_status: string;
  role: RoleCode;
  permissions: Permission[] | null;
  modules: ModuleCode[] | null;
  branches: Array<{ id: string; name: string; code: string }> | null;
}

const CONTEXT_SQL = `
select p.id, p.email, p.display_name, p.organization_id,
  o.name as organization_name, o.currency, o.timezone,
  coalesce(s.status::text, 'cancelled') as subscription_status, r.code as role,
  coalesce((
    select array_agg(distinct pe.code)
    from role_permissions rp join permissions pe on pe.id = rp.permission_id
    where rp.role_id = r.id
  ), '{}') as permissions,
  coalesce((
    select array_agg(distinct m.code)
    from modules m
    where coalesce(
      (select om.enabled from organization_modules om
       where om.organization_id = p.organization_id and om.module_id = m.id),
      exists (
        select 1 from subscriptions sx
        join plan_modules pm on pm.plan_id = sx.plan_id
        where sx.organization_id = p.organization_id and pm.module_id = m.id
          and sx.status in ('trialing','active')
      )
    )
  ), '{}') as modules,
  coalesce((
    select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'code', b.code) order by b.name)
    from branches b
    where b.organization_id = p.organization_id and b.is_active
      and (r.code in ('owner','administrator') or exists (
        select 1 from user_branches ub where ub.user_id = p.id and ub.branch_id = b.id
      ))
  ), '[]'::jsonb) as branches
from profiles p
join organizations o on o.id = p.organization_id
join roles r on r.id = p.role_id and r.organization_id = p.organization_id
left join subscriptions s on s.organization_id = p.organization_id
where p.id = $1 and p.is_active
`;

export function authenticate(db: Queryable, verifyToken: VerifyToken) {
  return async (request: Request, _response: Response, next: NextFunction) => {
    try {
      const header = request.header('authorization');
      if (!header?.startsWith('Bearer ')) throw unauthorized();
      const token = header.slice(7);
      const verified = await verifyToken(token);
      const result = await db.query<ContextRow>(CONTEXT_SQL, [verified.id]);
      const row = result.rows[0];
      if (!row) throw unauthorized('No active POS profile is linked to this account');
      request.authToken = token;
      request.authUser = {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        organization: {
          id: row.organization_id,
          name: row.organization_name,
          currency: row.currency,
          timezone: row.timezone,
          subscriptionStatus: row.subscription_status,
        },
        role: row.role,
        permissions: row.permissions ?? [],
        modules: row.modules ?? [],
        branches: row.branches ?? [],
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requirePermission(...permissions: Permission[]) {
  return (request: Request, _response: Response, next: NextFunction) => {
    const user = request.authUser;
    if (!user) return next(unauthorized());
    if (!permissions.some((permission) => user.permissions.includes(permission))) {
      return next(forbidden('PERMISSION_DENIED', 'Your role cannot perform this action'));
    }
    next();
  };
}

export function requireModule(module: ModuleCode) {
  return (request: Request, _response: Response, next: NextFunction) => {
    if (!request.authUser?.modules.includes(module)) {
      return next(forbidden('MODULE_DISABLED', `The ${module} module is not enabled`));
    }
    next();
  };
}

export function requireAnyModule(...modules: ModuleCode[]) {
  return (request: Request, _response: Response, next: NextFunction) => {
    if (!modules.some((module) => request.authUser?.modules.includes(module))) {
      return next(
        forbidden('MODULE_DISABLED', `One of these modules must be enabled: ${modules.join(', ')}`),
      );
    }
    next();
  };
}

export function requireBranchAccess(source: 'params' | 'query' | 'body' = 'params') {
  return (request: Request, _response: Response, next: NextFunction) => {
    const sourceValue = request[source] as Record<string, unknown>;
    const branchId = String(sourceValue.branchId ?? '');
    if (!branchId || !request.authUser?.branches.some((branch) => branch.id === branchId)) {
      return next(forbidden('BRANCH_ACCESS_DENIED', 'You do not have access to this branch'));
    }
    next();
  };
}
