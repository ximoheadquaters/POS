begin;

alter type public.inventory_movement_type
  add value if not exists 'production_consumption';
alter type public.inventory_movement_type
  add value if not exists 'production_output';

create sequence if not exists public.production_batch_number_seq;

create table if not exists public.production_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  batch_number text not null,
  product_id uuid not null,
  quantity_produced numeric(14,3) not null check (quantity_produced > 0),
  unit_cost numeric(14,4) not null default 0 check (unit_cost >= 0),
  total_cost numeric(14,4) not null default 0 check (total_cost >= 0),
  notes text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, batch_number),
  unique (id, organization_id),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  foreign key (product_id, organization_id)
    references public.products(id, organization_id) on delete restrict,
  foreign key (created_by, organization_id)
    references public.profiles(id, organization_id) on delete restrict
);

create table if not exists public.production_batch_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  production_batch_id uuid not null,
  ingredient_product_id uuid not null,
  quantity_consumed numeric(14,3) not null check (quantity_consumed > 0),
  unit_cost numeric(14,4) not null default 0 check (unit_cost >= 0),
  total_cost numeric(14,4) not null default 0 check (total_cost >= 0),
  containers_opened numeric(14,3) not null default 0 check (containers_opened >= 0),
  created_at timestamptz not null default now(),
  foreign key (production_batch_id, organization_id)
    references public.production_batches(id, organization_id) on delete cascade,
  foreign key (ingredient_product_id, organization_id)
    references public.products(id, organization_id) on delete restrict
);

create index if not exists production_batches_lookup_idx
  on public.production_batches (organization_id, branch_id, created_at desc);
create index if not exists production_batch_items_batch_idx
  on public.production_batch_items (production_batch_id);

alter table public.production_batches enable row level security;
alter table public.production_batch_items enable row level security;

drop policy if exists tenant_read_production_batches on public.production_batches;
create policy tenant_read_production_batches
  on public.production_batches for select
  using (organization_id = public.current_organization_id());

drop policy if exists tenant_read_production_batch_items on public.production_batch_items;
create policy tenant_read_production_batch_items
  on public.production_batch_items for select
  using (organization_id = public.current_organization_id());

alter table public.inventory_pool_movements
  drop constraint if exists inventory_pool_movements_movement_type_check;
alter table public.inventory_pool_movements
  add constraint inventory_pool_movements_movement_type_check check (
    movement_type in (
      'open_container','whole_sale','portion_sale','recipe_deduction','sale_return',
      'purchase_receipt','purchase_return','stock_transfer_out','stock_transfer_in',
      'adjustment','production_open','production_consumption'
    )
  );

commit;
