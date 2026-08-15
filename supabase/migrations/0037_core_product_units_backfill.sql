begin;

-- Built-in product flows depend on these units. Older organizations, and
-- organizations provisioned by an earlier API release, may only have a subset
-- of them. That makes an otherwise valid Add Product request fail after the
-- user selects Raw Ingredient, Repacking, or a packaged storage unit.
insert into public.product_units (
  organization_id,
  code,
  name,
  kind,
  default_step,
  is_system,
  is_active
)
select
  organization.id,
  seed.code,
  seed.name,
  seed.kind,
  seed.default_step,
  true,
  true
from public.organizations organization
cross join (
  values
    ('piece', 'Piece', 'discrete', 1.000),
    ('serving', 'Serving', 'discrete', 1.000),
    ('box', 'Box', 'discrete', 1.000),
    ('pack', 'Pack', 'discrete', 1.000),
    ('sack', 'Sack', 'discrete', 1.000),
    ('bottle', 'Bottle', 'discrete', 1.000),
    ('can', 'Can', 'discrete', 1.000),
    ('ml', 'Milliliter', 'decimal', 100.000),
    ('l', 'Liter', 'decimal', 0.100),
    ('g', 'Gram', 'decimal', 100.000),
    ('kg', 'Kilogram', 'decimal', 0.100)
) as seed(code, name, kind, default_step)
on conflict (organization_id, code) do update set
  name = excluded.name,
  kind = excluded.kind,
  default_step = excluded.default_step,
  is_system = true,
  is_active = true,
  updated_at = now();

commit;
