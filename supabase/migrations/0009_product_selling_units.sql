alter table public.product_variants
  add column if not exists unit text not null default 'piece',
  add column if not exists units_per_base numeric(14,3) not null default 1;

alter table public.product_variants
  drop constraint if exists product_variants_unit_check,
  drop constraint if exists product_variants_units_per_base_check;

alter table public.product_variants
  add constraint product_variants_unit_check
    check (unit in ('piece', 'serving', 'box', 'pack', 'ml', 'l', 'g', 'kg')),
  add constraint product_variants_units_per_base_check
    check (units_per_base > 0);
