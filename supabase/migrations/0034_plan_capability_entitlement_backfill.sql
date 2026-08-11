begin;

-- Migration 0026 registered these implemented capabilities and granted them to
-- every plan that existed at that time. On a clean installation the production
-- plans are created later by migration 0033, so that earlier grant inserts no
-- rows. Repeat the assignment after the reference catalogue exists so clean
-- installs and upgraded databases have the same plan capabilities.
insert into public.plan_modules (plan_id, module_id)
select plan.id, module.id
from public.plans plan
join public.applications application
  on application.id = plan.application_id
 and application.code = 'ximo_pos'
join public.modules module
  on module.application_id = application.id
where plan.code in ('starter', 'business', 'professional', 'enterprise')
  and module.code in (
    'offline',
    'ingredients',
    'recipes',
    'prepared_food',
    'production',
    'held_sales'
  )
on conflict (plan_id, module_id) do nothing;

-- Keep the generalized entitlement model synchronized with the compatibility
-- plan_modules table. Existing rows are updated and missing rows are inserted.
insert into public.plan_entitlements (plan_id, entitlement_id, value)
select
  plan_module.plan_id,
  entitlement.id,
  'true'::jsonb
from public.plan_modules plan_module
join public.plans plan on plan.id = plan_module.plan_id
join public.applications application
  on application.id = plan.application_id
 and application.code = 'ximo_pos'
join public.modules module on module.id = plan_module.module_id
join public.application_entitlements entitlement
  on entitlement.application_id = module.application_id
 and entitlement.code = 'module.' || module.code
where module.code in (
  'offline',
  'ingredients',
  'recipes',
  'prepared_food',
  'production',
  'held_sales'
)
on conflict (plan_id, entitlement_id) do update set
  value = excluded.value,
  updated_at = now();

commit;
