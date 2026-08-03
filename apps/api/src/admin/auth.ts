import type { NextFunction, Request, Response } from 'express';
import type { VerifyToken } from '../auth/types.js';
import type { Queryable } from '../database/types.js';
import { forbidden, unauthorized } from '../shared/errors.js';

export type PlatformAdminRole = 'viewer' | 'admin' | 'super_admin';

export interface PlatformAdmin {
  id: string;
  email: string;
  displayName: string;
  role: PlatformAdminRole;
}

const ROLE_HIERARCHY: Record<PlatformAdminRole, number> = {
  viewer: 0,
  admin: 1,
  super_admin: 2,
};

/**
 * Authenticate a platform admin via Supabase JWT.
 * Verifies the JWT, then looks up the user in platform_admins.
 * Rejects if the user is not a registered platform admin.
 */
export function authenticatePlatformAdmin(db: Queryable, verifyToken: VerifyToken) {
  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      const header = request.header('authorization');
      if (!header?.startsWith('Bearer ')) throw unauthorized();
      const token = header.slice(7);
      const verified = await verifyToken(token);

      const result = await db.query<{
        id: string;
        email: string;
        display_name: string;
        role: PlatformAdminRole;
        is_active: boolean;
      }>(
        `select id, email, display_name, role, is_active
         from platform_admins
         where id = $1 and is_active`,
        [verified.id],
      );
      const admin = result.rows[0];
      if (!admin || !admin.is_active) {
        throw forbidden(
          'PLATFORM_ADMIN_REQUIRED',
          'This endpoint requires a verified Ximo platform administrator account.',
        );
      }

      response.locals.platformAdmin = {
        id: admin.id,
        email: admin.email,
        displayName: admin.display_name,
        role: admin.role,
      } satisfies PlatformAdmin;

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Require a minimum platform admin role.
 * viewer < admin < super_admin
 */
export function requirePlatformAdminRole(minimumRole: PlatformAdminRole) {
  return (_request: Request, response: Response, next: NextFunction) => {
    const admin = response.locals.platformAdmin as PlatformAdmin | undefined;
    if (!admin || ROLE_HIERARCHY[admin.role] < ROLE_HIERARCHY[minimumRole]) {
      return next(
        forbidden(
          'INSUFFICIENT_PLATFORM_ROLE',
          `This action requires at least the '${minimumRole}' platform role.`,
        ),
      );
    }
    next();
  };
}
