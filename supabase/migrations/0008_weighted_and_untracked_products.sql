alter table public.products
  add column if not exists track_inventory boolean not null default true;

alter table public.branch_inventory
  alter column quantity type numeric(14,3) using quantity::numeric,
  alter column low_stock_level type numeric(14,3) using low_stock_level::numeric;

alter table public.inventory_movements
  alter column quantity_delta type numeric(14,3) using quantity_delta::numeric,
  alter column quantity_after type numeric(14,3) using quantity_after::numeric;

alter table public.sale_items
  alter column quantity type numeric(14,3) using quantity::numeric,
  alter column returned_quantity type numeric(14,3) using returned_quantity::numeric;

alter table public.return_items
  alter column quantity type numeric(14,3) using quantity::numeric;

alter table public.products drop constraint if exists products_unit_check;
alter table public.products
  add constraint products_unit_check
  check (unit in ('piece', 'serving', 'box', 'pack', 'ml', 'l', 'g', 'kg'));
