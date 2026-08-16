import { MODULE_DEPENDENCIES, type BusinessProfile, type ModuleCode } from '@ximo/shared';
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

/** When a module is enabled, include the modules it requires (e.g. purchasing → suppliers). */
export function expandRequiredDependencies(modules: ModuleCode[]): ModuleCode[] {
  const set = new Set<ModuleCode>(modules);
  let changed = true;
  while (changed) {
    changed = false;
    for (const mod of Array.from(set)) {
      for (const dep of MODULE_DEPENDENCIES[mod] ?? []) {
        if (!set.has(dep)) {
          set.add(dep);
          changed = true;
        }
      }
    }
  }
  return Array.from(set);
}

/**
 * Resolve the usable module set:
 * 1) expand required dependencies for enabled modules
 * 2) remove modules that were explicitly override-disabled
 * 3) prune dependents that still lack required parents
 */
export function resolveEffectiveModules(
  enabledModules: ModuleCode[],
  explicitlyDisabled: Iterable<ModuleCode> = [],
): ModuleCode[] {
  const disabled = new Set<ModuleCode>(explicitlyDisabled);
  const expanded = expandRequiredDependencies(enabledModules).filter(
    (code) => !disabled.has(code),
  );
  return pruneDisabledDependentModules(expanded);
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
    const [enabledResult, disabledOverrides] = await Promise.all([
      queryable.query<{ code: string }>(
        `select m.code
         from modules m
         join applications application
           on application.id = m.application_id and application.code = 'ximo_pos'
         join lateral (
           select sub.plan_id, sub.status
           from subscriptions sub
           where sub.organization_id = $1
             and sub.application_id = application.id
             and sub.status in ('trialing', 'active')
           order by sub.created_at desc, sub.id desc
           limit 1
         ) current_sub on true
         join organizations o
           on o.id = $1
         left join plan_modules pm
           on pm.module_id = m.id
          and pm.plan_id = current_sub.plan_id
         left join organization_modules om
           on om.organization_id = $1 and om.module_id = m.id
         left join business_profile_modules bpm
           on bpm.business_profile = coalesce($2, o.business_profile, 'retail')
          and bpm.module_id = m.id
         where (
           case
             when om.module_id is not null then om.enabled
             -- Missing business_profile_modules row must not hide a plan module.
             else (pm.module_id is not null and coalesce(bpm.enabled_by_default, true))
           end
         ) = true`,
        [organizationId, overrideProfile ?? null],
      ),
      queryable.query<{ code: string }>(
        `select m.code
         from organization_modules om
         join modules m on m.id = om.module_id
         join applications application
           on application.id = m.application_id and application.code = 'ximo_pos'
         where om.organization_id = $1
           and om.enabled = false`,
        [organizationId],
      ),
    ]);

    return resolveEffectiveModules(
      enabledResult.rows.map((row) => row.code as ModuleCode),
      disabledOverrides.rows.map((row) => row.code as ModuleCode),
    );
  }
}
