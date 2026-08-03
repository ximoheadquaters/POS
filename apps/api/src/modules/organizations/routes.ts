import { Router } from 'express';
import { organizationProfileSchema } from '@ximo/shared';
import { z } from 'zod';
import type { Database } from '../../database/types.js';
import { requirePermission } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validation.js';
import { EntitlementService } from '../../services/entitlement-service.js';
import { badRequest, notFound, serviceUnavailable } from '../../shared/errors.js';
import { sendData } from '../../shared/http.js';
import type { AssetStorage } from '../../storage/assets.js';

const organizationLogoSchema = z.object({
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  base64: z.string().min(1).max(3_000_000),
});

export function organizationsRouter(database: Database, assetStorage?: AssetStorage): Router {
  const router = Router();
  const entitlementService = new EntitlementService(database);

  router.get('/current', requirePermission('organization:read'), async (request, response) => {
    const result = await database.query(
      `select o.id,o.name,o.slug,o.currency,o.timezone,
        coalesce(o.business_profile, 'retail') as "businessProfile",
        o.logo_path as "logoPath",
        o.created_at as "createdAt",coalesce(s.status::text, 'cancelled') as "subscriptionStatus",
        p.code as "planCode",p.name as "planName",
        (select count(*)::int from branches b where b.organization_id=o.id) as "branchCount",
        (select count(*)::int from branches b
          where b.organization_id=o.id and b.is_active) as "activeBranchCount",
        (select count(*)::int from profiles pr where pr.organization_id=o.id) as "userCount",
        (select count(*)::int from profiles pr
          where pr.organization_id=o.id and pr.is_active) as "activeUserCount",
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'id',b.id,'name',b.name,'code',b.code,'isActive',b.is_active
          ) order by b.is_active desc,b.name)
          from branches b where b.organization_id=o.id
        ),'[]'::jsonb) as branches
       from organizations o
       left join lateral (
         select sub.plan_id, sub.status
         from subscriptions sub
         where sub.organization_id = o.id
           and sub.status in ('trialing', 'active')
         order by sub.created_at desc, sub.id desc
         limit 1
       ) s on true
       left join plans p on p.id=s.plan_id where o.id=$1`,
      [request.authUser!.organization.id],
    );
    if (!result.rows[0]) throw notFound('Organization');
    sendData(response, {
      ...result.rows[0],
      enabledModules: request.authUser!.modules,
    });
  });
  router.post(
    '/current/logo',
    requirePermission('organization:update'),
    validateBody(organizationLogoSchema),
    async (request, response) => {
      if (!assetStorage) {
        throw serviceUnavailable(
          'ORGANIZATION_LOGO_UPLOAD_UNAVAILABLE',
          'Organization logo storage is not configured.',
        );
      }
      const bytes = Buffer.from(request.body.base64, 'base64');
      if (bytes.byteLength === 0 || bytes.byteLength > 2_000_000) {
        throw badRequest(
          'INVALID_ORGANIZATION_LOGO',
          'The compressed organization logo must be 2 MB or smaller.',
        );
      }
      const logoPath = await assetStorage.uploadOrganizationLogo({
        organizationId: request.authUser!.organization.id,
        mimeType: request.body.mimeType,
        bytes,
      });
      sendData(response, { logoPath });
    },
  );
  router.put(
    '/current',
    requirePermission('organization:update'),
    validateBody(organizationProfileSchema),
    async (request, response) => {
      const organizationId = request.authUser!.organization.id;
      const input = request.body;
      const updated = await database.transaction(async (transaction) => {
        const before = await transaction.query(
          `select id,name,slug,currency,timezone,logo_path as "logoPath",
            coalesce(business_profile, 'retail') as "businessProfile"
           from organizations where id=$1 for update`,
          [organizationId],
        );
        if (!before.rows[0]) throw notFound('Organization');
        const result = await transaction.query(
          `update organizations set name=$2,currency=$3,timezone=$4,logo_path=$5,business_profile=$6
           where id=$1
           returning id,name,slug,currency,timezone,logo_path as "logoPath",business_profile as "businessProfile"`,
          [organizationId, input.name, input.currency, input.timezone, input.logoPath, input.businessProfile],
        );
        await transaction.query(
          `update organization_settings set business_name=$2,updated_at=now()
           where organization_id=$1`,
          [organizationId, input.name],
        );
        await transaction.query(
          `insert into audit_logs (
            organization_id,actor_id,action,entity_type,entity_id,before_data,after_data
           ) values ($1,$2,'organization.updated','organization',$1,$3::jsonb,$4::jsonb)`,
          [
            organizationId,
            request.authUser!.id,
            JSON.stringify(before.rows[0]),
            JSON.stringify(result.rows[0]),
          ],
        );

        const enabledModules = await entitlementService.getEffectiveModules(
          organizationId,
          result.rows[0]!.businessProfile,
          transaction,
        );

        return {
          ...result.rows[0],
          enabledModules,
        };
      });
      sendData(response, updated);
    },
  );
  return router;
}
