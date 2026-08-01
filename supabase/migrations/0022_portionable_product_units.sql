begin;

insert into public.product_units (
  organization_id, code, name, kind, default_step, is_system
)
select o.id, seed.code, seed.name, 'discrete', 1.000, true
from public.organizations o
cross join (
  values
    ('bottle', 'Bottle'),
    ('can', 'Can')
) as seed(code, name)
on conflict (organization_id, code) do update
set name = excluded.name,
    kind = excluded.kind,
    default_step = excluded.default_step,
    is_system = true,
    is_active = true,
    updated_at = now();

commit;
