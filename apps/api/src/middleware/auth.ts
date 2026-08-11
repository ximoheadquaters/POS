import type { NextFunction, Request, Response } from 'express';
import {
  type BusinessProfile,
  type ModuleCode,
  type Permission,
  type RoleCode,
} from '@ximo/shared';
import type { Queryable } from '../database/types.js';
import { forbidden, unauthorized } from '../shared/errors.js';
import type { VerifyToken } from '../auth/types.js';
import {
  EntitlementService,
  pruneDisabledDependentModules,
} from '../services/entitlement-service.js';

export { pruneDisabledDependentModules };

interface ContextRow {
  id: string;
  email: string;
  display_name: string;
  organization_id: string;
  organization_name: string;
  currency: string;
  timezone: string;
  business_profile: BusinessProfile;
  subscription_status: string;
  role: RoleCode;
  permissions: Permission[] | null;
  branches: Array<{ id: string; name: string; code: string }> | null;
  must_change_password: boolean;
}

export const CONTEXT_SQL = `
select p.id, p.email, p.display_name, p.organization_id,
  coalesce(p.must_change_password, false) as must_change_password,
  o.name as organization_name, o.currency, o.timezone,
  coalesce(o.business_profile, 'retail') as business_profile,
  coalesce(current_sub.status::text, 'cancelled') as subscription_status, r.code as role,
  coalesce((
    select array_agg(distinct pe.code)
    from role_permissions rp join permissions pe on pe.id = rp.permission_id
    where rp.role_id = r.id
  ), '{}') as permissions,
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
left join lateral (
  select sub.id, sub.plan_id, sub.status
  from subscriptions sub
  where sub.organization_id = p.organization_id
    and sub.status in ('trialing', 'active')
  order by sub.created_at desc, sub.id desc
  limit 1
) current_sub on true
where p.id = $1 and p.is_active
`;

export function authenticate(db: Queryable, verifyToken: VerifyToken) {
  const entitlementService = new EntitlementService(db);
  return async (request: Request, _response: Response, next: NextFunction) => {
    try {
      const header = request.header('authorization');
      if (!header?.startsWith('Bearer ')) throw unauthorized();
      const token = header.slice(7);
      const verified = await verifyToken(token);
      const result = await db.query<ContextRow>(CONTEXT_SQL, [verified.id]);
      const row = result.rows[0];
      if (!row) throw unauthorized('No active POS profile is linked to this account');
      const effectiveModules = await entitlementService.getEffectiveModules(
        row.organization_id,
        row.business_profile,
      );
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
          businessProfile: row.business_profile || 'retail',
          subscriptionStatus: row.subscription_status,
        },
        role: row.role,
        permissions: row.permissions ?? [],
        modules: effectiveModules,
        branches: row.branches ?? [],
        mustChangePassword: row.must_change_password,
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
