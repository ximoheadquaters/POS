import {
  MODULE_DEPENDENCIES,
  type BusinessProfile,
  type ModuleCode,
} from '@ximo/shared';
import type { Queryable } from '../database/types.js';

export function pruneDisabledDependentModules(modules: ModuleCode[]): ModuleCode[] {
  const set = new Set<ModuleCode>(modules);
  let changed = true;
  while (changed) {
    changed = false;
    for (const mod of Array.from(set)) {
      const deps = MODULE_DEPENDENCIES[mod];
      if (deps && deps.some((dep) => !set.has(dep))) {
        set.delete(mod);
        changed = true;
      }
    }
  }
  return Array.from(set);
}

export class EntitlementService {
  constructor(private readonly db: Queryable) {}

  /**
   * Authoritative calculation of effective modules for an organization.
   * Uses a deterministic LATERAL subquery for active/trialing subscriptions.
   * If no active or trialing subscription exists, returns zero modules [].
   * Accepts a custom Queryable (e.g. transaction client) or defaults to constructor db.
   */
  async getEffectiveModules(
    organizationId: string,
    overrideProfile?: BusinessProfile | null,
    queryable: Queryable = this.db,
  ): Promise<ModuleCode[]> {
    const result = await queryable.query<{ code: string }>(
      `select m.code
       from modules m
       join lateral (
         select sub.plan_id, sub.status
         from subscriptions sub
         where sub.organization_id = $1
           and sub.status in ('trialing', 'active')
         order by sub.created_at desc, sub.id desc
         limit 1
       ) current_sub on true
       left join plan_modules pm
         on pm.module_id = m.id
        and pm.plan_id = current_sub.plan_id
       join organizations o
         on o.id = $1
       left join organization_modules om
         on om.organization_id = $1 and om.module_id = m.id
       left join business_profile_modules bpm
         on bpm.business_profile = coalesce($2, o.business_profile, 'retail')
        and bpm.module_id = m.id
       where (
         case
           when om.module_id is not null then om.enabled
           else (pm.module_id is not null and coalesce(bpm.enabled_by_default, false))
         end
       ) = true`,
      [organizationId, overrideProfile ?? null],
    );
    const rawModules = result.rows.map((r) => r.code as ModuleCode);
    return pruneDisabledDependentModules(rawModules);
  }
}
