begin;

insert into public.modules (code, name, description) values
  (
    'stock_transfers',
    'Stock Transfers',
    'Transfer inventory items between multiple branches with dispatch and receiving tracking.'
  )
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description;

insert into public.plan_modules (plan_id, module_id)
select p.id, m.id
from public.plans p cross join public.modules m
where m.code = 'stock_transfers'
  and p.code in ('business', 'professional', 'enterprise', 'growth')
on conflict do nothing;

create sequence if not exists public.stock_transfer_number_seq;

create table if not exists public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  from_branch_id uuid not null,
  to_branch_id uuid not null,
  transfer_number text not null,
  status text not null default 'in_transit' check (status in ('in_transit', 'completed', 'cancelled')),
  notes text,
  created_by uuid not null,
  completed_by uuid,
  cancelled_by uuid,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, transfer_number),
  foreign key (from_branch_id, organization_id) references public.branches(id, organization_id) on delete restrict,
  foreign key (to_branch_id, organization_id) references public.branches(id, organization_id) on delete restrict,
  foreign key (created_by, organization_id) references public.profiles(id, organization_id) on delete restrict
);

create table if not exists public.stock_transfer_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  stock_transfer_id uuid not null references public.stock_transfers(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity numeric(14,4) not null check (quantity > 0),
  created_at timestamptz not null default now()
);

commit;
