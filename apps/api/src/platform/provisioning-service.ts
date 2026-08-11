import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuthActions } from '../auth/types.js';
import type { Database, Queryable } from '../database/types.js';
import { conflict, unprocessable } from '../shared/errors.js';
import type { PlatformApiClient } from './auth.js';

const ONBOARDING_STATUSES = ['trialing', 'active', 'past_due', 'cancelled'] as const;
const SUPPORTED_CURRENCIES = new Set(Intl.supportedValuesOf('currency'));

export const provisionOrganizationRequestSchema = z.object({
  name: z.string(),
  currency: z.string(),
  timezone: z.string(),
  planCode: z.string(),
  subscriptionStatus: z.string(),
  businessProfile: z.enum(['retail', 'food_service', 'hybrid']).default('retail'),
  ownerEmail: z.string(),
  ownerName: z.string().optional(),
});

export type ProvisionOrganizationRequest = z.infer<typeof provisionOrganizationRequestSchema>;

interface PlanRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  isAvailableForOnboarding: boolean;
  allowedOnboardingStatuses: string[];
  modules: Array<{ code: string; name: string }>;
}

export interface ProvisionedOrganization {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  businessProfile: 'retail' | 'food_service' | 'hybrid';
  planCode: string;
  planName: string;
  subscriptionStatus: string;
  enabledModules: Array<{ code: string; name: string; source: 'plan' | 'profile' }>;
  owner: {
    email: string;
    displayName: string;
    invitationStatus: 'pending';
  };
  defaultBranch: {
    id: string;
    name: string;
    code: string;
  };
}

interface ProvisionContext {
  apiClient: PlatformApiClient;
  idempotencyKey: string;
  auditMetadata: Record<string, string>;
}

function normalize(input: ProvisionOrganizationRequest): ProvisionOrganizationRequest {
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  const fallbackOwnerName =
    ownerEmail
      .split('@')[0]
      ?.replace(/[._-]+/g, ' ')
      .replace(/\b\w/g, (character) => character.toUpperCase()) || 'Organization Owner';
  return {
    name: input.name.trim(),
    currency: input.currency.trim().toUpperCase(),
    timezone: input.timezone.trim(),
    planCode: input.planCode.trim().toLowerCase(),
    subscriptionStatus: input.subscriptionStatus.trim().toLowerCase(),
    businessProfile: input.businessProfile ?? 'retail',
    ownerEmail,
    ownerName: input.ownerName?.trim() || fallbackOwnerName,
  };
}

function requestHash(input: ProvisionOrganizationRequest): string {
  return createHash('sha256').update(JSON.stringify(input), 'utf8').digest('hex');
}

function validateInput(input: ProvisionOrganizationRequest) {
  const issues: Record<string, string> = {};
  if (input.name.length < 2 || input.name.length > 180) {
    issues.name = 'Organization name must contain between 2 and 180 characters';
  }
  if (!/^[A-Z]{3}$/.test(input.currency) || !SUPPORTED_CURRENCIES.has(input.currency)) {
    issues.currency = 'Currency must be a supported three-letter ISO currency code';
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: input.timezone }).format(new Date());
  } catch {
    issues.timezone = 'Timezone must be a valid IANA timezone';
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(input.planCode)) {
    issues.planCode = 'Plan code is invalid';
  }
  if (
    !ONBOARDING_STATUSES.includes(input.subscriptionStatus as (typeof ONBOARDING_STATUSES)[number])
  ) {
    issues.subscriptionStatus = 'Subscription status is invalid';
  }
  if (!z.email().safeParse(input.ownerEmail).success) {
    issues.ownerEmail = 'Owner email is invalid';
  }
  if (!input.ownerName || input.ownerName.length < 2 || input.ownerName.length > 120) {
    issues.ownerName = 'Owner name must contain between 2 and 120 characters';
  }
  if (Object.keys(issues).length) {
    throw unprocessable(
      'INVALID_ORGANIZATION_PROVISIONING',
      'Organization details are invalid',
      issues,
    );
  }
}

function slugFor(name: string, organizationId: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return `${base || 'organization'}-${organizationId.slice(0, 8)}`;
}

async function claimIdempotency(
  transaction: Queryable,
  clientId: string,
  idempotencyKey: string,
  hash: string,
): Promise<ProvisionedOrganization | null> {
  const claimed = await transaction.query(
    `insert into platform_idempotency_keys (
      api_client_id,idempotency_key,request_hash
     ) values ($1,$2,$3)
     on conflict (api_client_id,idempotency_key) do nothing
     returning idempotency_key`,
    [clientId, idempotencyKey, hash],
  );
  if (claimed.rows[0]) return null;

  const existing = await transaction.query<{
    requestHash: string;
    responseData: ProvisionedOrganization | null;
  }>(
    `select request_hash as "requestHash",response_data as "responseData"
     from platform_idempotency_keys
     where api_client_id=$1 and idempotency_key=$2`,
    [clientId, idempotencyKey],
  );
  if (!existing.rows[0]) {
    throw conflict('IDEMPOTENCY_RETRY_REQUIRED', 'Retry the provisioning request');
  }
  if (existing.rows[0].requestHash !== hash) {
    throw conflict(
      'IDEMPOTENCY_KEY_REUSED',
      'The Idempotency-Key was already used with different organization details',
    );
  }
  if (!existing.rows[0].responseData) {
    throw conflict('IDEMPOTENCY_IN_PROGRESS', 'Organization provisioning is still in progress');
  }
  return existing.rows[0].responseData;
}

export class PlatformProvisioningService {
  constructor(
    private readonly database: Database,
    private readonly authActions: AuthActions,
  ) {}

  async provision(
    request: ProvisionOrganizationRequest,
    context: ProvisionContext,
  ): Promise<{ data: ProvisionedOrganization; replayed: boolean }> {
    const input = normalize(request);
    const hash = requestHash(input);
    let invitedAuthUserId: string | undefined;

    try {
      return await this.database.transaction(async (transaction) => {
        const replay = await claimIdempotency(
          transaction,
          context.apiClient.id,
          context.idempotencyKey,
          hash,
        );
        if (replay) return { data: replay, replayed: true };

        validateInput(input);
        const planResult = await transaction.query<PlanRow>(
          `select p.id,p.code,p.name,p.is_active as "isActive",
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
           where p.code=$1
           group by p.id`,
          [input.planCode],
        );
        const plan = planResult.rows[0];
        if (!plan?.isActive || !plan.isAvailableForOnboarding) {
          throw unprocessable(
            'INVALID_PLAN',
            'The selected plan is not available for organization onboarding',
          );
        }
        if (!plan.allowedOnboardingStatuses.includes(input.subscriptionStatus)) {
          throw unprocessable(
            'INVALID_SUBSCRIPTION_STATUS',
            'The selected subscription status is not allowed for this plan',
          );
        }

        const duplicateOwner = await transaction.query(
          'select 1 from profiles where lower(email)=lower($1) limit 1',
          [input.ownerEmail],
        );
        if (duplicateOwner.rows[0]) {
          throw conflict(
            'OWNER_ALREADY_EXISTS',
            'A POS organization owner already exists with this email',
          );
        }

        const invitedOwner = await this.authActions.inviteUser({
          email: input.ownerEmail,
          displayName: input.ownerName!,
        });
        invitedAuthUserId = invitedOwner.id;

        const organizationId = randomUUID();
        const organization = await transaction.query<{
          id: string;
          name: string;
          currency: string;
          timezone: string;
          businessProfile: 'retail' | 'food_service' | 'hybrid';
        }>(
          `insert into organizations (id,name,slug,currency,timezone,business_profile)
           values ($1,$2,$3,$4,$5,$6)
           returning id,name,currency,timezone,business_profile as "businessProfile"`,
          [
            organizationId,
            input.name,
            slugFor(input.name, organizationId),
            input.currency,
            input.timezone,
            input.businessProfile,
          ],
        );
        await transaction.query(
          `insert into subscriptions (organization_id,plan_id,status)
           values ($1,$2,$3)`,
          [organizationId, plan.id, input.subscriptionStatus],
        );
        await transaction.query(
          `insert into organization_settings (
            organization_id,business_name,tax_rate,receipt_header,receipt_footer,
            allow_negative_inventory,payment_methods
           ) values (
            $1,$2,0,$2,'Thank you for shopping with us!',false,
            array['cash','card','ewallet']::payment_method[]
           )`,
          [organizationId, input.name],
        );
        await transaction.query(
          `insert into product_units (
            organization_id,code,name,kind,default_step,is_system
           ) values
            ($1,'piece','Piece','discrete',1,true),
            ($1,'serving','Serving','discrete',1,true),
            ($1,'box','Box','discrete',1,true),
            ($1,'pack','Pack','discrete',1,true),
            ($1,'bottle','Bottle','discrete',1,true),
            ($1,'can','Can','discrete',1,true),
            ($1,'ml','Milliliter','decimal',100,true),
            ($1,'l','Liter','decimal',0.1,true),
            ($1,'g','Gram','decimal',100,true),
            ($1,'kg','Kilogram','decimal',0.1,true)
           on conflict (organization_id,code) do nothing`,
          [organizationId],
        );

        const roles = await transaction.query<{ id: string; code: string }>(
          `insert into roles (organization_id,code,name,is_system) values
            ($1,'owner','Owner',true),
            ($1,'administrator','Administrator',true),
            ($1,'manager','Manager',true),
            ($1,'cashier','Cashier',true),
            ($1,'inventory_staff','Inventory Staff',true)
           returning id,code`,
          [organizationId],
        );
        await transaction.query(
          `insert into role_permissions (role_id,permission_id)
           select r.id,p.id from roles r cross join permissions p
           where r.organization_id=$1 and (
             r.code in ('owner','administrator')
             or (r.code='manager' and p.code not in ('modules:manage'))
             or (r.code='cashier' and p.code in (
               'branches:read','products:read','inventory:read','registers:read','shifts:open',
               'shifts:close','cash:move','sales:create','sales:read_branch','customers:read'
             ))
             or (r.code='inventory_staff' and p.code in (
               'branches:read','products:read','products:manage','inventory:read','inventory:adjust',
               'suppliers:read','purchasing:read','purchasing:receive','purchasing:return'
             ))
           )`,
          [organizationId],
        );
        const ownerRole = roles.rows.find((role) => role.code === 'owner');
        if (!ownerRole) throw new Error('Owner role provisioning failed');

        await transaction.query(
          `insert into profiles (
            id,organization_id,role_id,display_name,email,is_active,invitation_sent_at,
            must_change_password
           ) values ($1,$2,$3,$4,$5,true,now(),true)`,
          [invitedOwner.id, organizationId, ownerRole.id, input.ownerName, invitedOwner.email],
        );
        const branch = await transaction.query<{ id: string; name: string; code: string }>(
          `insert into branches (organization_id,name,code,is_active)
           values ($1,'Main Branch','MAIN',true)
           returning id,name,code`,
          [organizationId],
        );
        await transaction.query(
          `insert into user_branches (organization_id,user_id,branch_id)
           values ($1,$2,$3)`,
          [organizationId, invitedOwner.id, branch.rows[0]!.id],
        );
        await transaction.query(
          `insert into registers (organization_id,branch_id,name,code,is_active)
           values ($1,$2,'Main Counter','MAIN-01',true)`,
          [organizationId, branch.rows[0]!.id],
        );

        const data: ProvisionedOrganization = {
          ...organization.rows[0]!,
          planCode: plan.code,
          planName: plan.name,
          subscriptionStatus: input.subscriptionStatus,
          enabledModules: plan.modules.map((module) => ({ ...module, source: 'plan' as const })),
          owner: {
            email: invitedOwner.email,
            displayName: input.ownerName!,
            invitationStatus: 'pending',
          },
          defaultBranch: branch.rows[0]!,
        };

        await transaction.query(
          `insert into audit_logs (
            organization_id,branch_id,actor_id,action,entity_type,entity_id,after_data
           ) values ($1,$2,$3,'organization.created','organization',$1,$4::jsonb)`,
          [organizationId, branch.rows[0]!.id, invitedOwner.id, JSON.stringify(data)],
        );
        await transaction.query(
          `insert into platform_audit_logs (
            api_client_id,organization_id,action,after_data,metadata
           ) values ($1,$2,'organization.provisioned',$3::jsonb,$4::jsonb)`,
          [
            context.apiClient.id,
            organizationId,
            JSON.stringify(data),
            JSON.stringify(context.auditMetadata),
          ],
        );
        await transaction.query(
          `update platform_idempotency_keys
           set response_data=$3::jsonb,completed_at=now()
           where api_client_id=$1 and idempotency_key=$2`,
          [context.apiClient.id, context.idempotencyKey, JSON.stringify(data)],
        );
        return { data, replayed: false };
      });
    } catch (error) {
      if (invitedAuthUserId) {
        try {
          await this.authActions.deleteUser(invitedAuthUserId);
        } catch {
          // Preserve the provisioning failure. The orphaned invitation must be revoked manually.
        }
      }
      throw error;
    }
  }
}
