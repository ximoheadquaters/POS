begin;

alter type public.inventory_movement_type add value if not exists 'recipe_deduction';
alter type public.inventory_movement_type add value if not exists 'damaged_return';
alter type public.inventory_movement_type add value if not exists 'stock_transfer_out';
alter type public.inventory_movement_type add value if not exists 'stock_transfer_in';

alter table public.product_variants
  add column if not exists is_portioning_container boolean not null default false;

create unique index if not exists product_variants_one_portioning_container_idx
  on public.product_variants (organization_id, product_id)
  where is_portioning_container;

alter table public.branch_inventory
  add column if not exists sealed_quantity numeric(14,3) not null default 0,
  add column if not exists opened_quantity numeric(14,3) not null default 0;

-- Some local databases were created before migration 0017 was added and users may
-- apply this migration directly in the SQL editor. Bootstrap the transfer tables so
-- the pool columns below are safe and the migration remains repeatable.
create sequence if not exists public.stock_transfer_number_seq;

create table if not exists public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  from_branch_id uuid not null,
  to_branch_id uuid not null,
  transfer_number text not null,
  status text not null default 'in_transit'
    check (status in ('in_transit', 'completed', 'cancelled')),
  notes text,
  created_by uuid not null,
  completed_by uuid,
  cancelled_by uuid,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, transfer_number),
  foreign key (from_branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  foreign key (to_branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  foreign key (created_by, organization_id)
    references public.profiles(id, organization_id) on delete restrict
);

create table if not exists public.stock_transfer_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  stock_transfer_id uuid not null references public.stock_transfers(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity numeric(14,4) not null check (quantity > 0),
  created_at timestamptz not null default now()
);

alter table public.stock_transfer_items
  add column if not exists stock_pool text not null default 'shared'
    check (stock_pool in ('shared', 'sealed', 'opened')),
  add column if not exists container_variant_id uuid,
  add column if not exists base_quantity numeric(14,3);

update public.stock_transfer_items
set base_quantity = quantity
where base_quantity is null;

alter table public.stock_transfer_items
  alter column base_quantity set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'stock_transfer_items_container_variant_fk'
  ) then
    alter table public.stock_transfer_items
      add constraint stock_transfer_items_container_variant_fk
      foreign key (container_variant_id, organization_id)
      references public.product_variants(id, organization_id) on delete restrict;
  end if;
end $$;

create table if not exists public.inventory_pool_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  product_id uuid not null,
  container_variant_id uuid,
  movement_type text not null check (
    movement_type in (
      'open_container',
      'whole_sale',
      'portion_sale',
      'recipe_deduction',
      'sale_return',
      'purchase_receipt',
      'purchase_return',
      'stock_transfer_out',
      'stock_transfer_in',
      'adjustment'
    )
  ),
  sealed_quantity_delta numeric(14,3) not null default 0,
  opened_quantity_delta numeric(14,3) not null default 0,
  sealed_quantity_after numeric(14,3) not null,
  opened_quantity_after numeric(14,3) not null,
  reason text not null,
  reference_type text,
  reference_id uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  foreign key (product_id, organization_id)
    references public.products(id, organization_id) on delete restrict,
  foreign key (container_variant_id, organization_id)
    references public.product_variants(id, organization_id) on delete restrict,
  foreign key (created_by, organization_id)
    references public.profiles(id, organization_id) on delete restrict
);

create index if not exists inventory_pool_movements_lookup_idx
  on public.inventory_pool_movements (
    organization_id, branch_id, product_id, created_at desc
  );

insert into public.product_units (
  organization_id, code, name, kind, default_step, is_system, is_active
)
select o.id, 'sack', 'Sack', 'discrete', 1.000, true, true
from public.organizations o
on conflict (organization_id, code) do update
set name = excluded.name,
    kind = excluded.kind,
    default_step = excluded.default_step,
    is_system = true,
    is_active = true,
    updated_at = now();

alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_items enable row level security;
alter table public.inventory_pool_movements enable row level security;

drop policy if exists tenant_read_stock_transfers on public.stock_transfers;
create policy tenant_read_stock_transfers
  on public.stock_transfers for select
  using (organization_id = public.current_organization_id());

drop policy if exists tenant_read_stock_transfer_items
  on public.stock_transfer_items;
create policy tenant_read_stock_transfer_items
  on public.stock_transfer_items for select
  using (organization_id = public.current_organization_id());

drop policy if exists tenant_read_inventory_pool_movements
  on public.inventory_pool_movements;
create policy tenant_read_inventory_pool_movements
  on public.inventory_pool_movements for select
  using (organization_id = public.current_organization_id());

commit;
