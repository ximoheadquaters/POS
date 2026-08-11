import type {
  ApplicationAccess,
  EntitlementValue,
  OrganizationMembershipSummary,
} from '@ximo/shared';
import type { Queryable } from '../database/types.js';

interface PlatformAccessRow {
  membershipId: string;
  organizationId: string;
  membershipStatus: OrganizationMembershipSummary['status'];
  applications: ApplicationAccess[] | null;
}

export interface PlatformAccessContext {
  membership?: OrganizationMembershipSummary;
  applications: ApplicationAccess[];
}

export class PlatformAccessService {
  constructor(private readonly db: Queryable) {}

  async getForUserOrganization(
    userId: string,
    organizationId: string,
    queryable: Queryable = this.db,
  ): Promise<PlatformAccessContext> {
    const result = await queryable.query<PlatformAccessRow>(
      `select membership.id as "membershipId",
         membership.organization_id as "organizationId",
         membership.status as "membershipStatus",
         coalesce(jsonb_agg(
           jsonb_build_object(
             'id', application.id,
             'code', application.code,
             'name', application.name,
             'subscriptionStatus', subscription.status::text,
             'planCode', plan.code,
             'planName', plan.name,
             'role', role.code,
             'entitlements', coalesce(access.entitlements, '{}'::jsonb)
           ) order by application.name
         ) filter (where application.id is not null), '[]'::jsonb) as applications
       from organization_memberships membership
       left join membership_application_roles membership_role
         on membership_role.membership_id = membership.id
       left join applications application
         on application.id = membership_role.application_id and application.is_active
       left join subscriptions subscription
         on subscription.organization_id = membership.organization_id
        and subscription.application_id = application.id
       left join plans plan on plan.id = subscription.plan_id
       left join roles role on role.id = membership_role.role_id
       left join lateral (
         select jsonb_object_agg(
           entitlement.code,
           coalesce(organization_override.value, plan_entitlement.value)
         ) as entitlements
         from application_entitlements entitlement
         left join plan_entitlements plan_entitlement
           on plan_entitlement.entitlement_id = entitlement.id
          and plan_entitlement.plan_id = plan.id
         left join organization_entitlement_overrides organization_override
           on organization_override.organization_id = membership.organization_id
          and organization_override.application_id = application.id
          and organization_override.entitlement_id = entitlement.id
         where entitlement.application_id = application.id
           and (plan_entitlement.entitlement_id is not null
             or organization_override.entitlement_id is not null)
       ) access on true
       where membership.user_id = $1
         and membership.organization_id = $2
         and membership.status <> 'removed'
       group by membership.id`,
      [userId, organizationId],
    );
    const row = result.rows[0];
    if (!row) return { applications: [] };
    return {
      membership: {
        id: row.membershipId,
        organizationId: row.organizationId,
        status: row.membershipStatus,
      },
      applications: (row.applications ?? []).map((application) => ({
        ...application,
        entitlements: (application.entitlements ?? {}) as Record<string, EntitlementValue>,
      })),
    };
  }
}
