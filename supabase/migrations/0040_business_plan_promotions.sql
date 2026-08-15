begin;

-- Promotions belongs on Business (and higher), not only Professional.
insert into public.plan_modules (plan_id, module_id)
select p.id, m.id
from public.plans p
join public.applications a on a.id = p.application_id and a.code = 'ximo_pos'
join public.modules m on m.application_id = a.id and m.code = 'promotions'
where p.code in ('business', 'professional', 'enterprise')
on conflict (plan_id, module_id) do nothing;

insert into public.plan_entitlements (plan_id, entitlement_id, value)
select p.id, ae.id, 'true'::jsonb
from public.plans p
join public.applications a on a.id = p.application_id and a.code = 'ximo_pos'
join public.modules m on m.application_id = a.id and m.code = 'promotions'
join public.application_entitlements ae
  on ae.application_id = a.id and ae.code = 'module.promotions'
where p.code in ('business', 'professional', 'enterprise')
on conflict (plan_id, entitlement_id) do update set
  value = excluded.value,
  updated_at = now();

commit;
