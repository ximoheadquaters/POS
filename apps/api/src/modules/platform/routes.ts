import type { Request, Response } from 'express';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { businessProfileSchema, moduleCodeSchema, paginationSchema, uuidSchema } from '@ximo/shared';
import { z } from 'zod';
import type { AuthActions } from '../../auth/types.js';
import type { Database, Queryable } from '../../database/types.js';
import { validateBody, validateQuery } from '../../middleware/validation.js';
import {
  authenticatePlatformClient,
  requirePlatformScope,
  type PlatformApiClient,
} from '../../platform/auth.js';
import {
  PlatformProvisioningService,
  provisionOrganizationRequestSchema,
} from '../../platform/provisioning-service.js';
import { OwnerInvitationService } from '../../platform/owner-invitation-service.js';
import { EntitlementService } from '../../services/entitlement-service.js';
import { badRequest, notFound } from '../../shared/errors.js';
import { sendData, sendPage } from '../../shared/http.js';

const subscriptionStatusSchema = z.enum(['trialing', 'active', 'past_due', 'cancelled']);

const organizationListQuery = paginationSchema.extend({
  planCode: z.string().trim().min(1).max(80).optional(),
  status: subscriptionStatusSchema.optional(),
});

const updateSubscriptionSchema = z.object({
  planCode: z.string().trim().min(1).max(80),
  status: subscriptionStatusSchema,
  trialEndsAt: z.iso.datetime({ offset: true }).nullable().optional(),
  currentPeriodEndsAt: z.iso.datetime({ offset: true }).nullable().optional(),
});

const moduleOverrideSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().trim().min(1, 'Reason is required').max(1000),
});

const updatePlanModulesSchema = z.object({
  moduleCodes: z.array(moduleCodeSchema).max(200),
});

const auditQuerySchema = paginationSchema.extend({
  organizationId: uuidSchema.optional(),
});

const MODULE_STATUS_SQL = `
select m.code,m.name,m.description,
  (pm.module_id is not null) as "includedInPlan",
  om.enabled as "overrideEnabled",om.reason as "overrideReason",
  coalesce(
    om.enabled,
    s.status in ('trialing','active') and pm.module_id is not null,
    false
  ) as "effectiveEnabled"
from organizations o
left join subscriptions s on s.organization_id=o.id
cross join modules m
left join plan_modules pm on pm.plan_id=s.plan_id and pm.module_id=m.id
left join organization_modules om
  on om.organization_id=o.id and om.module_id=m.id
where o.id=$1`;

function platformClient(response: Response): PlatformApiClient {
  return response.locals.platformClient as PlatformApiClient;
}

function auditMetadata(request: Request, response: Response): Record<string, string> {
  const actorId = request.header('x-platform-actor-id')?.trim().slice(0, 200);
  const actorEmail = request.header('x-platform-actor-email')?.trim().slice(0, 320);
  return {
    ...(actorId ? { actorId } : {}),
    ...(actorEmail ? { actorEmail } : {}),
    requestId: String(response.locals.requestId ?? ''),
  };
}

async function ensureOrganization(database: Queryable, organizationId: string) {
  const organization = await database.query('select id from organizations where id=$1', [
    organizationId,
  ]);
  if (!organization.rows[0]) throw notFound('Organization');
}

async function moduleStatus(database: Queryable, organizationId: string, moduleCode?: string) {
  await database.query(
    `insert into modules (code, name, description) values
      ('stock_transfers', 'Stock Transfers', 'Transfer inventory items between multiple branches with dispatch and receiving tracking.')
     on conflict (code) do update set name=excluded.name, description=excluded.description`,
  );
  const result = await database.query(
    `${MODULE_STATUS_SQL}
     ${moduleCode ? 'and m.code=$2' : ''}
     order by m.name`,
    moduleCode ? [organizationId, moduleCode] : [organizationId],
  );
  return moduleCode ? result.rows[0] : result.rows;
}

export function platformRouter(database: Database, authActions: AuthActions): Router {
  const router = Router();
  const provisioning = new PlatformProvisioningService(database, authActions);
  const ownerInvitations = new OwnerInvitationService(database, authActions);
  const entitlementService = new EntitlementService(database);
  router.use(
    rateLimit({
      windowMs: 60_000,
      limit: 180,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
    authenticatePlatformClient(database),
  );

  router.get('/plans', requirePlatformScope('platform:read'), async (_request, response) => {
    const result = await database.query(
      `select p.code,p.name,p.description,p.price_monthly::text as "priceMonthly",
          p.billing_interval as "billingInterval",p.is_active as "isActive",
          p.is_available_for_onboarding as "isAvailableForOnboarding",
          p.allowed_onboarding_statuses::text[] as "allowedOnboardingStatuses",
          coalesce(
            jsonb_agg(jsonb_build_object('code',m.code,'name',m.name) order by m.name)
              filter (where m.id is not null),
            '[]'::jsonb
          ) as modules
         from plans p
         left join plan_modules pm on pm.plan_id=p.id
         left join modules m on m.id=pm.module_id
         group by p.id order by p.price_monthly,p.name`,
    );
    sendData(response, result.rows);
  });

  router.put(
    '/plans/:planCode/modules',
    requirePlatformScope('platform:write'),
    validateBody(updatePlanModulesSchema),
    async (request, response) => {
      const planCode = z.string().trim().min(1).max(80).parse(request.params.planCode);
      const { moduleCodes } = request.body as z.infer<typeof updatePlanModulesSchema>;
      const uniqueCodes = [...new Set(moduleCodes)];
      const client = platformClient(response);

      const updated = await database.transaction(async (transaction) => {
        const plan = await transaction.query<{ id: string; code: string; name: string }>(
          `select p.id, p.code, p.name
           from plans p
           join applications application
             on application.id = p.application_id and application.code = 'ximo_pos'
           where p.code = $1
           for update of p`,
          [planCode],
        );
        if (!plan.rows[0]) throw notFound('Active plan');

        if (uniqueCodes.length > 0) {
          const modules = await transaction.query<{ id: string; code: string }>(
            `select m.id, m.code
             from modules m
             join applications application
               on application.id = m.application_id and application.code = 'ximo_pos'
             where m.code = any($1::text[])`,
            [uniqueCodes],
          );
          if (modules.rows.length !== uniqueCodes.length) {
            const found = new Set(modules.rows.map((row) => row.code));
            const missing = uniqueCodes.filter((code) => !found.has(code));
            throw badRequest(
              'INVALID_MODULE_CODES',
              `Unknown module code(s): ${missing.join(', ')}`,
            );
          }

          await transaction.query('delete from plan_modules where plan_id = $1', [plan.rows[0].id]);
          await transaction.query(
            `insert into plan_modules (plan_id, module_id)
             select $1, m.id
             from modules m
             join applications application
               on application.id = m.application_id and application.code = 'ximo_pos'
             where m.code = any($2::text[])`,
            [plan.rows[0].id, uniqueCodes],
          );

          await transaction.query(
            `delete from plan_entitlements pe
             using application_entitlements ae
             where pe.plan_id = $1
               and pe.entitlement_id = ae.id
               and ae.code like 'module.%'`,
            [plan.rows[0].id],
          );
          await transaction.query(
            `insert into plan_entitlements (plan_id, entitlement_id, value)
             select $1, ae.id, 'true'::jsonb
             from modules m
             join applications application
               on application.id = m.application_id and application.code = 'ximo_pos'
             join application_entitlements ae
               on ae.application_id = application.id
              and ae.code = 'module.' || m.code
             where m.code = any($2::text[])
             on conflict (plan_id, entitlement_id) do update set
               value = excluded.value,
               updated_at = now()`,
            [plan.rows[0].id, uniqueCodes],
          );
        } else {
          await transaction.query('delete from plan_modules where plan_id = $1', [plan.rows[0].id]);
          await transaction.query(
            `delete from plan_entitlements pe
             using application_entitlements ae
             where pe.plan_id = $1
               and pe.entitlement_id = ae.id
               and ae.code like 'module.%'`,
            [plan.rows[0].id],
          );
        }

        const modules = await transaction.query<{ code: string; name: string }>(
          `select m.code, m.name
           from plan_modules pm
           join modules m on m.id = pm.module_id
           where pm.plan_id = $1
           order by m.name`,
          [plan.rows[0].id],
        );

        await transaction.query(
          `insert into platform_audit_logs (
            api_client_id, action, before_data, after_data, metadata
           ) values ($1, 'plan.modules.updated', $2::jsonb, $3::jsonb, $4::jsonb)`,
          [
            client.id,
            JSON.stringify({ planCode: plan.rows[0].code }),
            JSON.stringify({
              planCode: plan.rows[0].code,
              moduleCodes: modules.rows.map((row) => row.code),
            }),
            JSON.stringify(auditMetadata(request, response)),
          ],
        );

        return {
          code: plan.rows[0].code,
          name: plan.rows[0].name,
          modules: modules.rows,
        };
      });

      sendData(response, updated);
    },
  );

  router.get('/modules', requirePlatformScope('platform:read'), async (_request, response) => {
    await database.query(
      `insert into modules (code, name, description) values
        ('stock_transfers', 'Stock Transfers', 'Transfer inventory items between multiple branches with dispatch and receiving tracking.')
       on conflict (code) do update set name=excluded.name, description=excluded.description`,
    );
    const result = await database.query('select code,name,description from modules order by name');
    sendData(response, result.rows);
  });

  router.get(
    '/organizations',
    requirePlatformScope('platform:read'),
    validateQuery(organizationListQuery),
    async (request, response) => {
      const { page, pageSize, search, planCode, status } = request.query as unknown as z.infer<
        typeof organizationListQuery
      >;
      const result = await database.query(
        `select o.id,o.name,o.slug,o.currency,o.timezone,o.logo_path as "logoPath",
          p.code as "planCode",p.name as "planName",
          coalesce(s.status::text,'cancelled') as "subscriptionStatus",
          s.trial_ends_at as "trialEndsAt",s.current_period_ends_at as "currentPeriodEndsAt",
          (
            select count(*)::int from modules m
            left join plan_modules pm on pm.plan_id=s.plan_id and pm.module_id=m.id
            left join organization_modules om
              on om.organization_id=o.id and om.module_id=m.id
            where coalesce(
              om.enabled,
              s.status in ('trialing','active') and pm.module_id is not null,
              false
            )
          ) as "enabledModuleCount",
          count(*) over()::int as total
         from organizations o
         left join subscriptions s on s.organization_id=o.id
         left join plans p on p.id=s.plan_id
         where ($1::text is null or o.name ilike '%'||$1||'%' or o.slug ilike '%'||$1||'%')
           and ($2::text is null or p.code=$2)
           and ($3::subscription_status is null or
             coalesce(s.status,'cancelled'::subscription_status)=$3)
         order by o.name limit $4 offset $5`,
        [search ?? null, planCode ?? null, status ?? null, pageSize, (page - 1) * pageSize],
      );
      const total = result.rows[0]?.total ?? 0;
      sendPage(
        response,
        result.rows.map(({ total: _total, ...row }) => row),
        page,
        pageSize,
        total,
      );
    },
  );

  router.post(
    '/organizations',
    requirePlatformScope('platform:write'),
    validateBody(provisionOrganizationRequestSchema),
    async (request, response) => {
      const idempotencyKey = request.header('idempotency-key')?.trim();
      if (!idempotencyKey) {
        throw badRequest(
          'MISSING_IDEMPOTENCY_KEY',
          'Idempotency-Key is required for organization provisioning',
        );
      }
      if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
        throw badRequest(
          'INVALID_IDEMPOTENCY_KEY',
          'Idempotency-Key must contain between 8 and 200 characters',
        );
      }
      const result = await provisioning.provision(request.body, {
        apiClient: platformClient(response),
        idempotencyKey,
        auditMetadata: auditMetadata(request, response),
      });
      if (result.replayed) response.setHeader('idempotent-replayed', 'true');
      sendData(response, result.data, result.replayed ? 200 : 201);
    },
  );

const updateOrganizationProfileSchema = z.object({
  businessProfile: businessProfileSchema,
});

  router.patch(
    '/organizations/:organizationId/profile',
    requirePlatformScope('platform:write'),
    validateBody(updateOrganizationProfileSchema),
    async (request, response) => {
      const organizationId = uuidSchema.parse(request.params.organizationId);
      const { businessProfile } = request.body as z.infer<typeof updateOrganizationProfileSchema>;
      await ensureOrganization(database, organizationId);

      const updated = await database.transaction(async (transaction) => {
        const before = await transaction.query(
          `select id,name,slug,currency,timezone,logo_path as "logoPath",
            coalesce(business_profile, 'retail') as "businessProfile"
           from organizations where id=$1 for update`,
          [organizationId],
        );

        const result = await transaction.query(
          `update organizations set business_profile=$2, updated_at=now()
           where id=$1
           returning id,name,slug,currency,timezone,logo_path as "logoPath",business_profile as "businessProfile"`,
          [organizationId, businessProfile],
        );

        const client = platformClient(response);
        await transaction.query(
          `insert into platform_audit_logs (
            platform_api_client_id, action, target_type, target_id, details
           ) values ($1, 'organization.business_profile.updated', 'organization', $2, $3::jsonb)`,
          [
            client.id,
            organizationId,
            JSON.stringify({
              before: before.rows[0],
              after: result.rows[0],
              metadata: auditMetadata(request, response),
            }),
          ],
        );

        const enabledModules = await entitlementService.getEffectiveModules(
          organizationId,
          businessProfile,
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

  router.get(
    '/organizations/:organizationId/modules',
    requirePlatformScope('platform:read'),
    async (request, response) => {
      const organizationId = uuidSchema.parse(request.params.organizationId);
      await ensureOrganization(database, organizationId);
      sendData(response, await moduleStatus(database, organizationId));
    },
  );

  router.get(
    '/organizations/:organizationId',
    requirePlatformScope('platform:read'),
    async (request, response) => {
      const organizationId = uuidSchema.parse(request.params.organizationId);
      const result = await database.query(
        `select o.id,o.name,o.slug,o.currency,o.timezone,o.logo_path as "logoPath",
          coalesce(o.business_profile, 'retail') as "businessProfile",
          o.created_at as "createdAt",p.code as "planCode",p.name as "planName",
          p.price_monthly::text as "priceMonthly",
          coalesce(s.status::text,'cancelled') as "subscriptionStatus",
          s.trial_ends_at as "trialEndsAt",s.current_period_ends_at as "currentPeriodEndsAt",
          (select count(*)::int from branches b where b.organization_id=o.id) as "branchCount",
          (select count(*)::int from profiles pr where pr.organization_id=o.id) as "userCount"
         from organizations o
         left join subscriptions s on s.organization_id=o.id
         left join plans p on p.id=s.plan_id
         where o.id=$1`,
        [organizationId],
      );
      if (!result.rows[0]) throw notFound('Organization');

      const ownerResult = await database.query<{
        id: string;
        email: string;
        displayName: string;
        createdAt: string;
        invitationSentAt: string | null;
      }>(
        `select p.id,p.email,p.display_name as "displayName",p.created_at as "createdAt",
          p.invitation_sent_at as "invitationSentAt"
         from profiles p
         join roles r on r.id=p.role_id and r.organization_id=p.organization_id
         where p.organization_id=$1 and r.code='owner'
         order by p.created_at limit 1`,
        [organizationId],
      );
      const owner = ownerResult.rows[0];
      let authOwner:
        | { createdAt: string; invitedAt: string | null; lastSignInAt: string | null }
        | null
        | undefined;
      if (owner) {
        try {
          authOwner = await authActions.getUser(owner.id);
        } catch {
          // Organization details remain available if the external Auth provider is unavailable.
          authOwner = undefined;
        }
      }
      const invitedAt = authOwner?.invitedAt ?? owner?.invitationSentAt ?? null;
      const lastSignInAt = authOwner?.lastSignInAt ?? null;
      sendData(response, {
        ...result.rows[0],
        owner: owner
          ? {
              email: owner.email,
              displayName: owner.displayName,
              invitationStatus: lastSignInAt ? 'accepted' : invitedAt ? 'pending' : 'unknown',
              invitedAt,
              createdAt: authOwner?.createdAt ?? owner.createdAt,
              lastSignInAt,
            }
          : null,
      });
    },
  );

  router.post(
    '/organizations/:organizationId/owner-invitation/resend',
    requirePlatformScope('platform:write'),
    async (request, response) => {
      const organizationId = uuidSchema.parse(request.params.organizationId);
      const result = await ownerInvitations.resend(organizationId, {
        apiClient: platformClient(response),
        auditMetadata: auditMetadata(request, response),
      });
      sendData(response, result, 202);
    },
  );

  router.patch(
    '/organizations/:organizationId/subscription',
    requirePlatformScope('platform:write'),
    validateBody(updateSubscriptionSchema),
    async (request, response) => {
      const organizationId = uuidSchema.parse(request.params.organizationId);
      const input = request.body as z.infer<typeof updateSubscriptionSchema>;
      const client = platformClient(response);
      const subscription = await database.transaction(async (transaction) => {
        const organization = await transaction.query(
          'select id from organizations where id=$1 for update',
          [organizationId],
        );
        if (!organization.rows[0]) throw notFound('Organization');

        const plan = await transaction.query<{ id: string }>(
          'select id from plans where code=$1 and is_active',
          [input.planCode],
        );
        if (!plan.rows[0]) throw notFound('Active plan');

        const before = await transaction.query(
          `select p.code as "planCode",s.status::text,
            s.trial_ends_at as "trialEndsAt",s.current_period_ends_at as "currentPeriodEndsAt"
           from subscriptions s join plans p on p.id=s.plan_id
           where s.organization_id=$1`,
          [organizationId],
        );
        const trialEndsAt =
          input.trialEndsAt === undefined
            ? (before.rows[0]?.trialEndsAt ?? null)
            : input.trialEndsAt;
        const currentPeriodEndsAt =
          input.currentPeriodEndsAt === undefined
            ? (before.rows[0]?.currentPeriodEndsAt ?? null)
            : input.currentPeriodEndsAt;
        const updated = await transaction.query(
          `insert into subscriptions (
            organization_id,plan_id,status,trial_ends_at,current_period_ends_at
           ) values ($1,$2,$3,$4,$5)
           on conflict (organization_id) do update set
             plan_id=excluded.plan_id,status=excluded.status,
             trial_ends_at=excluded.trial_ends_at,
             current_period_ends_at=excluded.current_period_ends_at,
             updated_at=now()
           returning id,status::text,
             trial_ends_at as "trialEndsAt",current_period_ends_at as "currentPeriodEndsAt"`,
          [organizationId, plan.rows[0].id, input.status, trialEndsAt, currentPeriodEndsAt],
        );
        const after = { ...updated.rows[0], planCode: input.planCode };
        await transaction.query(
          `insert into platform_audit_logs (
            api_client_id,organization_id,action,before_data,after_data,metadata
           ) values ($1,$2,'subscription.updated',$3::jsonb,$4::jsonb,$5::jsonb)`,
          [
            client.id,
            organizationId,
            JSON.stringify(before.rows[0] ?? null),
            JSON.stringify(after),
            JSON.stringify(auditMetadata(request, response)),
          ],
        );
        return after;
      });
      sendData(response, subscription);
    },
  );

  router.put(
    '/organizations/:organizationId/modules/:moduleCode',
    requirePlatformScope('platform:write'),
    validateBody(moduleOverrideSchema),
    async (request, response) => {
      const organizationId = uuidSchema.parse(request.params.organizationId);
      let moduleCode = String(request.params.moduleCode || '').trim();
      if (moduleCode === 'stock-transfers') moduleCode = 'stock_transfers';
      const input = request.body as z.infer<typeof moduleOverrideSchema>;
      const client = platformClient(response);
      const status = await database.transaction(async (transaction) => {
        await ensureOrganization(transaction, organizationId);
        let moduleResult = await transaction.query<{ id: string }>(
          'select id from modules where code=$1',
          [moduleCode],
        );
        if (!moduleResult.rows[0]) {
          moduleResult = await transaction.query<{ id: string }>(
            `insert into modules (code, name, description) values ($1, $2, $3)
             on conflict (code) do update set name=excluded.name
             returning id`,
            [
              moduleCode,
              moduleCode === 'stock_transfers'
                ? 'Stock Transfers'
                : moduleCode.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()),
              '',
            ],
          );
        }

        const moduleId = moduleResult.rows[0]!.id;
        const before = await transaction.query(
          `select enabled,reason from organization_modules
           where organization_id=$1 and module_id=$2`,
          [organizationId, moduleId],
        );
        const after = {
          moduleCode,
          enabled: input.enabled,
          reason: input.reason,
        };
        await transaction.query(
          `insert into organization_modules (
            organization_id,module_id,enabled,reason,updated_at
           ) values ($1,$2,$3,$4,now())
           on conflict (organization_id,module_id) do update set
             enabled=excluded.enabled,reason=excluded.reason,updated_at=now()`,
          [organizationId, moduleId, input.enabled, input.reason],
        );
        await transaction.query(
          `insert into platform_audit_logs (
            api_client_id,organization_id,action,before_data,after_data,metadata
           ) values ($1,$2,'organization.module.overridden',$3::jsonb,$4::jsonb,$5::jsonb)`,
          [
            client.id,
            organizationId,
            JSON.stringify(before.rows[0] ?? null),
            JSON.stringify(after),
            JSON.stringify(auditMetadata(request, response)),
          ],
        );
        return moduleStatus(transaction, organizationId, moduleCode);
      });
      sendData(response, status);
    },
  );

  router.delete(
    '/organizations/:organizationId/modules/:moduleCode',
    requirePlatformScope('platform:write'),
    async (request, response) => {
      const organizationId = uuidSchema.parse(request.params.organizationId);
      let moduleCode = String(request.params.moduleCode || '').trim();
      if (moduleCode === 'stock-transfers') moduleCode = 'stock_transfers';
      const client = platformClient(response);
      const status = await database.transaction(async (transaction) => {
        await ensureOrganization(transaction, organizationId);
        const removed = await transaction.query(
          `delete from organization_modules om using modules m
           where om.organization_id=$1 and om.module_id=m.id and m.code=$2
           returning om.enabled,om.reason`,
          [organizationId, moduleCode],
        );
        if (removed.rows[0]) {
          await transaction.query(
            `insert into platform_audit_logs (
              api_client_id,organization_id,action,before_data,after_data,metadata
             ) values ($1,$2,'organization.module.override_removed',$3::jsonb,$4::jsonb,$5::jsonb)`,
            [
              client.id,
              organizationId,
              JSON.stringify({ moduleCode, ...removed.rows[0] }),
              JSON.stringify({ moduleCode, followsPlan: true }),
              JSON.stringify(auditMetadata(request, response)),
            ],
          );
        }
        return moduleStatus(transaction, organizationId, moduleCode);
      });
      sendData(response, status);
    },
  );

  router.get(
    '/audit',
    requirePlatformScope('platform:read'),
    validateQuery(auditQuerySchema),
    async (request, response) => {
      const { page, pageSize, organizationId } = request.query as unknown as z.infer<
        typeof auditQuerySchema
      >;
      const result = await database.query(
        `select pal.id,pal.action,pal.organization_id as "organizationId",
          o.name as "organizationName",pac.name as "apiClientName",
          pal.before_data as "before",pal.after_data as "after",pal.metadata,
          pal.created_at as "createdAt",count(*) over()::int as total
         from platform_audit_logs pal
         join platform_api_clients pac on pac.id=pal.api_client_id
         left join organizations o on o.id=pal.organization_id
         where ($1::uuid is null or pal.organization_id=$1)
         order by pal.created_at desc limit $2 offset $3`,
        [organizationId ?? null, pageSize, (page - 1) * pageSize],
      );
      const total = result.rows[0]?.total ?? 0;
      sendPage(
        response,
        result.rows.map(({ total: _total, ...row }) => row),
        page,
        pageSize,
        total,
      );
    },
  );

  return router;
}
