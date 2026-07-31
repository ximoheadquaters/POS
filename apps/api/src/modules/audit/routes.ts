import { Router } from 'express';
import { paginationSchema } from '@ximo/shared';
import type { Queryable } from '../../database/types.js';
import { requireModule, requirePermission } from '../../middleware/auth.js';
import { validateQuery } from '../../middleware/validation.js';
import { sendPage } from '../../shared/http.js';

export function auditRouter(database: Queryable): Router {
  const router = Router();
  router.use(requireModule('audit'));
  router.get(
    '/',
    requirePermission('audit:read'),
    validateQuery(paginationSchema),
    async (request, response) => {
      const query = request.query as any;
      const search = query.search ? String(query.search).trim() : null;
      const result = await database.query(
        `select al.id,al.action,al.entity_type as "entityType",al.entity_id as "entityId",
          al.before_data as "before",al.after_data as "after",al.metadata,
          al.created_at as "createdAt",coalesce(p.display_name, 'System User') as "actorName",
          coalesce(r.code, 'system') as "actorRole",b.name as "branchName",
          count(*) over()::int as total
         from audit_logs al
         left join profiles p on p.id=al.actor_id
         left join roles r on r.id=p.role_id
         left join branches b on b.id=al.branch_id
         where al.organization_id=$1
           and ($4::text is null or al.action ilike '%'||$4||'%' or al.entity_type ilike '%'||$4||'%' or coalesce(p.display_name, 'System User') ilike '%'||$4||'%' or coalesce(r.code, 'system') ilike '%'||$4||'%')
         order by al.created_at desc limit $2 offset $3`,
        [request.authUser!.organization.id, query.pageSize, (query.page - 1) * query.pageSize, search],
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
