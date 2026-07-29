alter table public.products
  add column if not exists unit text not null default 'piece';

alter table public.products drop constraint if exists products_unit_check;
alter table public.products
  add constraint products_unit_check
  check (unit in ('piece', 'box', 'pack', 'ml', 'l', 'g', 'kg'));
