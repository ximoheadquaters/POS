import { Router } from 'express';
import type { Queryable } from '../../database/types.js';
import { requirePermission } from '../../middleware/auth.js';
import { sendData } from '../../shared/http.js';

export function organizationsRouter(database: Queryable): Router {
  const router = Router();
  router.get('/current', requirePermission('organization:read'), async (request, response) => {
    const result = await database.query(
      `select o.id,o.name,o.slug,o.currency,o.timezone,o.logo_path as "logoPath",
        s.status as "subscriptionStatus",p.code as "planCode",p.name as "planName"
       from organizations o left join subscriptions s on s.organization_id=o.id
       left join plans p on p.id=s.plan_id where o.id=$1`,
      [request.authUser!.organization.id],
    );
    sendData(response, result.rows[0]);
  });
  return router;
}
