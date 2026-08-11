begin;

-- Production lost core retail/food business_profile_modules rows, so starter
-- subscriptions only unlocked the few remaining profile defaults (offline /
-- production). Restore the intended profile defaults and keep plan modules
-- available when a profile row is missing.

insert into public.business_profile_modules (business_profile, module_id, enabled_by_default)
select 'retail', m.id, true
from public.modules m
join public.applications a on a.id = m.application_id and a.code = 'ximo_pos'
where m.code in (
  'dashboard', 'pos', 'products', 'inventory', 'customers', 'returns',
  'registers', 'reports', 'suppliers', 'purchasing', 'stock_transfers',
  'audit', 'offline', 'barcode_scanner', 'receipt_printer', 'cash_drawer', 'production'
)
on conflict (business_profile, module_id) do update set enabled_by_default = true;

insert into public.business_profile_modules (business_profile, module_id, enabled_by_default)
select 'food_service', m.id, true
from public.modules m
join public.applications a on a.id = m.application_id and a.code = 'ximo_pos'
where m.code in (
  'dashboard', 'pos', 'products', 'inventory', 'customers', 'returns',
  'registers', 'reports', 'audit', 'offline', 'receipt_printer', 'cash_drawer',
  'suppliers', 'purchasing', 'stock_transfers',
  'ingredients', 'recipes', 'prepared_food', 'production', 'held_sales'
)
on conflict (business_profile, module_id) do update set enabled_by_default = true;

insert into public.business_profile_modules (business_profile, module_id, enabled_by_default)
select 'hybrid', m.id, true
from public.modules m
join public.applications a on a.id = m.application_id and a.code = 'ximo_pos'
where m.code in (
  'dashboard', 'pos', 'products', 'inventory', 'customers', 'returns',
  'registers', 'reports', 'suppliers', 'purchasing', 'stock_transfers',
  'audit', 'offline', 'barcode_scanner', 'receipt_printer', 'cash_drawer',
  'ingredients', 'recipes', 'prepared_food', 'production', 'held_sales'
)
on conflict (business_profile, module_id) do update set enabled_by_default = true;

insert into public.plan_modules (plan_id, module_id)
select p.id, m.id
from public.plans p
join public.applications a on a.id = p.application_id and a.code = 'ximo_pos'
join public.modules m on m.application_id = a.id
where p.code = 'starter'
  and m.code in (
    'dashboard', 'pos', 'products', 'inventory', 'customers', 'returns', 'registers'
  )
on conflict (plan_id, module_id) do nothing;

commit;
