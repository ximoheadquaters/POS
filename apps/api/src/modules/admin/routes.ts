import { Router } from 'express';
import type { VerifyToken } from '../../auth/types.js';
import type { Database } from '../../database/types.js';
import {
  authenticatePlatformAdmin,
  type PlatformAdmin,
} from '../../admin/auth.js';
import { sendData } from '../../shared/http.js';

export function adminRouter(database: Database, verifyToken: VerifyToken): Router {
  const router = Router();

  // All admin routes require a verified platform admin session
  router.use(authenticatePlatformAdmin(database, verifyToken));

  // Current platform admin identity
  router.get('/current', (request, response) => {
    const admin = response.locals.platformAdmin as PlatformAdmin;
    sendData(response, admin);
  });

  return router;
}
