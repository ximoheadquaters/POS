import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { loginSchema } from '@ximo/shared';
import { z } from 'zod';
import type { AuthActions, VerifyToken } from './auth/types.js';
import type { Database } from './database/types.js';
import { authenticate } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { validateBody } from './middleware/validation.js';
import { auditRouter } from './modules/audit/routes.js';
import { branchesRouter } from './modules/branches/routes.js';
import { customersRouter } from './modules/customers/routes.js';
import { inventoryRouter } from './modules/inventory/routes.js';
import { organizationsRouter } from './modules/organizations/routes.js';
import { categoriesRouter, productsRouter } from './modules/products/routes.js';
import { registersRouter } from './modules/registers/routes.js';
import { reportsRouter } from './modules/reports/routes.js';
import { returnsRouter } from './modules/returns/routes.js';
import { salesRouter } from './modules/sales/routes.js';
import { settingsRouter } from './modules/settings/routes.js';
import { usersRouter } from './modules/users/routes.js';
import { sendData } from './shared/http.js';

export interface AppDependencies {
  database: Database;
  verifyToken: VerifyToken;
  authActions: AuthActions;
}

export function createApp(dependencies: AppDependencies) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: true, credentials: false }));
  app.use(express.json({ limit: '1mb' }));
  app.use((request, response, next) => {
    response.locals.requestId = request.header('x-request-id') ?? randomUUID();
    response.setHeader('x-request-id', response.locals.requestId);
    next();
  });
  app.use(pinoHttp({ quietReqLogger: process.env.NODE_ENV === 'test' }));

  app.get('/health', async (_request, response) => {
    await dependencies.database.query('select 1');
    sendData(response, { status: 'ok' });
  });

  const auth = express.Router();
  auth.use(rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-8' }));
  auth.post('/login', validateBody(loginSchema), async (request, response) => {
    sendData(
      response,
      await dependencies.authActions.login(request.body.email, request.body.password),
    );
  });
  auth.post(
    '/password-reset',
    validateBody(z.object({ email: z.email() })),
    async (request, response) => {
      await dependencies.authActions.resetPassword(request.body.email);
      sendData(response, { accepted: true });
    },
  );
  app.use('/api/v1/auth', auth);

  const protectedApi = express.Router();
  protectedApi.use(authenticate(dependencies.database, dependencies.verifyToken));
  protectedApi.get('/auth/current', (request, response) => sendData(response, request.authUser));
  protectedApi.post('/auth/logout', (_request, response) =>
    sendData(response, { signedOut: true }),
  );
  protectedApi.use('/organizations', organizationsRouter(dependencies.database));
  protectedApi.use('/branches', branchesRouter(dependencies.database));
  protectedApi.use('/users', usersRouter(dependencies.database, dependencies.authActions));
  protectedApi.use('/categories', categoriesRouter(dependencies.database));
  protectedApi.use('/products', productsRouter(dependencies.database));
  protectedApi.use('/inventory', inventoryRouter(dependencies.database));
  protectedApi.use('/registers', registersRouter(dependencies.database));
  protectedApi.use('/shifts', registersRouter(dependencies.database));
  protectedApi.use('/sales', salesRouter(dependencies.database));
  protectedApi.use('/returns', returnsRouter(dependencies.database));
  protectedApi.use('/customers', customersRouter(dependencies.database));
  protectedApi.use('/reports', reportsRouter(dependencies.database));
  protectedApi.use('/settings', settingsRouter(dependencies.database));
  protectedApi.use('/audit', auditRouter(dependencies.database));
  app.use('/api/v1', protectedApi);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
