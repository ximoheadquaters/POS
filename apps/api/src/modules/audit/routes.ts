import { Router } from 'express';
import { paginationSchema } from '@ximo/shared';
import type { Queryable } from '../../database/types.js';
import { requirePermission } from '../../middleware/auth.js';
import { validateQuery } from '../../middleware/validation.js';
import { sendPage } from '../../shared/http.js';

export function auditRouter(database: Queryable): Router {
  const router = Router();
  router.get(
    '/',
    requirePermission('audit:read'),
    validateQuery(paginationSchema),
    async (request, response) => {
      const query = request.query as any;
      const result = await database.query(
        `select al.id,al.action,al.entity_type as "entityType",al.entity_id as "entityId",
          al.before_data as "before",al.after_data as "after",al.metadata,
          al.created_at as "createdAt",p.display_name as "actorName",b.name as "branchName",
          count(*) over()::int as total
         from audit_logs al join profiles p on p.id=al.actor_id
         left join branches b on b.id=al.branch_id
         where al.organization_id=$1 order by al.created_at desc limit $2 offset $3`,
        [request.authUser!.organization.id, query.pageSize, (query.page - 1) * query.pageSize],
      );
      const total = result.rows[0]?.total ?? 0;
      sendPage(
        response,
        result.rows.map(({ total: _total, ...row }) => row),
        query.page,
        query.pageSize,
        total,
      );
    },
  );
  return router;
}
