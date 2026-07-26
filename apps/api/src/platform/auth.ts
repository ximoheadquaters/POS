import type { NextFunction, Request, Response } from 'express';
import type { Queryable } from '../database/types.js';
import { forbidden, unauthorized } from '../shared/errors.js';
import { hashPlatformToken, isPlatformToken } from './token.js';

export type PlatformScope = 'platform:read' | 'platform:write';

export interface PlatformApiClient {
  id: string;
  name: string;
  scopes: PlatformScope[];
}

export function authenticatePlatformClient(database: Queryable) {
  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      const authorization = request.header('authorization');
      if (!authorization?.startsWith('Bearer ')) {
        throw unauthorized('A platform API token is required');
      }

      const token = authorization.slice(7).trim();
      if (!isPlatformToken(token)) {
        throw unauthorized('The platform API token is invalid or expired');
      }

      const result = await database.query<PlatformApiClient>(
        `update platform_api_clients
         set last_used_at=now()
         where token_hash=$1 and is_active
           and (expires_at is null or expires_at > now())
         returning id,name,scopes`,
        [hashPlatformToken(token)],
      );
      const client = result.rows[0];
      if (!client) throw unauthorized('The platform API token is invalid or expired');

      response.locals.platformClient = client;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requirePlatformScope(scope: PlatformScope) {
  return (_request: Request, response: Response, next: NextFunction) => {
    const client = response.locals.platformClient as PlatformApiClient | undefined;
    if (!client?.scopes.includes(scope)) {
      return next(
        forbidden('PLATFORM_SCOPE_REQUIRED', `The platform API client requires ${scope}`),
      );
    }
    next();
  };
}
