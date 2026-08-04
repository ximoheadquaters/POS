-- 1. Add units_per_base as nullable numeric(14,6) without default
alter table public.sale_items
  add column if not exists units_per_base numeric(14,6);

-- 2. Backfill historical sale_items where selling variant exists
update public.sale_items si
set units_per_base = coalesce(v.units_per_base, 1)
from public.product_variants v
where si.variant_id = v.id
  and si.units_per_base is null;

-- 3. Set default 1 for remaining historical base-unit or unresolved sales
update public.sale_items
set units_per_base = 1
where units_per_base is null;

-- 4. Apply default and not null constraints
alter table public.sale_items
  alter column units_per_base set default 1,
  alter column units_per_base set not null;
